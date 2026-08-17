import { Router } from 'express'
import { query } from 'express-validator'

import { getPublicReleases } from '../controllers/public-releases'

const router = Router()

const queryValidators = () => [
    query('platform')
        .optional()
        .isIn(['ios', 'android'])
        .withMessage('Platform must be ios or android'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('cursor')
        .optional()
        .isString()
        .notEmpty()
        .withMessage('Cursor must be a non-empty string'),
]

router.get(
    '/api/domani/releases/coming-soon',
    queryValidators(),
    getPublicReleases('coming-soon')
)
router.get(
    '/api/domani/releases/changelog',
    queryValidators(),
    getPublicReleases('changelog')
)

export default router
