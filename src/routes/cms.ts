import { Router } from 'express'
import { body, param } from 'express-validator'
import { validateRequest } from './middleware'
import cms from '../controllers/cms'

const cmsRouter: Router = Router()

cmsRouter.post(
    '/:clientSlug',
    [
        param('clientSlug').exists().withMessage('slug is required'),
        body('page').isString().notEmpty().withMessage('"page" is required'),
        body('content').exists().withMessage('"content" is required'),
        body('active').exists().isBoolean()
    ],
    validateRequest,
    cms.add
)

// TODO: Add user verification to endpoints when we have it built into the ui, for appropriate routes that are not public
cmsRouter.get('/', cms.get)

export default cmsRouter
