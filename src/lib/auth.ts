import { createClient, User } from '@supabase/supabase-js'

import 'dotenv/config'

export interface SupabaseAuthUser {
    uid: string
    email: string
}

/**
 * Custom error class for missing/invalid configuration. Distinguishes
 * server misconfiguration (500) from invalid tokens (401).
 */
export class AuthConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'AuthConfigError'
    }
}

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const EXPECTED_AUDIENCE = 'authenticated'
let authClient: ReturnType<typeof createClient> | null = null

const getAuthClient = () => {
    if (!SUPABASE_URL) {
        throw new AuthConfigError('SUPABASE_URL is not configured')
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        throw new AuthConfigError('SUPABASE_SERVICE_ROLE_KEY is not configured')
    }

    if (!authClient) {
        authClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false,
            },
        })
    }

    return authClient
}

const isEmailVerified = (user: User): boolean => {
    if (typeof user.email_confirmed_at === 'string' && user.email_confirmed_at) {
        return true
    }

    return user.user_metadata?.email_verified === true
}

/**
 * Verifies a Supabase Auth JWT using the project's Auth server.
 * Returns the user's auth uid and lowercased email.
 *
 * Enforces:
 * - token is valid according to Supabase Auth
 * - email is present
 * - email is verified (prevents hijacking via unverified signups)
 *
 * Throws AuthConfigError if required Supabase config is missing.
 * Throws Error for any token validation failure.
 */
export const verifySupabaseToken = async (
    token: string
): Promise<SupabaseAuthUser> => {
    const { data, error } = await getAuthClient().auth.getUser(token)
    if (error) {
        throw new Error(`Invalid token: ${error.message}`)
    }

    const user = data.user
    if (!user) {
        throw new Error('Invalid token: user not found')
    }

    if (user.aud !== EXPECTED_AUDIENCE) {
        throw new Error('Invalid token: unexpected audience')
    }

    if (typeof user.email !== 'string' || !user.email) {
        throw new Error('Invalid token: missing email claim')
    }

    if (!isEmailVerified(user)) {
        throw new Error('Invalid token: email not verified')
    }

    return {
        uid: user.id,
        email: user.email.toLowerCase(),
    }
}
