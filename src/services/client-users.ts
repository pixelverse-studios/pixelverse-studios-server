import { db, Tables, COLUMNS } from '../lib/db'

export type CmsRole = 'admin' | 'editor' | 'viewer'

export interface ClientUserRow {
    id: string
    auth_uid: string | null
    client_id: string | null
    role: CmsRole
    email: string
    display_name: string | null
    is_pvs_admin: boolean
    invited_by: string | null
    invited_at: string
    last_login: string | null
    active: boolean
    created_at: string
    updated_at: string
}

export class ClientUserLinkConflictError extends Error {
    email: string

    constructor(email: string) {
        super(`Multiple active PVS admin rows found for ${email}`)
        this.name = 'ClientUserLinkConflictError'
        this.email = email
    }
}

/**
 * Returns all active client_users rows for the given auth uid.
 * A user may have multiple rows (one per client they have access to,
 * plus optionally a PVS admin row with client_id = null).
 */
const findByAuthUid = async (authUid: string): Promise<ClientUserRow[]> => {
    const { data, error } = await db
        .from(Tables.CLIENT_USERS)
        .select('*')
        .eq(COLUMNS.AUTH_UID, authUid)
        .eq('active', true)

    if (error) throw error
    return (data || []) as ClientUserRow[]
}

/**
 * Returns active client_users rows matching the given email that have not yet
 * been linked to an auth uid (used for first-login linking).
 */
const findUnlinkedByEmail = async (email: string): Promise<ClientUserRow[]> => {
    const { data, error } = await db
        .from(Tables.CLIENT_USERS)
        .select('*')
        .eq('email', email.toLowerCase())
        .is(COLUMNS.AUTH_UID, null)
        .eq('active', true)

    if (error) throw error
    return (data || []) as ClientUserRow[]
}

/**
 * Atomically populates auth_uid on a client_users row (one-time first-login
 * linking). The update is guarded by `auth_uid IS NULL` to prevent races
 * where two concurrent requests try to link the same row, or where a row
 * was already linked by another flow.
 *
 * Returns true if the row was successfully linked, false if it was already
 * linked (no-op).
 */
const linkAuthUid = async (id: string, authUid: string): Promise<boolean> => {
    const { data, error } = await db
        .from(Tables.CLIENT_USERS)
        .update({
            auth_uid: authUid,
            last_login: new Date().toISOString(),
        })
        .eq('id', id)
        .is(COLUMNS.AUTH_UID, null)
        .select('id')

    if (error) throw error
    return Array.isArray(data) && data.length > 0
}

/**
 * Resolves the active client_users assignments for a signed-in user.
 *
 * If no rows are linked yet, this performs first-login linking by email.
 * PVS admin rows are special-cased: there must be at most one active
 * unlinked admin row for the email, otherwise we fail loudly instead of
 * racing into the unique auth_uid constraint.
 */
const resolveAssignments = async (
    authUid: string,
    email: string
): Promise<ClientUserRow[]> => {
    let assignments = await findByAuthUid(authUid)
    if (assignments.length > 0) return assignments

    const pending = await findUnlinkedByEmail(email)
    if (pending.length === 0) return []

    const pendingPvsAdmins = pending.filter(row => row.is_pvs_admin)
    if (pendingPvsAdmins.length > 1) {
        throw new ClientUserLinkConflictError(email)
    }

    const rowsToLink = pendingPvsAdmins.concat(
        pending.filter(row => !row.is_pvs_admin)
    )

    if (rowsToLink.length > 0) {
        await Promise.all(rowsToLink.map(row => linkAuthUid(row.id, authUid)))
        assignments = await findByAuthUid(authUid)
    }

    return assignments
}

/**
 * Updates last_login on all rows for a given auth uid.
 * Fire-and-forget — callers do not need to await for hot paths.
 */
const updateLastLogin = async (authUid: string): Promise<void> => {
    const { error } = await db
        .from(Tables.CLIENT_USERS)
        .update({ last_login: new Date().toISOString() })
        .eq(COLUMNS.AUTH_UID, authUid)

    if (error) throw error
}

/**
 * Lists all active client_users rows for a given client.
 */
const listByClient = async (clientId: string): Promise<ClientUserRow[]> => {
    const { data, error } = await db
        .from(Tables.CLIENT_USERS)
        .select('*')
        .eq(COLUMNS.CLIENT_ID, clientId)
        .eq('active', true)
        .order('invited_at', { ascending: false })

    if (error) throw error
    return (data || []) as ClientUserRow[]
}

/**
 * Finds a single client_users row by id.
 */
const findById = async (id: string): Promise<ClientUserRow | null> => {
    const { data, error } = await db
        .from(Tables.CLIENT_USERS)
        .select('*')
        .eq('id', id)
        .maybeSingle()

    if (error) throw error
    return (data as ClientUserRow) || null
}

export interface InsertClientUserPayload {
    email: string
    role: CmsRole
    client_id: string
    display_name?: string | null
    invited_by?: string | null
}

/**
 * Inserts a new client_users assignment. `auth_uid` stays null until the
 * invited user signs in via Google OAuth and the first-login linking runs.
 */
const insert = async (
    payload: InsertClientUserPayload
): Promise<ClientUserRow> => {
    const { data, error } = await db
        .from(Tables.CLIENT_USERS)
        .insert([
            {
                email: payload.email.toLowerCase(),
                role: payload.role,
                client_id: payload.client_id,
                display_name: payload.display_name ?? null,
                invited_by: payload.invited_by ?? null,
                active: true,
            },
        ])
        .select()
        .single()

    if (error) {
        // Postgres unique-violation — surface as 409 Conflict so the
        // controller can return a friendly error.
        if ((error as { code?: string }).code === '23505') {
            throw {
                status: 409,
                message: 'User already invited to this client',
            }
        }
        throw error
    }
    return data as ClientUserRow
}

/**
 * Updates the role of a client_users row.
 */
const updateRole = async (
    id: string,
    role: CmsRole
): Promise<ClientUserRow> => {
    const { data, error } = await db
        .from(Tables.CLIENT_USERS)
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data as ClientUserRow
}

/**
 * Soft-deletes a client_users row by setting active = false.
 */
const deactivate = async (id: string): Promise<ClientUserRow> => {
    const { data, error } = await db
        .from(Tables.CLIENT_USERS)
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data as ClientUserRow
}

/**
 * Finds an existing assignment row (active OR inactive) for the given
 * email and client combination. Used by invite to detect rows that
 * should be reactivated rather than re-inserted.
 */
const findByEmailAndClient = async (
    email: string,
    clientId: string
): Promise<ClientUserRow | null> => {
    const { data, error } = await db
        .from(Tables.CLIENT_USERS)
        .select('*')
        .eq('email', email.toLowerCase())
        .eq(COLUMNS.CLIENT_ID, clientId)
        .maybeSingle()

    if (error) throw error
    return (data as ClientUserRow) || null
}

/**
 * Reactivates a soft-deleted client_users row by setting active = true.
 */
const reactivate = async (id: string): Promise<ClientUserRow> => {
    const { data, error } = await db
        .from(Tables.CLIENT_USERS)
        .update({ active: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data as ClientUserRow
}

export default {
    findByAuthUid,
    findUnlinkedByEmail,
    linkAuthUid,
    resolveAssignments,
    updateLastLogin,
    listByClient,
    findById,
    insert,
    updateRole,
    deactivate,
    findByEmailAndClient,
    reactivate,
}
