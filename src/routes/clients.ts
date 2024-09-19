import { Router } from 'express'
import { body, param } from 'express-validator'

import { validateRequest } from './middleware'
import clients from '../controllers/clients'

const clientsRouter: Router = Router()

clientsRouter.get('/', clients.getAll)
clientsRouter.post(
    `/new`,
    [
        body('client')
            .isString()
            .notEmpty()
            .withMessage('"client" is required'),
        body('client_slug')
            .isString()
            .notEmpty()
            .withMessage('"client slug" is required'),
        body('active').isBoolean().withMessage('"active" is required')
    ],
    validateRequest,
    clients.add
)
clientsRouter.put(
    `/:id`,
    [
        param('id').isNumeric().withMessage('Client ID must be a number'),
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
    `/:id`,
    [
        param('id')
            .isNumeric()
            .withMessage('Client ID must be provided and a number')
    ],
    validateRequest,
    clients.remove
)

export default clientsRouter
