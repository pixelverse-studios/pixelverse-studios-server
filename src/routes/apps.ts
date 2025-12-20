import { Router } from 'express'
import { body, param } from 'express-validator'

import { validateRequest } from './middleware'
import apps from '../controllers/apps'

const appsRouter: Router = Router()
const BASE_ROUTE = '/api/apps'

// GET /api/apps - List all apps
appsRouter.get(BASE_ROUTE, apps.getAll)

// GET /api/apps/:id - Get app by ID
appsRouter.get(
    `${BASE_ROUTE}/:id`,
    [param('id').isUUID().withMessage('App ID must be a valid UUID')],
    validateRequest,
    apps.getById
)

// GET /api/clients/:clientId/apps - Get apps for a client
appsRouter.get(
    '/api/clients/:clientId/apps',
    [param('clientId').isUUID().withMessage('Client ID must be a valid UUID')],
    validateRequest,
    apps.getByClient
)

// POST /api/apps/new - Create new app
appsRouter.post(
    `${BASE_ROUTE}/new`,
    [
        body('name')
            .isString()
            .withMessage('name must be a string')
            .notEmpty()
            .withMessage('name is required'),
        body('app_slug')
            .isString()
            .withMessage('app_slug must be a string')
            .notEmpty()
            .withMessage('app_slug is required')
            .matches(/^[a-z0-9-]+$/)
            .withMessage(
                'app_slug must contain only lowercase letters, numbers, and hyphens'
            ),
        body('client_id')
            .isUUID()
            .withMessage('client_id must be a valid UUID'),
        body('description')
            .optional()
            .isString()
            .withMessage('description must be a string'),
        body('repository_url')
            .optional()
            .isURL()
            .withMessage('repository_url must be a valid URL'),
        body('tech_stack')
            .optional()
            .isArray()
            .withMessage('tech_stack must be an array'),
        body('tech_stack.*')
            .optional()
            .isString()
            .withMessage('Each tech_stack item must be a string'),
        body('contact_email')
            .optional()
            .isEmail()
            .withMessage('contact_email must be a valid email'),
        body('active')
            .optional()
            .isBoolean()
            .withMessage('active must be a boolean')
    ],
    validateRequest,
    apps.create
)

// PATCH /api/apps/:id - Update app
appsRouter.patch(
    `${BASE_ROUTE}/:id`,
    [
        param('id').isUUID().withMessage('App ID must be a valid UUID'),
        body().custom((_, { req }) => {
            const {
                name,
                app_slug,
                description,
                repository_url,
                tech_stack,
                contact_email,
                active
            } = req.body
            if (
                name === undefined &&
                app_slug === undefined &&
                description === undefined &&
                repository_url === undefined &&
                tech_stack === undefined &&
                contact_email === undefined &&
                active === undefined
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
        body('app_slug')
            .optional()
            .isString()
            .withMessage('app_slug must be a string')
            .notEmpty()
            .withMessage('app_slug cannot be empty')
            .matches(/^[a-z0-9-]+$/)
            .withMessage(
                'app_slug must contain only lowercase letters, numbers, and hyphens'
            ),
        body('description')
            .optional()
            .isString()
            .withMessage('description must be a string'),
        body('repository_url')
            .optional()
            .isURL()
            .withMessage('repository_url must be a valid URL'),
        body('tech_stack')
            .optional()
            .isArray()
            .withMessage('tech_stack must be an array'),
        body('contact_email')
            .optional()
            .isEmail()
            .withMessage('contact_email must be a valid email'),
        body('active')
            .optional()
            .isBoolean()
            .withMessage('active must be a boolean')
    ],
    validateRequest,
    apps.edit
)

// DELETE /api/apps/:id - Delete app
appsRouter.delete(
    `${BASE_ROUTE}/:id`,
    [param('id').isUUID().withMessage('App ID must be a valid UUID')],
    validateRequest,
    apps.remove
)

export default appsRouter
