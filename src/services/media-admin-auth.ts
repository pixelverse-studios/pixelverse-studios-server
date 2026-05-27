import { db, Tables } from '../lib/db'

export interface CreateMagicLinkPayload {
    email: string
    tokenHash: string
    expiresAt: Date
    requestedIp?: string
    userAgent?: string
}

export interface MagicLinkRecord {
    id: string
    email: string
    token_hash: string
    requested_ip: string | null
    user_agent: string | null
    expires_at: string
    used_at: string | null
    created_at: string
}

export interface SessionRecord {
    id: string
    email: string
    session_hash: string
    created_at: string
    expires_at: string
    last_seen_at: string | null
    revoked_at: string | null
}

const createMagicLink = async ({
    email,
    tokenHash,
    expiresAt,
    requestedIp,
    userAgent,
}: CreateMagicLinkPayload): Promise<MagicLinkRecord> => {
    const { data, error } = await db
        .from(Tables.MEDIA_ADMIN_MAGIC_LINKS)
        .insert({
            email,
            token_hash: tokenHash,
            requested_ip: requestedIp ?? null,
            user_agent: userAgent ?? null,
            expires_at: expiresAt.toISOString(),
        })
        .select()
        .single()

    if (error) throw error
    return data as MagicLinkRecord
}

const findMagicLinkByHash = async (
    tokenHash: string
): Promise<MagicLinkRecord | null> => {
    const { data, error } = await db
        .from(Tables.MEDIA_ADMIN_MAGIC_LINKS)
        .select('*')
        .eq('token_hash', tokenHash)
        .maybeSingle()

    if (error) throw error
    return data as MagicLinkRecord | null
}

const markMagicLinkUsed = async (id: string): Promise<boolean> => {
    const { data, error } = await db
        .from(Tables.MEDIA_ADMIN_MAGIC_LINKS)
        .update({ used_at: new Date().toISOString() })
        .eq('id', id)
        .is('used_at', null)
        .select('id')
        .maybeSingle()

    if (error) throw error
    return Boolean(data)
}

const createSession = async ({
    email,
    sessionHash,
    expiresAt,
}: {
    email: string
    sessionHash: string
    expiresAt: Date
}): Promise<SessionRecord> => {
    const { data, error } = await db
        .from(Tables.MEDIA_ADMIN_SESSIONS)
        .insert({
            email,
            session_hash: sessionHash,
            expires_at: expiresAt.toISOString(),
        })
        .select()
        .single()

    if (error) throw error
    return data as SessionRecord
}

const findSessionByHash = async (
    sessionHash: string
): Promise<SessionRecord | null> => {
    const { data, error } = await db
        .from(Tables.MEDIA_ADMIN_SESSIONS)
        .select('*')
        .eq('session_hash', sessionHash)
        .maybeSingle()

    if (error) throw error
    return data as SessionRecord | null
}

const touchSession = async (id: string): Promise<void> => {
    const { error } = await db
        .from(Tables.MEDIA_ADMIN_SESSIONS)
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', id)

    if (error) throw error
}

const revokeSession = async (sessionHash: string): Promise<void> => {
    const { error } = await db
        .from(Tables.MEDIA_ADMIN_SESSIONS)
        .update({ revoked_at: new Date().toISOString() })
        .eq('session_hash', sessionHash)
        .is('revoked_at', null)

    if (error) throw error
}

export default {
    createMagicLink,
    findMagicLinkByHash,
    markMagicLinkUsed,
    createSession,
    findSessionByHash,
    touchSession,
    revokeSession,
}
