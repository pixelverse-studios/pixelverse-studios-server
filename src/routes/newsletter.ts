import { Router } from 'express'
import { body, param } from 'express-validator'

import { validateRequest } from './middleware'
import newsletter from '../controllers/newsletter'

const newsletterRouter: Router = Router()

newsletterRouter.get('/all', newsletter.getAll)

newsletterRouter.post(
    '/:clientSlug',
    [
        param('clientSlug')
            .isString()
            .notEmpty()
            .withMessage('Client identifier is required'),
        body('firstName')
            .isString()
            .notEmpty()
            .withMessage('First name is required'),
        body('lastName')
            .isString()
            .notEmpty()
            .withMessage('First name is required'),
        body('email').isEmail().withMessage('Valid email is required')
    ],
    validateRequest,
    newsletter.add
)

export default newsletterRouter
