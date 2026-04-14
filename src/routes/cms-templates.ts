import { Router } from 'express'
import { body, param } from 'express-validator'

import controller from '../controllers/cms-templates'
import {
    requireAuth,
    requireCmsAccess,
    requirePvsAdmin,
} from './auth-middleware'
import { authReadLimit, sensitiveWriteLimit } from './rate-limits'

const router = Router()

const SLUG_REGEX = /^[a-z0-9-]+$/

router.get(
    '/api/cms/clients/:clientId/templates',
    requireAuth,
    authReadLimit,
    requireCmsAccess('view'),
    [
        param('clientId')
            .isUUID()
            .withMessage('clientId must be a valid UUID'),
    ],
    controller.list
)

router.get(
    '/api/cms/templates/:id',
    requireAuth,
    authReadLimit,
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    controller.getById
)

router.post(
    '/api/cms/clients/:clientId/templates',
    requireAuth,
    sensitiveWriteLimit,
    requirePvsAdmin,
    [
        param('clientId')
            .isUUID()
            .withMessage('clientId must be a valid UUID'),
        body('slug')
            .isString()
            .matches(SLUG_REGEX)
            .withMessage(
                'slug must contain only lowercase letters, numbers, and hyphens'
            )
            .isLength({ max: 64 })
            .withMessage('slug must be at most 64 characters'),
        body('label')
            .isString()
            .notEmpty()
            .withMessage('label required')
            .isLength({ max: 200 })
            .withMessage('label must be at most 200 characters'),
        body('description')
            .optional({ nullable: true })
            .isString()
            .isLength({ max: 2000 })
            .withMessage('description must be at most 2000 characters'),
        body('fields').isArray({ min: 0 }).withMessage('fields must be an array'),
        body('active').optional().isBoolean(),
    ],
    controller.create
)

router.patch(
    '/api/cms/templates/:id',
    requireAuth,
    sensitiveWriteLimit,
    requirePvsAdmin,
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        body('slug')
            .optional()
            .isString()
            .matches(SLUG_REGEX)
            .withMessage(
                'slug must contain only lowercase letters, numbers, and hyphens'
            )
            .isLength({ max: 64 })
            .withMessage('slug must be at most 64 characters'),
        body('label')
            .optional()
            .isString()
            .notEmpty()
            .isLength({ max: 200 })
            .withMessage('label must be at most 200 characters'),
        body('description')
            .optional({ nullable: true })
            .isString()
            .isLength({ max: 2000 })
            .withMessage('description must be at most 2000 characters'),
        body('fields').optional().isArray(),
        body('active').optional().isBoolean(),
    ],
    controller.update
)

router.delete(
    '/api/cms/templates/:id',
    requireAuth,
    sensitiveWriteLimit,
    requirePvsAdmin,
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    controller.remove
)

export default router
