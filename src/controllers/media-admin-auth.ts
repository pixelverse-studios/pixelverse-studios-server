import { Request, Response } from 'express'
import { parse, serialize } from 'cookie'
import crypto from 'crypto'
import { z, ZodError } from 'zod'

import authService from '../services/media-admin-auth'
import {
    buildMagicLinkUrl,
    expiresInHours,
    expiresInMinutes,
    generateToken,
    hashToken,
    isProductionEnvironment,
    isApprovedAdminEmail,
    MAGIC_LINK_TOKEN_BYTES,
    magicLinkClockSkewSeconds,
    magicLinkRateLimitSeconds,
    magicLinkRequestCooldownSeconds,
    magicLinkTtlMinutes,
    MEDIA_ADMIN_SESSION_COOKIE,
    normalizeAdminEmail,
    requestMinResponseMs,
    sendMediaAdminMagicLink,
    SESSION_TOKEN_BYTES,
    sessionTtlHours,
} from '../lib/media-admin-auth'
import { handleGenericError } from '../utils/http'

const requestMagicLinkSchema = z.object({
    email: z.string().email().max(254),
})

const callbackSchema = z.object({
    token: z.string().min(20).max(500),
})

const genericResponse = {
    ok: true,
    status: 'sent',
    message: 'If that email is approved, a sign-in link has been sent.',
}

const cookieSameSite = (): 'lax' | 'strict' | 'none' => {
    const configured = process.env.MEDIA_ADMIN_COOKIE_SAME_SITE?.trim().toLowerCase()
    if (configured === 'strict' || configured === 'none') return configured
    return 'lax'
}

const cookieOptions = (maxAgeSeconds: number) => ({
    httpOnly: true,
    secure: isProductionEnvironment() || cookieSameSite() === 'none',
    sameSite: cookieSameSite(),
    path: '/',
    maxAge: maxAgeSeconds,
    ...(process.env.MEDIA_ADMIN_COOKIE_DOMAIN?.trim() && {
        domain: process.env.MEDIA_ADMIN_COOKIE_DOMAIN.trim(),
    }),
})

const requestIdFor = (req: Request): string => {
    const header = req.headers['x-request-id']
    return typeof header === 'string' && header.trim()
        ? header.trim()
        : crypto.randomUUID()
}

const logAuthEvent = (
    level: 'info' | 'warn' | 'error',
    event: string,
    fields: Record<string, unknown>
): void => {
    console[level](`Media admin auth ${event}`, fields)
}

const sendAuthError = (
    res: Response,
    status: number,
    code: string,
    message: string,
    requestId: string,
    details?: Record<string, unknown>
): Response =>
    res.status(status).json({
        ok: false,
        error: {
            code,
            message,
            requestId,
            ...(details && { details }),
        },
    })

const sendGenericMagicLinkResponse = async (
    res: Response,
    startedAt: number
): Promise<Response> => {
    await waitForMinimumResponseTime(startedAt)
    return res.status(200).json(genericResponse)
}

const waitForMinimumResponseTime = async (startedAt: number): Promise<void> => {
    const remaining = requestMinResponseMs() - (Date.now() - startedAt)
    if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining))
    }
}

class MagicLinkProviderError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'MagicLinkProviderError'
    }
}

const createAndSendMagicLink = async (
    email: string,
    requestedIp?: string,
    userAgent?: string,
): Promise<{ magicLinkId: string; expiresAt: string }> => {
    const token = generateToken(MAGIC_LINK_TOKEN_BYTES)
    const magicLink = await authService.createMagicLink({
        email,
        tokenHash: hashToken(token),
        expiresAt: expiresInMinutes(magicLinkTtlMinutes()),
        requestedIp,
        userAgent,
    })

    try {
        await sendMediaAdminMagicLink(email, buildMagicLinkUrl(token))
    } catch (err) {
        await authService.deleteMagicLink(magicLink.id).catch(cleanupErr => {
            logAuthEvent('error', 'magic_link_cleanup_failed', {
                magicLinkId: magicLink.id,
                error:
                    cleanupErr instanceof Error
                        ? cleanupErr.message
                        : 'Unknown cleanup error',
            })
        })
        throw new MagicLinkProviderError(
            err instanceof Error ? err.message : 'Unknown provider error'
        )
    }

    return {
        magicLinkId: magicLink.id,
        expiresAt: magicLink.expires_at,
    }
}

const processMagicLinkJob = async (
    email: string,
    requestedIp: string | undefined,
    userAgent: string | undefined,
    requestId: string
): Promise<void> => {
    const startedAt = Date.now()
    try {
        const pending = await authService.findPendingMagicLinkByEmail(email)
        if (pending) {
            const ageMs = Date.now() - new Date(pending.created_at).getTime()
            const cooldownMs = magicLinkRequestCooldownSeconds() * 1000
            if (ageMs <= cooldownMs) {
                logAuthEvent('info', 'magic_link_already_pending', {
                    requestId,
                    email,
                    magicLinkId: pending.id,
                    expiresAt: pending.expires_at,
                    durationMs: Date.now() - startedAt,
                })
                return
            }

            await authService.revokePendingMagicLinksForEmail(email)
        }

        const rateLimitSeconds = magicLinkRateLimitSeconds()
        if (rateLimitSeconds > 0) {
            const latest = await authService.findLatestMagicLinkByEmail(email)
            const latestAgeMs = latest
                ? Date.now() - new Date(latest.created_at).getTime()
                : Number.POSITIVE_INFINITY

            if (latest && latestAgeMs <= rateLimitSeconds * 1000) {
                const retryAfterSeconds = Math.max(
                    1,
                    Math.ceil((rateLimitSeconds * 1000 - latestAgeMs) / 1000)
                )
                logAuthEvent('warn', 'magic_link_rate_limited', {
                    requestId,
                    email,
                    magicLinkId: latest.id,
                    retryAfterSeconds,
                    durationMs: Date.now() - startedAt,
                })
                return
            }
        }

        const result = await createAndSendMagicLink(
            email,
            requestedIp,
            userAgent
        )
        logAuthEvent('info', 'magic_link_sent', {
            requestId,
            email,
            magicLinkId: result.magicLinkId,
            expiresAt: result.expiresAt,
            durationMs: Date.now() - startedAt,
        })
    } catch (err) {
        logAuthEvent('error', 'magic_link_job_failed', {
            requestId,
            email,
            error: err instanceof Error ? err.message : 'Unknown error',
            durationMs: Date.now() - startedAt,
        })
    }
}

const queueMagicLinkJob = (
    email: string,
    requestedIp: string | undefined,
    userAgent: string | undefined,
    requestId: string
): Promise<void> | void => {
    if (process.env.NODE_ENV === 'test') {
        return processMagicLinkJob(email, requestedIp, userAgent, requestId)
    }

    setImmediate(() => {
        void processMagicLinkJob(email, requestedIp, userAgent, requestId)
    })
}

const requestMagicLink = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const startedAt = Date.now()
    const requestId = requestIdFor(req)
    try {
        const parsed = requestMagicLinkSchema.parse(req.body)
        const email = normalizeAdminEmail(parsed.email)
        const approved = isApprovedAdminEmail(email)

        if (!approved) {
            logAuthEvent('info', 'magic_link_unapproved_request', {
                requestId,
                email,
                durationMs: Date.now() - startedAt,
            })
            return sendGenericMagicLinkResponse(res, startedAt)
        }

        const magicLinkJob = queueMagicLinkJob(
            email,
            req.ip,
            req.get('user-agent'),
            requestId
        )
        if (magicLinkJob) {
            await magicLinkJob
        }

        return sendGenericMagicLinkResponse(res, startedAt)
    } catch (err) {
        if (err instanceof ZodError) {
            return sendAuthError(
                res,
                400,
                'media_admin_auth.invalid_payload',
                'Invalid auth payload.',
                requestId,
                err.flatten()
            )
        }
        logAuthEvent('error', 'magic_link_request_failed', {
            requestId,
            error: err instanceof Error ? err.message : 'Unknown error',
            durationMs: Date.now() - startedAt,
        })
        return sendGenericMagicLinkResponse(res, startedAt)
    }
}

const callback = async (req: Request, res: Response): Promise<Response> => {
    const startedAt = Date.now()
    const requestId = requestIdFor(req)
    try {
        const parsed = callbackSchema.parse(req.body)
        const magicLink = await authService.findMagicLinkByHash(
            hashToken(parsed.token)
        )

        if (!magicLink) {
            logAuthEvent('warn', 'callback_invalid_token', {
                requestId,
                durationMs: Date.now() - startedAt,
            })
            return sendAuthError(
                res,
                401,
                'media_admin_auth.invalid_token',
                'Invalid sign-in link.',
                requestId
            )
        }
        if (magicLink.used_at) {
            logAuthEvent('warn', 'callback_reused_token', {
                requestId,
                email: magicLink.email,
                magicLinkId: magicLink.id,
                durationMs: Date.now() - startedAt,
            })
            return sendAuthError(
                res,
                410,
                'media_admin_auth.reused_token',
                'Sign-in link already used.',
                requestId
            )
        }
        const expiresAtMs = new Date(magicLink.expires_at).getTime()
        const expiresWithSkewMs = expiresAtMs + magicLinkClockSkewSeconds() * 1000
        if (expiresWithSkewMs <= Date.now()) {
            logAuthEvent('warn', 'callback_expired_token', {
                requestId,
                email: magicLink.email,
                magicLinkId: magicLink.id,
                expiresAt: magicLink.expires_at,
                durationMs: Date.now() - startedAt,
            })
            return sendAuthError(
                res,
                410,
                'media_admin_auth.expired_token',
                'Sign-in link expired.',
                requestId,
                { expiresAt: magicLink.expires_at }
            )
        }
        if (!isApprovedAdminEmail(magicLink.email)) {
            logAuthEvent('warn', 'callback_unapproved_email', {
                requestId,
                email: magicLink.email,
                magicLinkId: magicLink.id,
                durationMs: Date.now() - startedAt,
            })
            return sendAuthError(
                res,
                403,
                'media_admin_auth.unapproved_email',
                'Unauthorized.',
                requestId
            )
        }

        const claimedMagicLink = await authService.markMagicLinkUsed(
            magicLink.id
        )
        if (!claimedMagicLink) {
            logAuthEvent('warn', 'callback_token_claim_lost', {
                requestId,
                email: magicLink.email,
                magicLinkId: magicLink.id,
                durationMs: Date.now() - startedAt,
            })
            return sendAuthError(
                res,
                410,
                'media_admin_auth.reused_token',
                'Sign-in link already used.',
                requestId
            )
        }

        const sessionToken = generateToken(SESSION_TOKEN_BYTES)
        const sessionExpiresAt = expiresInHours(sessionTtlHours())
        let session
        try {
            session = await authService.createSession({
                email: magicLink.email,
                sessionHash: hashToken(sessionToken),
                expiresAt: sessionExpiresAt,
            })
        } catch (err) {
            await authService.clearMagicLinkUsed(magicLink.id).catch(rollbackErr => {
                logAuthEvent('error', 'callback_token_claim_rollback_failed', {
                    requestId,
                    email: magicLink.email,
                    magicLinkId: magicLink.id,
                    error:
                        rollbackErr instanceof Error
                            ? rollbackErr.message
                            : 'Unknown rollback error',
                    durationMs: Date.now() - startedAt,
                })
            })
            logAuthEvent('error', 'callback_session_creation_failed', {
                requestId,
                email: magicLink.email,
                magicLinkId: magicLink.id,
                error: err instanceof Error ? err.message : 'Unknown error',
                durationMs: Date.now() - startedAt,
            })
            return sendAuthError(
                res,
                503,
                'media_admin_auth.session_creation_failed',
                'Unable to create an authenticated session. Request a new sign-in link.',
                requestId
            )
        }

        res.setHeader(
            'Set-Cookie',
            serialize(
                MEDIA_ADMIN_SESSION_COOKIE,
                sessionToken,
                cookieOptions(sessionTtlHours() * 60 * 60)
            )
        )

        logAuthEvent('info', 'callback_authenticated', {
            requestId,
            email: magicLink.email,
            magicLinkId: magicLink.id,
            sessionId: session.id,
            expiresAt: sessionExpiresAt.toISOString(),
            durationMs: Date.now() - startedAt,
        })

        return res.status(200).json({
            ok: true,
            status: 'authenticated',
            email: magicLink.email,
            expiresAt: sessionExpiresAt.toISOString(),
        })
    } catch (err) {
        if (err instanceof ZodError) {
            return sendAuthError(
                res,
                400,
                'media_admin_auth.invalid_payload',
                'Invalid auth payload.',
                requestId,
                err.flatten()
            )
        }
        logAuthEvent('error', 'callback_failed', {
            requestId,
            error: err instanceof Error ? err.message : 'Unknown error',
            durationMs: Date.now() - startedAt,
        })
        return handleGenericError(err, res)
    }
}

const getSession = async (req: Request, res: Response): Promise<Response> => {
    const admin = req.mediaAdmin
    if (!admin) {
        return res.status(401).json({ error: 'Authentication required' })
    }

    return res.status(200).json({
        ok: true,
        status: 'authenticated',
        email: admin.email,
        expiresAt: admin.expiresAt,
    })
}

const logout = async (req: Request, res: Response): Promise<Response> => {
    try {
        const cookies = parse(req.headers.cookie || '')
        const token =
            req.mediaAdminSessionToken || cookies[MEDIA_ADMIN_SESSION_COOKIE]

        if (token) {
            await authService.revokeSession(hashToken(token))
        }

        res.setHeader(
            'Set-Cookie',
            serialize(MEDIA_ADMIN_SESSION_COOKIE, '', cookieOptions(0))
        )

        return res.status(200).json({ message: 'Logged out' })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { requestMagicLink, callback, getSession, logout }
