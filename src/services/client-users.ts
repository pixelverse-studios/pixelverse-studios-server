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
 * Populates auth_uid on a client_users row (one-time first-login linking).
 * Also sets last_login.
 */
const linkAuthUid = async (id: string, authUid: string): Promise<void> => {
    const { error } = await db
        .from(Tables.CLIENT_USERS)
        .update({
            auth_uid: authUid,
            last_login: new Date().toISOString(),
        })
        .eq('id', id)

    if (error) throw error
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

export default {
    findByAuthUid,
    findUnlinkedByEmail,
    linkAuthUid,
    updateLastLogin,
}
