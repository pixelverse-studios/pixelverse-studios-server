import { Router } from 'express'
import { body, query } from 'express-validator'

import { validateRequest } from './middleware'
import domani from '../controllers/domani'
import * as users from '../controllers/domani-users'
import { requireDomaniStaff } from '../middleware/domani-staff-auth'
import { PLATFORMS } from '../lib/domani-db'

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

// GET /api/domani/support - List support requests
router.get(
    '/api/domani/support',
    requireDomaniStaff,
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

// Staff-only reads, including the legacy list path. Unsubscribe remains its existing separate flow.
router.get('/api/domani/users', requireDomaniStaff, users.list)
router.get('/api/domani/users/stats', requireDomaniStaff, users.stats)
router.get('/api/domani/users/:id', requireDomaniStaff, users.detail)

export default router
