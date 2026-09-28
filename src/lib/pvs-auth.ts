import 'dotenv/config'
import { createTimedFetch } from './timed-fetch'

export const DEFAULT_PVS_AUTH_TIMEOUT_MS = 2_500

const pvsAuthTimeoutMs = (): number => {
    const configured = Number(process.env.PVS_AUTH_TIMEOUT_MS)
    return Number.isFinite(configured) &&
        configured >= 500 &&
        configured <= 10_000
        ? configured
        : DEFAULT_PVS_AUTH_TIMEOUT_MS
}

export class PvsAuthRequestError extends Error {
    constructor(public readonly status: number) {
        super('PVS authentication request failed')
        this.name = 'PvsAuthRequestError'
    }
}

export type PvsVerifiedUser = { id: string; email: string }

const isVerifiedUser = (value: unknown): value is PvsVerifiedUser => {
    if (!value || typeof value !== 'object') return false
    const user = value as Record<string, unknown>
    return (
        typeof user.id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            user.id
        ) &&
        typeof user.email === 'string' &&
        user.email.trim().length > 0
    )
}

export const verifyPvsAccessToken = async (
    accessToken: string,
    baseFetch: typeof fetch = (input, init) => globalThis.fetch(input, init)
): Promise<PvsVerifiedUser | null> => {
    const supabaseUrl = process.env.SUPABASE_URL || ''
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    if (!supabaseUrl || !supabaseServiceRoleKey) {
        throw new PvsAuthRequestError(503)
    }

    const response = await createTimedFetch(baseFetch, pvsAuthTimeoutMs())(
        `${supabaseUrl}/rest/v1/rpc/verify_pvs_dashboard_actor`,
        {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                apikey: supabaseServiceRoleKey,
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: '{}'
        }
    )

    if (response.status === 401 || response.status === 403) {
        throw new PvsAuthRequestError(response.status)
    }
    if (!response.ok) throw new PvsAuthRequestError(503)

    const user: unknown = await response.json()
    return isVerifiedUser(user) ? user : null
}
