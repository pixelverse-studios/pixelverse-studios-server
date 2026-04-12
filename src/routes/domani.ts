import { Router } from 'express'
import { body, query } from 'express-validator'

import { validateRequest } from './middleware'
import domani from '../controllers/domani'
import {
    FEEDBACK_CATEGORIES,
    PLATFORMS,
    SIGNUP_COHORTS
} from '../lib/domani-db'

const router = Router()

// Common pagination validators
const paginationValidators = [
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('limit must be between 1 and 100'),
    query('offset')
        .optional()
        .isInt({ min: 0 })
        .withMessage('offset must be a non-negative integer')
]

// Platform validator (reusable)
const platformValidator = query('platform')
    .optional()
    .isIn([...PLATFORMS])
    .withMessage(`platform must be one of: ${PLATFORMS.join(', ')}`)

// GET /api/domani/feedback - List beta feedback submissions
router.get(
    '/api/domani/feedback',
    [
        query('category')
            .optional()
            .isIn([...FEEDBACK_CATEGORIES])
            .withMessage(
                `category must be one of: ${FEEDBACK_CATEGORIES.join(', ')}`
            ),
        query('status').optional().isString(),
        platformValidator,
        ...paginationValidators
    ],
    validateRequest,
    domani.listFeedback
)

// GET /api/domani/support - List support requests
router.get(
    '/api/domani/support',
    [
        query('category').optional().isString(),
        query('status').optional().isString(),
        platformValidator,
        ...paginationValidators
    ],
    validateRequest,
    domani.listSupportRequests
)

// GET /api/domani/waitlist - List waitlist entries
router.get(
    '/api/domani/waitlist',
    [...paginationValidators],
    validateRequest,
    domani.listWaitlist
)

// POST /api/domani/waitlist/unsubscribe - Unsubscribe from waitlist
router.post(
    '/api/domani/waitlist/unsubscribe',
    [body('email').isEmail().withMessage('Valid email is required')],
    validateRequest,
    domani.unsubscribe
)

// POST /api/domani/users/unsubscribe - Unsubscribe a user (soft delete)
router.post(
    '/api/domani/users/unsubscribe',
    [body('email').isEmail().withMessage('Valid email is required')],
    validateRequest,
    domani.unsubscribeUser
)

// GET /api/domani/users - List user profiles
router.get(
    '/api/domani/users',
    [
        query('cohort')
            .optional()
            .isIn([...SIGNUP_COHORTS])
            .withMessage(`cohort must be one of: ${SIGNUP_COHORTS.join(', ')}`),
        query('include_deleted')
            .optional()
            .isIn(['true', 'false'])
            .withMessage('include_deleted must be "true" or "false"'),
        ...paginationValidators
    ],
    validateRequest,
    domani.listUsers
)

export default router
