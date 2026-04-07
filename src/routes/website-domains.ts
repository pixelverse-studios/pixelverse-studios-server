import { Router } from 'express'
import { query } from 'express-validator'

import controller from '../controllers/website-domains'
import { publicReadLimit } from './rate-limits'

const router = Router()

// Public, unauthenticated endpoint. The CMS dashboard hits this BEFORE login
// to determine which client/branding to show based on the requesting hostname.
// Do NOT add auth middleware here.
router.get(
    '/api/cms/resolve-hostname',
    publicReadLimit,
    [
        query('hostname')
            .isString()
            .withMessage('hostname must be a string')
            .notEmpty()
            .withMessage('hostname is required')
            .isLength({ min: 1, max: 253 })
            .withMessage('hostname must be 1-253 characters'),
    ],
    controller.resolveHostname
)

export default router
