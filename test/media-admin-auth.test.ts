import { Request, Response } from 'express'
import { serialize } from 'cookie'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import mediaAdminAuthController from '../src/controllers/media-admin-auth'
import { requireMediaAdminSession } from '../src/routes/middleware'
import mediaAdminAuthService from '../src/services/media-admin-auth'
import { sendEmail } from '../src/lib/mailer'
import {
    hashToken,
    MEDIA_ADMIN_SESSION_COOKIE,
} from '../src/lib/media-admin-auth'

const validCallbackToken = 'valid-token-1234567890'
const validSessionToken = 'session-token-1234567890'

vi.mock('../src/services/media-admin-auth', () => ({
    default: {
        createMagicLink: vi.fn(),
        findMagicLinkByHash: vi.fn(),
        markMagicLinkUsed: vi.fn(),
        createSession: vi.fn(),
        findSessionByHash: vi.fn(),
        touchSession: vi.fn(),
        revokeSession: vi.fn(),
    },
}))

vi.mock('../src/lib/mailer', () => ({
    sendEmail: vi.fn(),
}))

const createResponse = () => {
    const res = {
        status: vi.fn(),
        json: vi.fn(),
        setHeader: vi.fn(),
    }
    res.status.mockReturnValue(res)
    res.json.mockReturnValue(res)
    return res as unknown as Response & {
        status: ReturnType<typeof vi.fn>
        json: ReturnType<typeof vi.fn>
        setHeader: ReturnType<typeof vi.fn>
    }
}

const createRequest = ({
    body = {},
    headers = {},
    ip = '127.0.0.1',
}: {
    body?: unknown
    headers?: Record<string, string>
    ip?: string
}): Request =>
    ({
        body,
        headers,
        ip,
        get: (name: string) => headers[name.toLowerCase()],
    }) as unknown as Request

const validMagicLink = {
    id: 'magic-link-1',
    email: 'jenn@example.com',
    token_hash: hashToken(validCallbackToken),
    requested_ip: '127.0.0.1',
    user_agent: 'vitest',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    used_at: null,
    created_at: new Date().toISOString(),
}

const validSession = {
    id: 'session-1',
    email: 'jenn@example.com',
    session_hash: hashToken(validSessionToken),
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    last_seen_at: null,
    revoked_at: null,
}

describe('media admin auth controller', () => {
    beforeEach(() => {
        process.env.MEDIA_ADMIN_EMAILS = 'jenn@example.com,phil@example.com'
        process.env.MEDIA_ADMIN_APP_BASE_URL = 'https://ifferspictures.com'
        process.env.MEDIA_ADMIN_MAGIC_LINK_TTL_MINUTES = '15'
        process.env.MEDIA_ADMIN_SESSION_TTL_HOURS = '12'
        process.env.MEDIA_ADMIN_REQUEST_MIN_RESPONSE_MS = '0'
        vi.mocked(sendEmail).mockResolvedValue(undefined)
        vi.mocked(mediaAdminAuthService.createMagicLink).mockResolvedValue(
            validMagicLink
        )
        vi.mocked(mediaAdminAuthService.markMagicLinkUsed).mockResolvedValue(
            true
        )
        vi.mocked(mediaAdminAuthService.createSession).mockResolvedValue(
            validSession
        )
        vi.mocked(mediaAdminAuthService.revokeSession).mockResolvedValue(
            undefined
        )
    })

    it('does not leak whether an email is approved', async () => {
        const res = createResponse()

        await mediaAdminAuthController.requestMagicLink(
            createRequest({ body: { email: 'unknown@example.com' } }),
            res
        )

        expect(res.status).toHaveBeenCalledWith(200)
        expect(res.json).toHaveBeenCalledWith({
            message: 'If that email is approved, a sign-in link has been sent.',
        })
        expect(mediaAdminAuthService.createMagicLink).not.toHaveBeenCalled()
        expect(sendEmail).not.toHaveBeenCalled()
    })

    it('creates and sends a magic link for approved admins', async () => {
        const res = createResponse()

        await mediaAdminAuthController.requestMagicLink(
            createRequest({
                body: { email: 'Jenn@Example.com' },
                headers: { 'user-agent': 'vitest' },
            }),
            res
        )

        expect(mediaAdminAuthService.createMagicLink).toHaveBeenCalledWith(
            expect.objectContaining({
                email: 'jenn@example.com',
                requestedIp: '127.0.0.1',
                userAgent: 'vitest',
            })
        )
        expect(sendEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'jenn@example.com',
                subject: "Your Iffer's Pictures media manager sign-in link",
            })
        )
        expect(res.status).toHaveBeenCalledWith(200)
    })

    it('does not leak send failures through the magic-link response', async () => {
        vi.mocked(sendEmail).mockRejectedValue(new Error('send failed'))
        const res = createResponse()

        await mediaAdminAuthController.requestMagicLink(
            createRequest({ body: { email: 'jenn@example.com' } }),
            res
        )

        expect(res.status).toHaveBeenCalledWith(200)
        expect(res.json).toHaveBeenCalledWith({
            message: 'If that email is approved, a sign-in link has been sent.',
        })
        expect(mediaAdminAuthService.createSession).not.toHaveBeenCalled()
    })

    it('does not leak persistence failures through the magic-link response', async () => {
        vi.mocked(mediaAdminAuthService.createMagicLink).mockRejectedValue(
            new Error('database unavailable')
        )
        const res = createResponse()

        await mediaAdminAuthController.requestMagicLink(
            createRequest({ body: { email: 'jenn@example.com' } }),
            res
        )

        expect(res.status).toHaveBeenCalledWith(200)
        expect(res.json).toHaveBeenCalledWith({
            message: 'If that email is approved, a sign-in link has been sent.',
        })
        expect(sendEmail).not.toHaveBeenCalled()
    })

    it('rejects invalid callback tokens', async () => {
        vi.mocked(mediaAdminAuthService.findMagicLinkByHash).mockResolvedValue(
            null
        )
        const res = createResponse()

        await mediaAdminAuthController.callback(
            createRequest({ body: { token: 'valid-looking-invalid-token' } }),
            res
        )

        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid sign-in link' })
    })

    it('rejects already-used callback tokens', async () => {
        vi.mocked(mediaAdminAuthService.findMagicLinkByHash).mockResolvedValue({
            ...validMagicLink,
            used_at: new Date().toISOString(),
        })
        const res = createResponse()

        await mediaAdminAuthController.callback(
            createRequest({ body: { token: validCallbackToken } }),
            res
        )

        expect(res.status).toHaveBeenCalledWith(410)
        expect(res.json).toHaveBeenCalledWith({
            error: 'Sign-in link already used',
        })
    })

    it('rejects expired callback tokens', async () => {
        vi.mocked(mediaAdminAuthService.findMagicLinkByHash).mockResolvedValue({
            ...validMagicLink,
            expires_at: new Date(Date.now() - 60_000).toISOString(),
        })
        const res = createResponse()

        await mediaAdminAuthController.callback(
            createRequest({ body: { token: validCallbackToken } }),
            res
        )

        expect(res.status).toHaveBeenCalledWith(410)
        expect(res.json).toHaveBeenCalledWith({
            error: 'Sign-in link expired',
        })
    })

    it('creates an HTTP-only session cookie for a valid callback token', async () => {
        vi.mocked(mediaAdminAuthService.findMagicLinkByHash).mockResolvedValue(
            validMagicLink
        )
        const res = createResponse()

        await mediaAdminAuthController.callback(
            createRequest({ body: { token: validCallbackToken } }),
            res
        )

        expect(mediaAdminAuthService.markMagicLinkUsed).toHaveBeenCalledWith(
            validMagicLink.id
        )
        expect(mediaAdminAuthService.createSession).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'jenn@example.com' })
        )
        expect(res.setHeader).toHaveBeenCalledWith(
            'Set-Cookie',
            expect.stringContaining(`${MEDIA_ADMIN_SESSION_COOKIE}=`)
        )
        expect(res.setHeader.mock.calls[0][1]).toContain('HttpOnly')
        expect(res.status).toHaveBeenCalledWith(200)
    })

    it('sets a secure session cookie when NODE_ENVIRONMENT is production', async () => {
        process.env.NODE_ENVIRONMENT = 'production'
        vi.mocked(mediaAdminAuthService.findMagicLinkByHash).mockResolvedValue(
            validMagicLink
        )
        const res = createResponse()

        await mediaAdminAuthController.callback(
            createRequest({ body: { token: validCallbackToken } }),
            res
        )

        expect(res.setHeader.mock.calls[0][1]).toContain('Secure')
    })

    it('rejects a callback token when the one-time claim loses a race', async () => {
        vi.mocked(mediaAdminAuthService.findMagicLinkByHash).mockResolvedValue(
            validMagicLink
        )
        vi.mocked(mediaAdminAuthService.markMagicLinkUsed).mockResolvedValue(
            false
        )
        const res = createResponse()

        await mediaAdminAuthController.callback(
            createRequest({ body: { token: validCallbackToken } }),
            res
        )

        expect(mediaAdminAuthService.createSession).not.toHaveBeenCalled()
        expect(res.status).toHaveBeenCalledWith(410)
        expect(res.json).toHaveBeenCalledWith({
            error: 'Sign-in link already used',
        })
    })

    it('logs out by revoking the current session and clearing cookie', async () => {
        const req = createRequest({}) as Request
        req.mediaAdminSessionToken = validSessionToken
        const res = createResponse()

        await mediaAdminAuthController.logout(req, res)

        expect(mediaAdminAuthService.revokeSession).toHaveBeenCalledWith(
            hashToken(validSessionToken)
        )
        expect(res.setHeader).toHaveBeenCalledWith(
            'Set-Cookie',
            expect.stringContaining(`${MEDIA_ADMIN_SESSION_COOKIE}=`)
        )
        expect(res.status).toHaveBeenCalledWith(200)
    })

    it('logs out by revoking a stale cookie even without request admin context', async () => {
        const res = createResponse()

        await mediaAdminAuthController.logout(
            createRequest({
                headers: {
                    cookie: serialize(
                        MEDIA_ADMIN_SESSION_COOKIE,
                        validSessionToken
                    ),
                },
            }),
            res
        )

        expect(mediaAdminAuthService.revokeSession).toHaveBeenCalledWith(
            hashToken(validSessionToken)
        )
        expect(res.setHeader.mock.calls[0][1]).toContain(
            `${MEDIA_ADMIN_SESSION_COOKIE}=`
        )
        expect(res.status).toHaveBeenCalledWith(200)
    })

    it('clears the session cookie on logout even when no token is present', async () => {
        const res = createResponse()

        await mediaAdminAuthController.logout(createRequest({}), res)

        expect(mediaAdminAuthService.revokeSession).not.toHaveBeenCalled()
        expect(res.setHeader.mock.calls[0][1]).toContain(
            `${MEDIA_ADMIN_SESSION_COOKIE}=`
        )
        expect(res.status).toHaveBeenCalledWith(200)
    })
})

describe('requireMediaAdminSession', () => {
    beforeEach(() => {
        process.env.MEDIA_ADMIN_EMAILS = 'jenn@example.com'
        vi.mocked(mediaAdminAuthService.touchSession).mockResolvedValue(undefined)
    })

    it('rejects unauthenticated requests', async () => {
        const res = createResponse()
        const next = vi.fn()

        await requireMediaAdminSession(createRequest({}), res, next)

        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith({
            error: 'Authentication required',
        })
        expect(next).not.toHaveBeenCalled()
    })

    it('rejects expired sessions', async () => {
        vi.mocked(mediaAdminAuthService.findSessionByHash).mockResolvedValue({
            ...validSession,
            expires_at: new Date(Date.now() - 60_000).toISOString(),
        })
        const res = createResponse()
        const next = vi.fn()

        await requireMediaAdminSession(
            createRequest({
                headers: {
                    cookie: serialize(
                        MEDIA_ADMIN_SESSION_COOKIE,
                        validSessionToken
                    ),
                },
            }),
            res,
            next
        )

        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith({ error: 'Session expired' })
        expect(next).not.toHaveBeenCalled()
    })

    it('rejects sessions for no-longer-approved admins', async () => {
        process.env.MEDIA_ADMIN_EMAILS = 'phil@example.com'
        vi.mocked(mediaAdminAuthService.findSessionByHash).mockResolvedValue(
            validSession
        )
        const res = createResponse()
        const next = vi.fn()

        await requireMediaAdminSession(
            createRequest({
                headers: {
                    cookie: serialize(
                        MEDIA_ADMIN_SESSION_COOKIE,
                        validSessionToken
                    ),
                },
            }),
            res,
            next
        )

        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
        expect(next).not.toHaveBeenCalled()
    })

    it('sets request admin context for valid sessions', async () => {
        vi.mocked(mediaAdminAuthService.findSessionByHash).mockResolvedValue(
            validSession
        )
        const req = createRequest({
            headers: {
                cookie: serialize(MEDIA_ADMIN_SESSION_COOKIE, validSessionToken),
            },
        })
        const res = createResponse()
        const next = vi.fn()

        await requireMediaAdminSession(req, res, next)

        expect(mediaAdminAuthService.touchSession).toHaveBeenCalledWith(
            validSession.id
        )
        expect(req.mediaAdmin).toEqual({
            email: 'jenn@example.com',
            sessionId: validSession.id,
            expiresAt: validSession.expires_at,
        })
        expect(req.mediaAdminSessionToken).toBe(validSessionToken)
        expect(next).toHaveBeenCalledOnce()
    })
})
