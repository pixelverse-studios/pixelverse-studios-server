import { Router } from 'express'
import { body, param } from 'express-validator'

import controller from '../controllers/cms-templates'
import {
    requireAuth,
    requireCmsAccess,
    requirePvsAdmin,
} from './auth-middleware'

const router = Router()

const SLUG_REGEX = /^[a-z0-9-]+$/

router.get(
    '/api/cms/clients/:clientId/templates',
    requireAuth,
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
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    controller.getById
)

router.post(
    '/api/cms/clients/:clientId/templates',
    requireAuth,
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
            ),
        body('label').isString().notEmpty().withMessage('label required'),
        body('description').optional({ nullable: true }).isString(),
        body('fields').isArray({ min: 0 }).withMessage('fields must be an array'),
        body('active').optional().isBoolean(),
    ],
    controller.create
)

router.patch(
    '/api/cms/templates/:id',
    requireAuth,
    requirePvsAdmin,
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        body('slug')
            .optional()
            .isString()
            .matches(SLUG_REGEX)
            .withMessage(
                'slug must contain only lowercase letters, numbers, and hyphens'
            ),
        body('label').optional().isString().notEmpty(),
        body('description').optional({ nullable: true }).isString(),
        body('fields').optional().isArray(),
        body('active').optional().isBoolean(),
    ],
    controller.update
)

router.delete(
    '/api/cms/templates/:id',
    requireAuth,
    requirePvsAdmin,
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    controller.remove
)

export default router
