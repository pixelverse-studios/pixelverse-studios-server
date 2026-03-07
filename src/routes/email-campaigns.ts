import { Router } from 'express'
import { body, query } from 'express-validator'

import { validateRequest, requireBlastSecret } from './middleware'
import emailCampaigns from '../controllers/email-campaigns'

const router = Router()

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
