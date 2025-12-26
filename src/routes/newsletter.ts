import { Router } from 'express'
import { body, param } from 'express-validator'

import { validateRequest } from './middleware'
import newsletter from '../controllers/newsletter'

const newsletterRouter: Router = Router()
const BASE_ROUTE = '/api/newsletter'

newsletterRouter.get(BASE_ROUTE, newsletter.getAll)
newsletterRouter.post(
    `${BASE_ROUTE}/:clientId`,
    [
        param('clientId').isUUID().withMessage('clientId must be a valid UUID'),
        body('firstName')
            .isString()
            .notEmpty()
            .withMessage('First name is required'),
        body('lastName')
            .isString()
            .notEmpty()
            .withMessage('Last name is required'),
        body('email').isEmail().withMessage('Valid email is required')
    ],
    validateRequest,
    newsletter.add
)

export default newsletterRouter
