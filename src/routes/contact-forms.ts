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
        param('website_slug').isString().notEmpty(),
        body('fullname').isString().notEmpty(),
        body('email').isString().notEmpty(),
        body('phone').isString().notEmpty(),
        body('data').notEmpty().isObject()
    ],
    validateRequest,
    contactForms.addRecord
)

export default contactFormsRouter
