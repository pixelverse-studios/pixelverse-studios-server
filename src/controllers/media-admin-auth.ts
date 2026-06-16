import { Request, Response } from 'express'
import { parse, serialize } from 'cookie'
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
    message: 'If that email is approved, a sign-in link has been sent.',
}

const cookieOptions = (maxAgeSeconds: number) => ({
    httpOnly: true,
    secure: isProductionEnvironment(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
})

const waitForMinimumResponseTime = async (startedAt: number): Promise<void> => {
    const remaining = requestMinResponseMs() - (Date.now() - startedAt)
    if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining))
    }
}

const createAndSendMagicLink = async (
    email: string,
    requestedIp?: string,
    userAgent?: string,
    requestId?: string
): Promise<void> => {
    try {
        const token = generateToken(MAGIC_LINK_TOKEN_BYTES)
        await authService.createMagicLink({
            email,
            tokenHash: hashToken(token),
            expiresAt: expiresInMinutes(magicLinkTtlMinutes()),
            requestedIp,
            userAgent,
        })

        await sendMediaAdminMagicLink(email, buildMagicLinkUrl(token))
        console.log('Media admin magic-link job completed:', {
            requestId,
            email,
        })
    } catch (err) {
        console.error('Media admin magic-link job failed:', {
            requestId,
            email,
            error: err,
        })
    }
}

const queueMagicLinkJob = (
    email: string,
    requestedIp?: string,
    userAgent?: string,
    requestId?: string
): Promise<void> | void => {
    if (process.env.NODE_ENV === 'test') {
        return createAndSendMagicLink(email, requestedIp, userAgent, requestId)
    }

    setImmediate(() => {
        void createAndSendMagicLink(email, requestedIp, userAgent, requestId)
    })
}

const requestMagicLink = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const startedAt = Date.now()
    try {
        const parsed = requestMagicLinkSchema.parse(req.body)
        const email = normalizeAdminEmail(parsed.email)

        if (isApprovedAdminEmail(email)) {
            const magicLinkJob = queueMagicLinkJob(
                email,
                req.ip,
                req.get('user-agent'),
                req.requestId
            )
            if (magicLinkJob) {
                await magicLinkJob
            }
        }

        await waitForMinimumResponseTime(startedAt)

        return res.status(200).json(genericResponse)
    } catch (err) {
        if (err instanceof ZodError) {
            return res.status(400).json({
                error: 'Invalid payload',
                details: err.flatten(),
            })
        }
        console.error('Media admin magic-link request failed:', {
            requestId: req.requestId,
            error: err,
        })
        await waitForMinimumResponseTime(startedAt)
        return res.status(200).json(genericResponse)
    }
}

const callback = async (req: Request, res: Response): Promise<Response> => {
    try {
        const parsed = callbackSchema.parse(req.body)
        const magicLink = await authService.findMagicLinkByHash(
            hashToken(parsed.token)
        )

        if (!magicLink) {
            return res.status(401).json({ error: 'Invalid sign-in link' })
        }
        if (magicLink.used_at) {
            return res.status(410).json({ error: 'Sign-in link already used' })
        }
        if (new Date(magicLink.expires_at).getTime() <= Date.now()) {
            return res.status(410).json({ error: 'Sign-in link expired' })
        }
        if (!isApprovedAdminEmail(magicLink.email)) {
            return res.status(403).json({ error: 'Unauthorized' })
        }

        const claimedMagicLink = await authService.markMagicLinkUsed(
            magicLink.id
        )
        if (!claimedMagicLink) {
            return res.status(410).json({ error: 'Sign-in link already used' })
        }

        const sessionToken = generateToken(SESSION_TOKEN_BYTES)
        const sessionExpiresAt = expiresInHours(sessionTtlHours())
        await authService.createSession({
            email: magicLink.email,
            sessionHash: hashToken(sessionToken),
            expiresAt: sessionExpiresAt,
        })

        res.setHeader(
            'Set-Cookie',
            serialize(
                MEDIA_ADMIN_SESSION_COOKIE,
                sessionToken,
                cookieOptions(sessionTtlHours() * 60 * 60)
            )
        )

        return res.status(200).json({
            email: magicLink.email,
            expiresAt: sessionExpiresAt.toISOString(),
        })
    } catch (err) {
        if (err instanceof ZodError) {
            return res.status(400).json({
                error: 'Invalid payload',
                details: err.flatten(),
            })
        }
        return handleGenericError(err, res)
    }
}

const getSession = async (req: Request, res: Response): Promise<Response> => {
    const admin = req.mediaAdmin
    if (!admin) {
        return res.status(401).json({ error: 'Authentication required' })
    }

    return res.status(200).json({
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
