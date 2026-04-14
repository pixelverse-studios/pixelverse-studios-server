import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import { db, Tables, COLUMNS } from '../lib/db'
import clientUsersService, {
    ClientUserRow,
    CmsRole,
} from '../services/client-users'
import { handleGenericError } from '../utils/http'

interface WebsiteSummary {
    id: string
    title: string | null
    domain: string | null
}

interface ClientSummary {
    id: string
    firstname: string | null
    lastname: string | null
    company_name: string | null
}

interface AssignmentResponse {
    id: string | null
    client_id: string | null
    role: CmsRole
    client: ClientSummary | null
    websites: WebsiteSummary[]
}

const fetchWebsitesByClientIds = async (
    clientIds: string[]
): Promise<Map<string, WebsiteSummary[]>> => {
    const map = new Map<string, WebsiteSummary[]>()
    if (clientIds.length === 0) return map

    const { data, error } = await db
        .from(Tables.WEBSITES)
        .select('id, title, domain, client_id')
        .in(COLUMNS.CLIENT_ID, clientIds)

    if (error) throw error

    for (const row of (data || []) as Array<
        WebsiteSummary & { client_id: string }
    >) {
        const list = map.get(row.client_id) || []
        list.push({ id: row.id, title: row.title, domain: row.domain })
        map.set(row.client_id, list)
    }
    return map
}

const fetchClientsByIds = async (
    clientIds: string[]
): Promise<Map<string, ClientSummary>> => {
    const map = new Map<string, ClientSummary>()
    if (clientIds.length === 0) return map

    const { data, error } = await db
        .from(Tables.CLIENTS)
        .select('id, firstname, lastname, company_name')
        .in('id', clientIds)

    if (error) throw error

    for (const row of (data || []) as ClientSummary[]) {
        map.set(row.id, row)
    }
    return map
}

const me = async (req: Request, res: Response): Promise<Response> => {
    try {
        if (!req.authUser) {
            return res.status(401).json({ error: 'Unauthorized' })
        }

        const assignments = await clientUsersService.findByAuthUid(
            req.authUser.uid
        )

        const isPvsAdmin = assignments.some(a => a.is_pvs_admin)

        let assignmentResponses: AssignmentResponse[] = []

        if (isPvsAdmin) {
            // PVS admins receive every active client and their websites.
            const { data: clientsData, error: clientsError } = await db
                .from(Tables.CLIENTS)
                .select('id, firstname, lastname, company_name')
                .eq('active', true)

            if (clientsError) throw clientsError

            const clients = (clientsData || []) as ClientSummary[]
            const clientIds = clients.map(c => c.id)
            const websitesByClient = await fetchWebsitesByClientIds(clientIds)

            // Synthesized rows are not real client_users records — use
            // id: null so callers cannot mistake them for an assignment
            // they can update or delete.
            assignmentResponses = clients.map(client => ({
                id: null,
                client_id: client.id,
                role: 'admin' as CmsRole,
                client,
                websites: websitesByClient.get(client.id) || [],
            }))
        } else {
            const clientScoped = assignments.filter(
                (a): a is ClientUserRow & { client_id: string } =>
                    a.client_id !== null
            )
            const clientIds = Array.from(
                new Set(clientScoped.map(a => a.client_id))
            )
            const [clientsMap, websitesMap] = await Promise.all([
                fetchClientsByIds(clientIds),
                fetchWebsitesByClientIds(clientIds),
            ])

            assignmentResponses = clientScoped.map(a => ({
                id: a.id,
                client_id: a.client_id,
                role: a.role,
                client: clientsMap.get(a.client_id) || null,
                websites: websitesMap.get(a.client_id) || [],
            }))
        }

        return res.status(200).json({
            user: {
                uid: req.authUser.uid,
                email: req.authUser.email,
            },
            is_pvs_admin: isPvsAdmin,
            assignments: assignmentResponses,
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const list = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { clientId } = req.params
        const users = await clientUsersService.listByClient(clientId)
        return res.status(200).json({ users })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const invite = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { clientId } = req.params
        const {
            role,
            display_name,
        }: { role: CmsRole; display_name?: string } = req.body
        const email = String(req.body.email).toLowerCase()

        // Check for an existing assignment in any state. Active rows
        // should error, inactive rows should be reactivated.
        const existing = await clientUsersService.findByEmailAndClient(
            email,
            clientId
        )
        if (existing) {
            if (existing.active) {
                return res.status(409).json({
                    error: 'Already exists',
                    message:
                        'A user with this email is already assigned to this client.',
                })
            }
            const reactivated = await clientUsersService.reactivate(
                existing.id
            )
            return res.status(200).json(reactivated)
        }

        const invitedBy = req.authUser?.uid ?? null

        const row = await clientUsersService.insert({
            email,
            role,
            client_id: clientId,
            display_name: display_name ?? null,
            invited_by: invitedBy,
        })

        return res.status(201).json(row)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const updateRole = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const { role }: { role: CmsRole } = req.body

        const existing = await clientUsersService.findById(id)
        if (!existing) {
            return res.status(404).json({ error: 'User not found' })
        }

        // Block any modification of PVS admin rows via this endpoint.
        if (existing.is_pvs_admin) {
            return res.status(403).json({
                error: 'Forbidden',
                message:
                    'PVS admin roles cannot be modified via this endpoint',
            })
        }

        // Block self-role-changes to prevent privilege escalation/lockout.
        if (
            req.authUser &&
            existing.auth_uid &&
            existing.auth_uid === req.authUser.uid
        ) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You cannot modify your own role',
            })
        }

        // Only PVS admin rows may hold the global 'admin' role. For
        // client-scoped assignments, restrict to editor/viewer.
        if (role === 'admin' && !existing.is_pvs_admin) {
            return res.status(400).json({
                error: 'Invalid role',
                message:
                    'Non-PVS admin users may only be assigned the editor or viewer role.',
            })
        }

        const updated = await clientUsersService.updateRole(id, role)
        return res.status(200).json(updated)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const remove = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params

        const existing = await clientUsersService.findById(id)
        if (!existing) {
            return res.status(404).json({ error: 'User not found' })
        }

        // Block removal of PVS admin rows via this endpoint.
        if (existing.is_pvs_admin) {
            return res.status(403).json({
                error: 'Forbidden',
                message:
                    'PVS admin users cannot be removed via this endpoint',
            })
        }

        // Block self-removal to prevent admin lockout.
        if (
            req.authUser &&
            existing.auth_uid &&
            existing.auth_uid === req.authUser.uid
        ) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You cannot remove yourself',
            })
        }

        // Soft-delete preserves the audit trail and allows reinvitation.
        const deactivated = await clientUsersService.deactivate(id)
        return res.status(200).json(deactivated)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { me, list, invite, updateRole, remove }
