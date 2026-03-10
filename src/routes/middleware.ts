import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'
import { validationResult } from 'express-validator'

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
