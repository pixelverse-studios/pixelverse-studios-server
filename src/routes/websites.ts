import { Router } from 'express'
import { body, param } from 'express-validator'

import { validateRequest } from './middleware'
import websites from '../controllers/websites'

const websitesRouter: Router = Router()
const BASE_ROUTE = '/api/websites'

websitesRouter.patch(
    `${BASE_ROUTE}/:id/seo-focus`,
    [
        param('id').isUUID().withMessage('Website ID must be a valid UUID'),
        body('seo_focus').isString().withMessage('seo_focus must be a string')
    ],
    validateRequest,
    websites.updateSeoFocus
)

websitesRouter.patch(
    `${BASE_ROUTE}/:id`,
    [
        param('id').isUUID().withMessage('Website ID must be a valid UUID'),
        body().custom((_, { req }) => {
            const {
                title,
                domain,
                website_slug,
                type,
                features,
                contact_email,
                seo_focus
            } = req.body
            if (
                title === undefined &&
                domain === undefined &&
                website_slug === undefined &&
                type === undefined &&
                features === undefined &&
                contact_email === undefined &&
                seo_focus === undefined
            ) {
                throw new Error('At least one field is required')
            }
            return true
        }),
        body('title')
            .optional()
            .isString()
            .withMessage('title must be a string')
            .notEmpty()
            .withMessage('title cannot be empty'),
        body('domain')
            .optional()
            .isURL()
            .withMessage('domain must be a valid URL'),
        body('website_slug')
            .optional()
            .isString()
            .withMessage('website_slug must be a string')
            .notEmpty()
            .withMessage('website_slug cannot be empty'),
        body('type').optional().isString().withMessage('type must be a string'),
        body('features')
            .optional()
            .isString()
            .withMessage('features must be a string'),
        body('contact_email')
            .optional()
            .isEmail()
            .withMessage('contact_email must be a valid email'),
        body('seo_focus')
            .optional()
            .isObject()
            .withMessage('seo_focus must be an object')
    ],
    validateRequest,
    websites.edit
)

websitesRouter.post(
    `${BASE_ROUTE}/new`,
    [
        body('title')
            .isString()
            .withMessage('title must be a string')
            .notEmpty()
            .withMessage('title is required'),
        body('domain').isURL().withMessage('domain must be a valid URL'),
        body('website_slug')
            .isString()
            .withMessage('website_slug must be a string')
            .notEmpty()
            .withMessage('website_slug is required'),
        body('client_id')
            .isUUID()
            .withMessage('client_id must be a valid UUID'),
        body('type').optional().isString().withMessage('type must be a string'),
        body('features')
            .optional()
            .isString()
            .withMessage('features must be a string'),
        body('contact_email')
            .optional()
            .isEmail()
            .withMessage('contact_email must be a valid email'),
        body('seo_focus')
            .optional()
            .isObject()
            .withMessage('seo_focus must be an object')
    ],
    validateRequest,
    websites.create
)

export default websitesRouter
