import { Router } from 'express'
import { body, param } from 'express-validator'
import { validateRequest } from './middleware'
import cms from '../controllers/cms'

const cmsRouter: Router = Router()

// TODO: Add user verification to endpoints when we have it built into the ui, for appropriate routes that are not public
const BASE_ROUTE = '/api/cms'
cmsRouter.get(BASE_ROUTE, cms.get)

cmsRouter.get(
    `${BASE_ROUTE}/:clientSlug`,
    [param('clientSlug').exists().withMessage('slug is required')],
    validateRequest,
    cms.getById
)

cmsRouter.get(
    `${BASE_ROUTE}/:clientSlug/active`,
    [param('clientSlug').exists().withMessage('slug is required')],
    validateRequest,
    cms.getActiveById
)

cmsRouter.post(
    `${BASE_ROUTE}/:clientSlug`,
    [
        param('clientSlug').exists().withMessage('slug is required'),
        body('page').isString().notEmpty().withMessage('"page" is required'),
        body('content').exists().withMessage('"content" is required'),
        body('active').exists().isBoolean()
    ],
    validateRequest,
    cms.add
)

export default cmsRouter
