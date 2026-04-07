import crypto from 'crypto'
import { Request, Response } from 'express'
import rateLimit, { Options } from 'express-rate-limit'

import 'dotenv/config'

const ONE_MINUTE = 60 * 1000
const FIVE_MINUTES = 5 * 60 * 1000

// Disable rate limiting in development to avoid friction during local testing.
// Production uses real limits.
const isDevelopment =
    (process.env.NODE_ENVIRONMENT || '').trim().toLowerCase() === 'development'

/**
 * Skips rate limiting for trusted internal service-to-service calls
 * authenticated via X-Blast-Secret. Email blast and Domani endpoints
 * are called by other PVS services and should not count against any
 * shared per-IP quota.
 *
 * Uses crypto.timingSafeEqual to match the existing requireBlastSecret
 * middleware (timing-attack resistant).
 */
const skipBlastSecret = (req: Request): boolean => {
    const secret = process.env.BLAST_SECRET?.trim()
    if (!secret) return false
    const header = req.headers['x-blast-secret']
    if (typeof header !== 'string') return false
    if (header.length !== secret.length) return false
    try {
        return crypto.timingSafeEqual(
            Buffer.from(header),
            Buffer.from(secret)
        )
    } catch {
        return false
    }
}

/**
 * Returns the global skip predicate applied to every limiter:
 * - Bypass in development (no rate limiting locally)
 * - Bypass for internal service-to-service calls (X-Blast-Secret)
 *
 * Note: We use `skip` for the development bypass instead of `max: 0`
 * because in express-rate-limit v7+, `max: 0` BLOCKS all requests
 * rather than disabling the limiter.
 */
const baseSkip = (req: Request): boolean => {
    if (isDevelopment) return true
    return skipBlastSecret(req)
}

/**
 * Returns a rate-limit key tied to the authenticated user when present,
 * falling back to the request IP. The auth-keyed limiters are mounted
 * AFTER requireAuth in route definitions, so req.authUser.uid is set by
 * the time this runs and rate limiting is per-user (not per-IP).
 *
 * Fails closed: throws if neither uid nor IP is available, which causes
 * express-rate-limit's handler to surface a 500 — better than silently
 * grouping all such requests into a single shared bucket.
 */
const userOrIpKey = (req: Request): string => {
    const key = req.authUser?.uid || req.ip
    if (!key) {
        throw new Error('rate-limit key unavailable: no auth uid and no req.ip')
    }
    return key
}

const handler = (
    _req: Request,
    res: Response,
    _next: unknown,
    options: Options
) => {
    const retryAfterSeconds = Math.ceil(options.windowMs / 1000)
    res.setHeader('Retry-After', String(retryAfterSeconds))
    res.status(429).json({
        error: 'Too many requests',
        retryAfter: retryAfterSeconds,
    })
}

const baseConfig = {
    standardHeaders: true,
    legacyHeaders: false,
    skip: baseSkip,
    handler,
}

/**
 * Public endpoints (no auth) — generous to accommodate client websites
 * fetching published content. Keyed by IP.
 */
export const publicReadLimit = rateLimit({
    ...baseConfig,
    windowMs: ONE_MINUTE,
    max: 120,
})

/**
 * Authenticated read endpoints — higher cap since the user is known
 * and we can attribute usage. MUST be mounted after requireAuth so
 * keying happens by auth uid (per-user) rather than IP.
 */
export const authReadLimit = rateLimit({
    ...baseConfig,
    windowMs: ONE_MINUTE,
    max: 300,
    keyGenerator: userOrIpKey,
})

/**
 * Authenticated write endpoints — moderate cap to protect the DB
 * from runaway scripts or abuse. MUST be mounted after requireAuth.
 */
export const authWriteLimit = rateLimit({
    ...baseConfig,
    windowMs: ONE_MINUTE,
    max: 30,
    keyGenerator: userOrIpKey,
})

/**
 * Privileged operations — strict cap. User invites, role changes,
 * template create/delete, user removal. MUST be mounted after requireAuth.
 */
export const sensitiveWriteLimit = rateLimit({
    ...baseConfig,
    windowMs: FIVE_MINUTES,
    max: 10,
    keyGenerator: userOrIpKey,
})

/**
 * Catch-all default applied at the app level for non-CMS routes.
 * Loose enough not to interfere with normal traffic but tight enough
 * to blunt simple flooding attacks. Keyed by IP.
 *
 * Skips:
 * - Development environment
 * - Internal service-to-service calls (X-Blast-Secret)
 * - All /api/cms/* routes (they have their own per-tier limiters)
 */
export const generalApiLimit = rateLimit({
    ...baseConfig,
    windowMs: ONE_MINUTE,
    max: 200,
    skip: (req: Request) => {
        if (baseSkip(req)) return true
        if (req.path === '/api/cms' || req.path.startsWith('/api/cms/')) {
            return true
        }
        return false
    },
})
