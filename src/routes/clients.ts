import { Router } from 'express'
import { body, param, query } from 'express-validator'

import { validateRequest } from './middleware'
import clients from '../controllers/clients'

const clientsRouter: Router = Router()
const BASE_ROUTE = '/api/clients'

clientsRouter.get(
    BASE_ROUTE,
    [
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 })
            .withMessage('limit must be an integer between 1 and 100'),
        query('offset')
            .optional()
            .isInt({ min: 0 })
            .withMessage('offset must be a non-negative integer')
    ],
    validateRequest,
    clients.getAll
)
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
        body('company_name')
            .optional()
            .isString()
            .withMessage('"company_name" must be a string'),
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
            const { firstname, lastname, company_name, email, phone, active } =
                req.body
            if (
                firstname === undefined &&
                lastname === undefined &&
                company_name === undefined &&
                email === undefined &&
                phone === undefined &&
                active === undefined
            ) {
                throw new Error(
                    'At least one field (firstname, lastname, company_name, email, phone, active) is required'
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
        body('company_name')
            .optional({ values: 'null' })
            .isString()
            .withMessage('company_name must be a string'),
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
