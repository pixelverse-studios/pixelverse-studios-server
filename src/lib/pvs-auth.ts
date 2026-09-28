import { createClient } from '@supabase/supabase-js'

import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const DEFAULT_PVS_AUTH_TIMEOUT_MS = 2_500

const pvsAuthTimeoutMs = (): number => {
    const configured = Number(process.env.PVS_AUTH_TIMEOUT_MS)
    return Number.isFinite(configured) &&
        configured >= 500 &&
        configured <= 10_000
        ? configured
        : DEFAULT_PVS_AUTH_TIMEOUT_MS
}

export const createTimedFetch =
    (baseFetch: typeof fetch, timeoutMs = pvsAuthTimeoutMs()): typeof fetch =>
    async (input, init = {}) => {
        const controller = new AbortController()
        const upstreamSignal = init.signal
        const abortFromUpstream = () => controller.abort()

        if (upstreamSignal?.aborted) controller.abort()
        else
            upstreamSignal?.addEventListener('abort', abortFromUpstream, {
                once: true
            })

        const timeout = setTimeout(() => controller.abort(), timeoutMs)
        try {
            return await baseFetch(input, {
                ...init,
                signal: controller.signal
            })
        } finally {
            clearTimeout(timeout)
            upstreamSignal?.removeEventListener('abort', abortFromUpstream)
        }
    }

const pvsAuthClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
    },
    global: {
        fetch: createTimedFetch((input, init) => globalThis.fetch(input, init))
    }
})

export const pvsAuth = pvsAuthClient.auth
