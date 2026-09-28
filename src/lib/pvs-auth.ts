import { createClient } from '@supabase/supabase-js'

import 'dotenv/config'
import { createTimedFetch } from './timed-fetch'

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

const pvsAuthClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
    },
    global: {
        fetch: createTimedFetch(
            (input, init) => globalThis.fetch(input, init),
            pvsAuthTimeoutMs()
        )
    }
})

export const pvsAuth = pvsAuthClient.auth
