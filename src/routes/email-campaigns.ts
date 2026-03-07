import { Router, Request, Response, NextFunction } from 'express'
import { body, query } from 'express-validator'

import { validateRequest } from './middleware'
import emailCampaigns from '../controllers/email-campaigns'

const router = Router()

// Middleware: require X-Blast-Secret header
const requireBlastSecret = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const secret = process.env.BLAST_SECRET?.trim()
    if (!secret) {
        res.status(503).json({ error: 'Blast endpoint not configured' })
        return
    }
    if (req.headers['x-blast-secret'] !== secret) {
        res.status(401).json({ error: 'Unauthorized' })
        return
    }
    next()
}

// POST /api/domani/email-campaigns/preview
router.post(
    '/api/domani/email-campaigns/preview',
    requireBlastSecret,
    [
        body('subject')
            .isString()
            .notEmpty()
            .withMessage('subject is required'),
        body('htmlContent')
            .isString()
            .notEmpty()
            .withMessage('htmlContent is required'),
    ],
    validateRequest,
    emailCampaigns.preview
)

// POST /api/domani/email-campaigns/send
router.post(
    '/api/domani/email-campaigns/send',
    requireBlastSecret,
    [
        body('subject')
            .isString()
            .notEmpty()
            .withMessage('subject is required'),
        body('htmlContent')
            .isString()
            .notEmpty()
            .withMessage('htmlContent is required'),
        body('recipientIds')
            .isArray({ min: 1 })
            .withMessage('recipientIds must be a non-empty array'),
        body('recipientIds.*')
            .isUUID()
            .withMessage('Each recipientId must be a valid UUID'),
        body('sentBy')
            .isEmail()
            .withMessage('sentBy must be a valid email'),
        body('delayBetweenEmails')
            .optional()
            .isInt({ min: 100, max: 10000 })
            .withMessage('delayBetweenEmails must be between 100 and 10000ms'),
    ],
    validateRequest,
    emailCampaigns.send
)

// GET /api/domani/email-campaigns
router.get(
    '/api/domani/email-campaigns',
    requireBlastSecret,
    [
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 })
            .withMessage('limit must be between 1 and 100'),
        query('offset')
            .optional()
            .isInt({ min: 0 })
            .withMessage('offset must be a non-negative integer'),
    ],
    validateRequest,
    emailCampaigns.list
)

export default router
