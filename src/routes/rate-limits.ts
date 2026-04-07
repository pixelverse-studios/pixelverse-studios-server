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
 */
const skipBlastSecret = (req: Request): boolean => {
    const secret = process.env.BLAST_SECRET?.trim()
    if (!secret) return false
    const header = req.headers['x-blast-secret']
    return typeof header === 'string' && header === secret
}

/**
 * Returns a rate-limit key tied to the authenticated user when present,
 * falling back to the request IP. Once auth middleware has run, this
 * limits per-user (so multiple users on a corporate NAT aren't grouped),
 * but pre-auth requests are still IP-bound.
 */
const userOrIpKey = (req: Request): string => {
    return req.authUser?.uid || req.ip || 'unknown'
}

const handler = (_req: Request, res: Response, _next: unknown, options: Options) => {
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
    skip: skipBlastSecret,
    handler,
}

/**
 * Public endpoints (no auth) — generous to accommodate client websites
 * fetching published content. Keyed by IP.
 */
export const publicReadLimit = rateLimit({
    ...baseConfig,
    windowMs: ONE_MINUTE,
    max: isDevelopment ? 0 : 120,
})

/**
 * Authenticated read endpoints — higher cap since the user is known
 * and we can attribute usage. Keyed by auth uid (falls back to IP).
 */
export const authReadLimit = rateLimit({
    ...baseConfig,
    windowMs: ONE_MINUTE,
    max: isDevelopment ? 0 : 300,
    keyGenerator: userOrIpKey,
})

/**
 * Authenticated write endpoints — moderate cap to protect the DB
 * from runaway scripts or abuse. Keyed by auth uid.
 */
export const authWriteLimit = rateLimit({
    ...baseConfig,
    windowMs: ONE_MINUTE,
    max: isDevelopment ? 0 : 30,
    keyGenerator: userOrIpKey,
})

/**
 * Privileged operations — strict cap. User invites, role changes,
 * template create/delete, user removal. Keyed by auth uid.
 */
export const sensitiveWriteLimit = rateLimit({
    ...baseConfig,
    windowMs: FIVE_MINUTES,
    max: isDevelopment ? 0 : 10,
    keyGenerator: userOrIpKey,
})

/**
 * Catch-all default applied at the app level for non-CMS routes.
 * Loose enough not to interfere with normal traffic but tight enough
 * to blunt simple flooding attacks. Keyed by IP.
 *
 * Skips:
 * - Internal service-to-service calls (X-Blast-Secret)
 * - All /api/cms/* routes (they have their own per-tier limiters)
 */
export const generalApiLimit = rateLimit({
    ...baseConfig,
    windowMs: ONE_MINUTE,
    max: isDevelopment ? 0 : 200,
    skip: (req: Request) => {
        if (skipBlastSecret(req)) return true
        if (req.path.startsWith('/api/cms/')) return true
        return false
    },
})
