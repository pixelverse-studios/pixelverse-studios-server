import { Request, Response, NextFunction } from 'express'

import {
    verifySupabaseToken,
    SupabaseAuthUser,
    AuthConfigError,
} from '../lib/auth'
import clientUsersService, {
    ClientUserRow,
    CmsRole,
} from '../services/client-users'

export type CmsPermission = 'view' | 'edit' | 'admin'

export interface CmsUserContext {
    role: CmsRole
    clientId: string | null
    isPvsAdmin: boolean
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            authUser?: SupabaseAuthUser
            cmsUserAssignments?: ClientUserRow[]
            cmsUser?: CmsUserContext
        }
    }
}

const ROLE_PERMISSIONS: Record<CmsPermission, CmsRole[]> = {
    view: ['viewer', 'editor', 'admin'],
    edit: ['editor', 'admin'],
    admin: ['admin'],
}

// Throttle last_login writes to once per N minutes per user to avoid
// hot-path write amplification on every authenticated request.
const LAST_LOGIN_THROTTLE_MS = 5 * 60 * 1000

const extractBearerToken = (req: Request): string | null => {
    const header = req.headers['authorization']
    if (typeof header !== 'string') return null
    const [scheme, token] = header.split(' ')
    if (!scheme || !token) return null
    if (scheme.toLowerCase() !== 'bearer') return null
    return token.trim()
}

/**
 * Extracts a target client_id from the request.
 *
 * Only reads from URL params and query string — NOT request body.
 * Body fallback would let an attacker pass an arbitrary client_id
 * unrelated to the URL path.
 *
 * For routes where the resource itself determines the client_id
 * (e.g., PATCH /api/cms/pages/:id), the controller should look up
 * the resource and perform its own authorization check rather than
 * relying on this middleware.
 */
const extractClientId = (req: Request): string | null => {
    const fromParams =
        typeof req.params?.clientId === 'string' ? req.params.clientId : null
    if (fromParams) return fromParams
    const fromQuery =
        typeof req.query?.client_id === 'string' ? req.query.client_id : null
    return fromQuery
}

const shouldUpdateLastLogin = (assignments: ClientUserRow[]): boolean => {
    if (assignments.length === 0) return false
    const now = Date.now()
    return assignments.some(a => {
        if (!a.last_login) return true
        const lastLoginMs = new Date(a.last_login).getTime()
        return now - lastLoginMs > LAST_LOGIN_THROTTLE_MS
    })
}

/**
 * Loads the user's client_users assignments. Performs first-login linking
 * by email if no auth_uid match exists. Caches the result on the request
 * so multiple permission checks in the same request only query once.
 */
const loadAssignments = async (req: Request): Promise<ClientUserRow[]> => {
    if (req.cmsUserAssignments) return req.cmsUserAssignments
    if (!req.authUser) {
        throw new Error('loadAssignments called before requireAuth')
    }

    let assignments = await clientUsersService.findByAuthUid(req.authUser.uid)

    if (assignments.length === 0) {
        // First-login linking: find unlinked rows for this email and link them.
        // The link is atomic (guarded by `auth_uid IS NULL` in the UPDATE).
        const pending = await clientUsersService.findUnlinkedByEmail(
            req.authUser.email
        )
        if (pending.length > 0) {
            await Promise.all(
                pending.map(row =>
                    clientUsersService.linkAuthUid(row.id, req.authUser!.uid)
                )
            )
            assignments = await clientUsersService.findByAuthUid(
                req.authUser.uid
            )
        }
    } else if (shouldUpdateLastLogin(assignments)) {
        // Throttled fire-and-forget last_login update
        clientUsersService.updateLastLogin(req.authUser.uid).catch(err => {
            console.error('Failed to update last_login:', err)
        })
    }

    req.cmsUserAssignments = assignments
    return assignments
}

/**
 * Verifies the Supabase JWT from the Authorization header and attaches
 * { uid, email } to req.authUser. Returns 401 if missing or invalid.
 *
 * Server misconfiguration (missing JWT secret) returns 500 — config errors
 * are not the client's fault.
 *
 * Does NOT touch the database — pair with requireCmsAccess or requirePvsAdmin
 * for endpoints that need role checks.
 */
export const requireAuth = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const token = extractBearerToken(req)
    if (!token) {
        res.status(401).json({ error: 'Unauthorized' })
        return
    }

    try {
        req.authUser = verifySupabaseToken(token)
        next()
    } catch (err) {
        if (err instanceof AuthConfigError) {
            console.error('Auth misconfigured:', err.message)
            res.status(500).json({ error: 'Internal server error' })
            return
        }
        res.status(401).json({ error: 'Unauthorized' })
    }
}

/**
 * Checks that the authenticated user has the required permission level for
 * the target client. PVS admins always pass. The target client_id is read
 * from req.params.clientId, then req.query.client_id.
 *
 * Permission levels:
 *   view  → viewer, editor, admin
 *   edit  → editor, admin
 *   admin → admin (client-scoped admin; for PVS admin checks use requirePvsAdmin)
 */
export const requireCmsAccess = (permission: CmsPermission) => {
    return async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        if (!req.authUser) {
            res.status(401).json({ error: 'Unauthorized' })
            return
        }

        try {
            const assignments = await loadAssignments(req)

            const pvsAdmin = assignments.find(a => a.is_pvs_admin)
            if (pvsAdmin) {
                req.cmsUser = {
                    role: pvsAdmin.role,
                    clientId: null,
                    isPvsAdmin: true,
                }
                next()
                return
            }

            const clientId = extractClientId(req)
            if (!clientId) {
                res.status(400).json({ error: 'client_id required' })
                return
            }

            const assignment = assignments.find(a => a.client_id === clientId)
            if (!assignment) {
                res.status(403).json({ error: 'Forbidden' })
                return
            }

            if (!ROLE_PERMISSIONS[permission].includes(assignment.role)) {
                res.status(403).json({ error: 'Forbidden' })
                return
            }

            req.cmsUser = {
                role: assignment.role,
                clientId,
                isPvsAdmin: false,
            }
            next()
        } catch (err) {
            console.error('requireCmsAccess error:', err)
            res.status(500).json({ error: 'Internal server error' })
        }
    }
}

/**
 * Checks whether the authenticated user has edit access to a specific client.
 * Used by routes where the permission check happens in the controller after
 * resolving a client_id from a resource lookup (e.g., routes keyed on
 * websiteId instead of clientId).
 *
 * PVS admins always pass. Returns false if req.authUser is missing.
 */
export const hasEditAccessToClient = async (
    req: Request,
    clientId: string | null
): Promise<boolean> => {
    if (!req.authUser || !clientId) return false

    const assignments =
        req.cmsUserAssignments ||
        (await clientUsersService.findByAuthUid(req.authUser.uid))

    if (!req.cmsUserAssignments) {
        req.cmsUserAssignments = assignments
    }

    const pvsAdmin = assignments.find(a => a.is_pvs_admin)
    if (pvsAdmin) return true

    const assignment = assignments.find(a => a.client_id === clientId)
    if (!assignment) return false
    return ROLE_PERMISSIONS.edit.includes(assignment.role)
}

/**
 * Allows only PVS admins (is_pvs_admin = true). Used for global operations
 * like template management and user management.
 */
export const requirePvsAdmin = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    if (!req.authUser) {
        res.status(401).json({ error: 'Unauthorized' })
        return
    }

    try {
        const assignments = await loadAssignments(req)
        const pvsAdmin = assignments.find(a => a.is_pvs_admin)
        if (!pvsAdmin) {
            res.status(403).json({ error: 'Forbidden' })
            return
        }
        req.cmsUser = {
            role: pvsAdmin.role,
            clientId: null,
            isPvsAdmin: true,
        }
        next()
    } catch (err) {
        console.error('requirePvsAdmin error:', err)
        res.status(500).json({ error: 'Internal server error' })
    }
}
