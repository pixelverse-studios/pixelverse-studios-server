import { Router } from 'express'
import { body, param } from 'express-validator'

import media from '../controllers/media'
import { requireMediaAdminSession, validateRequest } from './middleware'

const router: Router = Router()
const BASE_ROUTE = '/api/media'

router.post(
    `${BASE_ROUTE}/:websiteSlug/admin/uploads/presign`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
        body('filename')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('filename is required'),
        body('content_type')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('content_type is required'),
        body('folder')
            .optional()
            .isString()
            .withMessage('folder must be a string'),
        body('size')
            .isInt({ min: 1 })
            .withMessage('size must be a positive integer'),
    ],
    validateRequest,
    media.presignUpload
)

export default router
