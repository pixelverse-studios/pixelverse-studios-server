import { Router } from 'express'
import { body, param } from 'express-validator'

import { validateRequest } from './middleware'
import apps from '../controllers/apps'
import { PROJECT_STATUSES } from '../lib/db'

const appsRouter: Router = Router()
const BASE_ROUTE = '/api/apps'

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
            .withMessage('app_slug is required'),
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
        body('contact_email')
            .optional()
            .isEmail()
            .withMessage('contact_email must be a valid email'),
        body('status')
            .optional()
            .isIn(PROJECT_STATUSES)
            .withMessage(
                `status must be one of: ${PROJECT_STATUSES.join(', ')}`
            ),
        body('priority')
            .optional()
            .isInt()
            .withMessage('priority must be an integer')
    ],
    validateRequest,
    apps.create
)

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
                active,
                status,
                priority
            } = req.body
            if (
                name === undefined &&
                app_slug === undefined &&
                description === undefined &&
                repository_url === undefined &&
                tech_stack === undefined &&
                contact_email === undefined &&
                active === undefined &&
                status === undefined &&
                priority === undefined
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
            .withMessage('app_slug cannot be empty'),
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
            .withMessage('active must be a boolean'),
        body('status')
            .optional()
            .isIn(PROJECT_STATUSES)
            .withMessage(
                `status must be one of: ${PROJECT_STATUSES.join(', ')}`
            ),
        body('priority')
            .optional()
            .isInt()
            .withMessage('priority must be an integer')
    ],
    validateRequest,
    apps.edit
)

appsRouter.patch(
    `${BASE_ROUTE}/:id/status`,
    [
        param('id').isUUID().withMessage('App ID must be a valid UUID'),
        body('status')
            .isString()
            .withMessage('status is required')
            .isIn(PROJECT_STATUSES)
            .withMessage(
                `status must be one of: ${PROJECT_STATUSES.join(', ')}`
            )
    ],
    validateRequest,
    apps.updateStatus
)

export default appsRouter
