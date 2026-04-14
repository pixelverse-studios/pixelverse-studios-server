import jwt from 'jsonwebtoken'

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

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || ''
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const EXPECTED_AUDIENCE = 'authenticated'

const getExpectedIssuer = (): string => {
    if (!SUPABASE_URL) return ''
    return `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1`
}

/**
 * Verifies a Supabase Auth JWT locally using the project's JWT secret.
 * Returns the user's auth uid and lowercased email.
 *
 * Enforces:
 * - HS256 algorithm (Supabase shared-secret JWTs)
 * - audience = 'authenticated'
 * - issuer = <SUPABASE_URL>/auth/v1
 * - email_verified = true (prevents account hijacking via unverified email)
 *
 * Throws AuthConfigError if SUPABASE_JWT_SECRET or SUPABASE_URL are missing.
 * Throws Error for any token validation failure.
 *
 * NOTE: This assumes Supabase HS256 (shared-secret) JWTs. If the project
 * migrates to asymmetric signing keys (RS256/ES256), this needs updating.
 */
export const verifySupabaseToken = (token: string): SupabaseAuthUser => {
    if (!SUPABASE_JWT_SECRET) {
        throw new AuthConfigError('SUPABASE_JWT_SECRET is not configured')
    }
    if (!SUPABASE_URL) {
        throw new AuthConfigError('SUPABASE_URL is not configured')
    }

    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, {
        algorithms: ['HS256'],
        audience: EXPECTED_AUDIENCE,
        issuer: getExpectedIssuer(),
        clockTolerance: 5,
    }) as jwt.JwtPayload

    const uid = decoded.sub
    const email = decoded.email

    if (typeof uid !== 'string' || !uid) {
        throw new Error('Invalid token: missing sub claim')
    }
    if (typeof email !== 'string' || !email) {
        throw new Error('Invalid token: missing email claim')
    }

    // Verify email is verified (prevents hijacking via unverified Supabase signups).
    // Supabase places this claim at the top level for verified users; some flows
    // also nest it under user_metadata.
    const topLevelVerified = decoded.email_verified === true
    const metadataVerified =
        decoded.user_metadata &&
        typeof decoded.user_metadata === 'object' &&
        (decoded.user_metadata as Record<string, unknown>).email_verified === true

    if (!topLevelVerified && !metadataVerified) {
        throw new Error('Invalid token: email not verified')
    }

    return {
        uid,
        email: email.toLowerCase(),
    }
}
