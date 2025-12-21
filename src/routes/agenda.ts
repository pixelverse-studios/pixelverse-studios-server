import { Router } from 'express'
import { body, param, query } from 'express-validator'

import { validateRequest } from './middleware'
import agenda from '../controllers/agenda'

const agendaRouter: Router = Router()
const BASE_ROUTE = '/api/agenda'

// Status validator (reusable)
const statusValidator = body('status')
    .isIn(['pending', 'in_progress', 'completed'])
    .withMessage('status must be "pending", "in_progress", or "completed"')

// GET /api/agenda - List all items
agendaRouter.get(
    BASE_ROUTE,
    [
        query('status')
            .optional()
            .isIn(['pending', 'in_progress', 'completed', 'active'])
            .withMessage(
                'status must be "pending", "in_progress", "completed", or "active"'
            ),
        query('category').optional().isString(),
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
    agenda.getAll
)

// POST /api/agenda/new - Create item
agendaRouter.post(
    `${BASE_ROUTE}/new`,
    [
        body('name')
            .isString()
            .withMessage('name must be a string')
            .notEmpty()
            .withMessage('name is required'),
        body('description')
            .optional()
            .isString()
            .withMessage('description must be a string'),
        body('category')
            .optional()
            .isString()
            .withMessage('category must be a string'),
        body('due_date')
            .optional()
            .isISO8601()
            .withMessage('due_date must be a valid ISO 8601 date'),
        body('priority')
            .optional()
            .isInt({ min: 0 })
            .withMessage('priority must be a non-negative integer')
    ],
    validateRequest,
    agenda.create
)

// PATCH /api/agenda/reorder - Bulk reorder (BEFORE :id routes to avoid collision)
agendaRouter.patch(
    `${BASE_ROUTE}/reorder`,
    [
        body('item_ids')
            .isArray({ min: 1 })
            .withMessage('item_ids must be a non-empty array'),
        body('item_ids.*')
            .isUUID()
            .withMessage('Each item_id must be a valid UUID')
    ],
    validateRequest,
    agenda.reorder
)

// GET /api/agenda/:id - Get by ID
agendaRouter.get(
    `${BASE_ROUTE}/:id`,
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    validateRequest,
    agenda.getById
)

// PATCH /api/agenda/:id - Update details
agendaRouter.patch(
    `${BASE_ROUTE}/:id`,
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        body().custom((_, { req }) => {
            const { name, description, category, due_date } = req.body
            if (
                name === undefined &&
                description === undefined &&
                category === undefined &&
                due_date === undefined
            ) {
                throw new Error('At least one field is required')
            }
            return true
        }),
        body('name')
            .optional()
            .isString()
            .withMessage('name must be a string')
            .notEmpty()
            .withMessage('name cannot be empty'),
        body('description')
            .optional()
            .isString()
            .withMessage('description must be a string'),
        body('category')
            .optional()
            .isString()
            .withMessage('category must be a string'),
        body('due_date')
            .optional()
            .custom(value => {
                // Allow null to clear the due date
                if (value === null) return true
                // Otherwise must be valid ISO 8601
                const date = new Date(value)
                if (isNaN(date.getTime())) {
                    throw new Error('due_date must be a valid ISO 8601 date or null')
                }
                return true
            })
    ],
    validateRequest,
    agenda.update
)

// PATCH /api/agenda/:id/status - Update status
agendaRouter.patch(
    `${BASE_ROUTE}/:id/status`,
    [param('id').isUUID().withMessage('id must be a valid UUID'), statusValidator],
    validateRequest,
    agenda.updateStatus
)

// PATCH /api/agenda/:id/priority - Update priority
agendaRouter.patch(
    `${BASE_ROUTE}/:id/priority`,
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        body('priority')
            .isInt({ min: 0 })
            .withMessage('priority must be a non-negative integer')
    ],
    validateRequest,
    agenda.updatePriority
)

// DELETE /api/agenda/:id - Delete item
agendaRouter.delete(
    `${BASE_ROUTE}/:id`,
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    validateRequest,
    agenda.remove
)

export default agendaRouter
