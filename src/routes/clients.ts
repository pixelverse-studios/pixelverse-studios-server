import { Router } from 'express'
import { body, param } from 'express-validator'

import { validateRequest } from './middleware'
import clients from '../controllers/clients'

const clientsRouter: Router = Router()
const BASE_ROUTE = '/api/clients'

clientsRouter.get(BASE_ROUTE, clients.getAll)
clientsRouter.get(
    `${BASE_ROUTE}/:id`,
    [
        param('id')
            .isUUID()
            .withMessage('Client ID must be a valid UUID')
    ],
    validateRequest,
    clients.getById
)
clientsRouter.post(
    `${BASE_ROUTE}/new`,
    [
        body('client')
            .isString()
            .notEmpty()
            .withMessage('"client" is required'),
        body('client_slug')
            .isString()
            .notEmpty()
            .withMessage('"client slug" is required'),
        body('active').isBoolean().withMessage('"active" is required'),
        body('cms').isBoolean()
    ],
    validateRequest,
    clients.add
)
clientsRouter.patch(
    `${BASE_ROUTE}/:id`,
    [
        param('id').isUUID().withMessage('Client ID must be a valid UUID'),
        body().custom((_, { req }) => {
            if (!req.body.client && req.body.active === undefined) {
                throw new Error(
                    'At least one of "client" or "active" is required'
                )
            }
            return true
        }),
        body('client')
            .optional()
            .isString()
            .withMessage('client must be a string')
            .notEmpty()
            .withMessage('client cannot be empty'),
        body('active')
            .optional()
            .isBoolean()
            .withMessage('active must be a boolean')
    ],
    validateRequest,
    clients.edit
)
clientsRouter.delete(
    `${BASE_ROUTE}/:id`,
    [
        param('id')
            .isUUID()
            .withMessage('Client ID must be a valid UUID')
    ],
    validateRequest,
    clients.remove
)

export default clientsRouter
