import { Router } from 'express'
import { body, param, query } from 'express-validator'

import { validateRequest } from './middleware'
import agenda from '../controllers/agenda'

const router = Router()

// Valid status values for filtering (includes 'active' pseudo-status)
const validStatuses = ['pending', 'in_progress', 'completed', 'active']

// Valid status values for updating (actual database values only)
const validStatusUpdates = ['pending', 'in_progress', 'completed']

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

// PATCH /api/agenda/reorder - Bulk reorder items (must be before :id routes)
router.patch(
    '/api/agenda/reorder',
    [
        body('item_ids')
            .isArray({ min: 1 })
            .withMessage('item_ids must be a non-empty array'),
        body('item_ids.*')
            .isUUID()
            .withMessage('each item_id must be a valid UUID')
    ],
    validateRequest,
    agenda.reorder
)

// GET /api/agenda/:id - Get a single agenda item by ID
router.get(
    '/api/agenda/:id',
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    validateRequest,
    agenda.getOne
)

// POST /api/agenda/new - Create a new agenda item
router.post(
    '/api/agenda/new',
    [
        body('name')
            .isString()
            .notEmpty()
            .withMessage('name is required'),
        body('description')
            .optional({ nullable: true })
            .isString()
            .withMessage('description must be a string'),
        body('category')
            .optional({ nullable: true })
            .isIn(validCategories)
            .withMessage(
                `category must be one of: ${validCategories.join(', ')}`
            ),
        body('due_date')
            .optional({ nullable: true })
            .matches(/^\d{4}-\d{2}-\d{2}$/)
            .withMessage('due_date must be in YYYY-MM-DD format')
    ],
    validateRequest,
    agenda.create
)

// PATCH /api/agenda/:id - Update item details (not status or priority)
router.patch(
    '/api/agenda/:id',
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        body('name')
            .optional()
            .isString()
            .notEmpty()
            .withMessage('name must be a non-empty string'),
        body('description')
            .optional({ nullable: true })
            .isString()
            .withMessage('description must be a string'),
        body('category')
            .optional({ nullable: true })
            .isIn([...validCategories, null])
            .withMessage(
                `category must be one of: ${validCategories.join(', ')} or null`
            ),
        body('due_date')
            .optional({ nullable: true })
            .custom((value) => {
                if (value === null) return true
                return /^\d{4}-\d{2}-\d{2}$/.test(value)
            })
            .withMessage('due_date must be in YYYY-MM-DD format or null')
    ],
    validateRequest,
    agenda.update
)

// PATCH /api/agenda/:id/status - Update item workflow status
router.patch(
    '/api/agenda/:id/status',
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        body('status')
            .isIn(validStatusUpdates)
            .withMessage(
                `status must be one of: ${validStatusUpdates.join(', ')}`
            )
    ],
    validateRequest,
    agenda.updateStatus
)

// PATCH /api/agenda/:id/priority - Update item priority
router.patch(
    '/api/agenda/:id/priority',
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        body('priority')
            .isInt({ min: 0 })
            .withMessage('priority must be an integer >= 0')
    ],
    validateRequest,
    agenda.updatePriority
)

// DELETE /api/agenda/:id - Remove an agenda item
router.delete(
    '/api/agenda/:id',
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    validateRequest,
    agenda.remove
)

export default router
