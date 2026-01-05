import { Router } from 'express'
import { param, query } from 'express-validator'

import { validateRequest } from './middleware'
import agenda from '../controllers/agenda'

const router = Router()

// Valid status values for filtering
const validStatuses = ['pending', 'in_progress', 'completed', 'active']

// Valid category values
const validCategories = ['development', 'design', 'marketing', 'admin', 'client']

// GET /api/agenda - List agenda items with filtering and pagination
router.get(
    '/api/agenda',
    [
        query('status')
            .optional()
            .isIn(validStatuses)
            .withMessage(
                `status must be one of: ${validStatuses.join(', ')}`
            ),
        query('category')
            .optional()
            .isIn(validCategories)
            .withMessage(
                `category must be one of: ${validCategories.join(', ')}`
            ),
        query('include_completed')
            .optional()
            .isIn(['true', 'false'])
            .withMessage('include_completed must be "true" or "false"'),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 })
            .withMessage('limit must be between 1 and 100'),
        query('offset')
            .optional()
            .isInt({ min: 0 })
            .withMessage('offset must be a non-negative integer')
    ],
    validateRequest,
    agenda.list
)

// GET /api/agenda/:id - Get a single agenda item by ID
router.get(
    '/api/agenda/:id',
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    validateRequest,
    agenda.getOne
)

export default router
