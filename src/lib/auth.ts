import jwt from 'jsonwebtoken'

import 'dotenv/config'

export interface SupabaseAuthUser {
    uid: string
    email: string
}

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || ''

/**
 * Verifies a Supabase Auth JWT locally using the project's JWT secret.
 * Returns the user's auth uid and lowercased email.
 * Throws if the token is invalid, expired, or missing required claims.
 */
export const verifySupabaseToken = (token: string): SupabaseAuthUser => {
    if (!SUPABASE_JWT_SECRET) {
        throw new Error('SUPABASE_JWT_SECRET is not configured')
    }

    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, {
        algorithms: ['HS256'],
    }) as jwt.JwtPayload

    const uid = decoded.sub
    const email = decoded.email

    if (typeof uid !== 'string' || !uid) {
        throw new Error('Invalid token: missing sub claim')
    }
    if (typeof email !== 'string' || !email) {
        throw new Error('Invalid token: missing email claim')
    }

    return {
        uid,
        email: email.toLowerCase(),
    }
}
