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
    `${BASE_ROUTE}/:id`,
    [
        param('id').exists().withMessage('slug is required'),
        body('page').isString().notEmpty().withMessage('"page" is required'),
        body('content').exists().withMessage('"content" is required'),
        body('active').exists().isBoolean()
    ],
    validateRequest,
    cms.add
)

cmsRouter.patch(
    `${BASE_ROUTE}/:id`,
    [
        param('id').exists().withMessage('id is required'),
        body('page').optional().isString().withMessage('page must be a string'),
        body('content').optional(),
        body('active').optional().isBoolean()
    ],
    validateRequest,
    cms.edit
)

cmsRouter.delete(
    `${BASE_ROUTE}/:id`,
    [param('id').isNumeric().withMessage('id must be provided and a number')],
    validateRequest,
    cms.remove
)

export default cmsRouter
