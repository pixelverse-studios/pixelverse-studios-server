import { Router } from 'express'
import { body, param } from 'express-validator'

import { validateRequest } from './middleware'
import clients from '../controllers/clients'

const clientsRouter: Router = Router()
const BASE_ROUTE = '/api/clients'

clientsRouter.get(BASE_ROUTE, clients.getAll)
clientsRouter.get(
    `${BASE_ROUTE}/:id`,
    [param('id').isUUID().withMessage('Client ID must be a valid UUID')],
    validateRequest,
    clients.getById
)
clientsRouter.post(
    `${BASE_ROUTE}/new`,
    [
        body('firstname')
            .isString()
            .notEmpty()
            .withMessage('"firstname" is required'),
        body('lastname')
            .isString()
            .notEmpty()
            .withMessage('"lastname" is required'),
        body('email')
            .optional()
            .isEmail()
            .withMessage('"email" must be a valid email address'),
        body('phone')
            .optional()
            .isString()
            .withMessage('"phone" must be a string'),
        body('active')
            .optional()
            .isBoolean()
            .withMessage('"active" must be a boolean')
    ],
    validateRequest,
    clients.add
)
clientsRouter.patch(
    `${BASE_ROUTE}/:id`,
    [
        param('id').isUUID().withMessage('Client ID must be a valid UUID'),
        body().custom((_, { req }) => {
            const { firstname, lastname, email, phone, active } = req.body
            if (
                firstname === undefined &&
                lastname === undefined &&
                email === undefined &&
                phone === undefined &&
                active === undefined
            ) {
                throw new Error(
                    'At least one field (firstname, lastname, email, phone, active) is required'
                )
            }
            return true
        }),
        body('firstname')
            .optional()
            .isString()
            .withMessage('firstname must be a string')
            .notEmpty()
            .withMessage('firstname cannot be empty'),
        body('lastname')
            .optional()
            .isString()
            .withMessage('lastname must be a string')
            .notEmpty()
            .withMessage('lastname cannot be empty'),
        body('email')
            .optional({ values: 'null' })
            .isEmail()
            .withMessage('email must be a valid email address'),
        body('phone')
            .optional({ values: 'null' })
            .isString()
            .withMessage('phone must be a string'),
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
    [param('id').isUUID().withMessage('Client ID must be a valid UUID')],
    validateRequest,
    clients.remove
)

export default clientsRouter
