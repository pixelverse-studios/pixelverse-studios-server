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

export default cmsRouter
