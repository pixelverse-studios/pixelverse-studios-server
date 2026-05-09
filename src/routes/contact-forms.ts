import { Router } from 'express'
import { body, param } from 'express-validator'

import { validateRequest } from './middleware'
import contactForms from '../controllers/contact-forms'

const contactFormsRouter: Router = Router()
const BASE_ROUTE = '/api/v1/contact-forms'

contactFormsRouter.get(BASE_ROUTE, contactForms.getAll)

contactFormsRouter.post(
    `${BASE_ROUTE}/:website_slug`,
    [
        param('website_slug')
            .isString()
            .withMessage('website_slug must be a string')
            .bail()
            .trim()
            .notEmpty()
            .withMessage('website_slug is required'),
        body('fullname')
            .isString()
            .withMessage('fullname must be a string')
            .bail()
            .trim()
            .notEmpty()
            .withMessage('fullname is required'),
        body('email')
            .isString()
            .withMessage('email must be a string')
            .bail()
            .trim()
            .notEmpty()
            .withMessage('email is required')
            .bail()
            .isEmail()
            .withMessage('email must be valid'),
        body('phone')
            .optional()
            .isString()
            .withMessage('phone must be a string'),
        body('data')
            .custom(value => {
                return (
                    value !== null &&
                    typeof value === 'object' &&
                    !Array.isArray(value) &&
                    Object.keys(value).length > 0
                )
            })
            .withMessage('data must be a non-empty object')
    ],
    validateRequest,
    contactForms.addRecord
)

export default contactFormsRouter
