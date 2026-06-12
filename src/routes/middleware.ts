import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'
import { validationResult } from 'express-validator'
import { parse } from 'cookie'

import {
    hashToken,
    isApprovedAdminEmail,
    MEDIA_ADMIN_SESSION_COOKIE,
} from '../lib/media-admin-auth'
import mediaAdminAuthService from '../services/media-admin-auth'

export const validateRequest = (
    req: Request,
    res: Response,
    next: NextFunction
): Response | void => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() })
    }
    next()
}

export const requireBlastSecret = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const secret = process.env.BLAST_SECRET?.trim()
    if (!secret) {
        res.status(503).json({ error: 'Blast endpoint not configured' })
        return
    }
    const header = req.headers['x-blast-secret']
    if (
        typeof header !== 'string' ||
        header.length !== secret.length ||
        !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(secret))
    ) {
        res.status(401).json({ error: 'Unauthorized' })
        return
    }
    next()
}

export const requireMediaAdminSession = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const cookies = parse(req.headers.cookie || '')
        const sessionToken = cookies[MEDIA_ADMIN_SESSION_COOKIE]

        if (!sessionToken) {
            res.status(401).json({
                ok: false,
                error: {
                    code: 'media_admin_auth.session_required',
                    message: 'Authentication required',
                },
            })
            return
        }

        const session = await mediaAdminAuthService.findSessionByHash(
            hashToken(sessionToken)
        )

        if (
            !session ||
            session.revoked_at ||
            new Date(session.expires_at).getTime() <= Date.now()
        ) {
            console.warn('Media admin auth session rejected', {
                reason: !session
                    ? 'not_found'
                    : session.revoked_at
                      ? 'revoked'
                      : 'expired',
                sessionId: session?.id,
                expiresAt: session?.expires_at,
            })
            res.status(401).json({
                ok: false,
                error: {
                    code: 'media_admin_auth.session_expired',
                    message: 'Session expired',
                },
            })
            return
        }

        if (!isApprovedAdminEmail(session.email)) {
            console.warn('Media admin auth session rejected', {
                reason: 'unapproved_email',
                sessionId: session.id,
                email: session.email,
            })
            res.status(403).json({
                ok: false,
                error: {
                    code: 'media_admin_auth.unapproved_email',
                    message: 'Unauthorized',
                },
            })
            return
        }

        await mediaAdminAuthService.touchSession(session.id)

        req.mediaAdmin = {
            email: session.email,
            sessionId: session.id,
            expiresAt: session.expires_at,
        }
        req.mediaAdminSessionToken = sessionToken

        next()
    } catch (err) {
        next(err)
    }
}
