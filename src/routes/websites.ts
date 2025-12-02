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
        body('seo_focus')
            .isString()
            .withMessage('seo_focus must be a string')
    ],
    validateRequest,
    websites.updateSeoFocus
)

export default websitesRouter
