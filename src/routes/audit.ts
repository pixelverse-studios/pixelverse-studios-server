import { Router } from 'express'
import { body } from 'express-validator'

import { validateRequest } from './middleware'
import auditController from '../controllers/audit'

const auditRouter: Router = Router()
const BASE_ROUTE = '/api/audit'

auditRouter.post(
    BASE_ROUTE,
    [
        body('name')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('Name is required')
            .isLength({ max: 200 })
            .withMessage('Name must be 200 characters or fewer'),
        body('email')
            .isString()
            .trim()
            .normalizeEmail()
            .isEmail()
            .withMessage('A valid email is required'),
        body('websiteUrl')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('Website URL is required')
            .isURL({ require_protocol: false })
            .withMessage('Website URL must be valid'),
        body('phoneNumber')
            .optional({ nullable: true })
            .isString()
            .trim()
            .isLength({ min: 7, max: 30 })
            .withMessage('Phone number must be between 7 and 30 characters'),
        body('specifics')
            .optional({ nullable: true })
            .isString()
            .trim()
            .isLength({ max: 2000 })
            .withMessage('Specifics must be 2000 characters or fewer')
    ],
    validateRequest,
    auditController.createAuditRequest
)

export default auditRouter
