import { Request, Response, NextFunction } from 'express'

import { verifySupabaseToken, SupabaseAuthUser } from '../lib/auth'
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

const extractBearerToken = (req: Request): string | null => {
    const header = req.headers['authorization']
    if (typeof header !== 'string') return null
    const [scheme, token] = header.split(' ')
    if (scheme !== 'Bearer' || !token) return null
    return token.trim()
}

const extractClientId = (req: Request): string | null => {
    const fromParams =
        typeof req.params?.clientId === 'string' ? req.params.clientId : null
    if (fromParams) return fromParams
    const fromBody =
        typeof req.body?.client_id === 'string' ? req.body.client_id : null
    return fromBody
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
        // First-login linking: find unlinked rows for this email and populate auth_uid
        const pending = await clientUsersService.findUnlinkedByEmail(
            req.authUser.email
        )
        if (pending.length > 0) {
            for (const row of pending) {
                await clientUsersService.linkAuthUid(row.id, req.authUser.uid)
            }
            assignments = await clientUsersService.findByAuthUid(
                req.authUser.uid
            )
        }
    } else {
        // Fire-and-forget last_login update — don't block the request on this
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
        res.status(401).json({ error: 'Unauthorized' })
    }
}

/**
 * Checks that the authenticated user has the required permission level for
 * the target client. PVS admins always pass. The target client_id is read
 * from req.params.clientId, then req.body.client_id.
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
