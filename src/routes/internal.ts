import { Router } from 'express'
import { body, param } from 'express-validator'

import { validateRequest } from './middleware'
import {
    getAllClients,
    addClient,
    editClient,
    deleteClient
} from '../controllers/internal/clients'

const internalRouter: Router = Router()
const API_PREFIX = '/clients'

internalRouter.get(API_PREFIX, getAllClients)
internalRouter.post(
    `${API_PREFIX}/new`,
    [
        body('client')
            .isString()
            .notEmpty()
            .withMessage('"client" is required'),
        body('active').isBoolean().withMessage('"active" is required')
    ],
    validateRequest,
    addClient
)
internalRouter.put(
    `${API_PREFIX}/:id`,
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
    editClient
)
internalRouter.delete(
    `${API_PREFIX}/:id`,
    [
        param('id')
            .isNumeric()
            .withMessage('Client ID must be provided and a number')
    ],
    validateRequest,
    deleteClient
)

export default internalRouter
