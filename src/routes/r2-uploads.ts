import { Router } from 'express'
import { body, param } from 'express-validator'

import controller from '../controllers/r2-uploads'
import { requireAuth } from './auth-middleware'
import { validateRequest } from './middleware'

const router = Router()

const ALLOWED_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
]

router.post(
    '/api/cms/websites/:websiteId/upload/presign',
    requireAuth,
    [
        param('websiteId').isUUID().withMessage('websiteId must be a UUID'),
        body('filename')
            .isString()
            .notEmpty()
            .isLength({ max: 255 })
            .matches(/^[^/\\]+$/)
            .withMessage('filename must not contain slashes'),
        body('content_type')
            .isString()
            .isIn(ALLOWED_CONTENT_TYPES)
            .withMessage('content_type must be a supported image type'),
        body('folder')
            .optional({ nullable: true, checkFalsy: true })
            .isString()
            .isLength({ max: 200 })
            .matches(/^[a-z0-9][a-z0-9-/]*[a-z0-9]$|^[a-z0-9]$/)
            .withMessage('folder must be lowercase and safe'),
    ],
    validateRequest,
    controller.presign
)

router.delete(
    '/api/cms/websites/:websiteId/upload',
    requireAuth,
    [
        param('websiteId').isUUID().withMessage('websiteId must be a UUID'),
        body('r2_key')
            .isString()
            .notEmpty()
            .isLength({ max: 1024 })
            .withMessage('r2_key is required'),
    ],
    validateRequest,
    controller.remove
)

export default router
