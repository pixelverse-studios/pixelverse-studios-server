import { Router } from 'express'
import { body, param, query } from 'express-validator'

import controller from '../controllers/cms-pages'
import { requireAuth, requireCmsAccess } from './auth-middleware'
import { validateRequest } from './middleware'

const router = Router()

const STATUSES = ['draft', 'published', 'archived']
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

router.get(
    '/api/cms/clients/:clientId/pages',
    requireAuth,
    requireCmsAccess('view'),
    [
        param('clientId').isUUID().withMessage('clientId must be a UUID'),
        query('status')
            .optional()
            .isIn(STATUSES)
            .withMessage(`status must be one of ${STATUSES.join(', ')}`),
    ],
    validateRequest,
    controller.list
)

router.get(
    '/api/cms/pages/:id',
    requireAuth,
    [param('id').isUUID().withMessage('id must be a UUID')],
    validateRequest,
    controller.getById
)

router.post(
    '/api/cms/clients/:clientId/pages',
    requireAuth,
    requireCmsAccess('edit'),
    [
        param('clientId').isUUID().withMessage('clientId must be a UUID'),
        body('template_id')
            .isUUID()
            .withMessage('template_id must be a UUID'),
        body('slug')
            .isString()
            .notEmpty()
            .isLength({ max: 64 })
            .matches(SLUG_REGEX)
            .withMessage(
                'slug must be lowercase alphanumeric with optional hyphens'
            ),
        body('content')
            .isObject()
            .withMessage('content must be an object'),
        body('status')
            .optional()
            .isIn(STATUSES)
            .withMessage(`status must be one of ${STATUSES.join(', ')}`),
    ],
    validateRequest,
    controller.create
)

router.patch(
    '/api/cms/pages/:id',
    requireAuth,
    [
        param('id').isUUID().withMessage('id must be a UUID'),
        body('slug')
            .optional()
            .isString()
            .isLength({ max: 64 })
            .matches(SLUG_REGEX)
            .withMessage(
                'slug must be lowercase alphanumeric with optional hyphens'
            ),
        body('content')
            .optional()
            .isObject()
            .withMessage('content must be an object'),
        body('status')
            .optional()
            .isIn(STATUSES)
            .withMessage(`status must be one of ${STATUSES.join(', ')}`),
    ],
    validateRequest,
    controller.update
)

router.post(
    '/api/cms/pages/:id/publish',
    requireAuth,
    [param('id').isUUID().withMessage('id must be a UUID')],
    validateRequest,
    controller.publish
)

router.delete(
    '/api/cms/pages/:id',
    requireAuth,
    [param('id').isUUID().withMessage('id must be a UUID')],
    validateRequest,
    controller.remove
)

export default router
