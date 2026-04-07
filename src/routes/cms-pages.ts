import { Router } from 'express'
import { body, param, query } from 'express-validator'

import controller from '../controllers/cms-pages'
import { VALID_PUBLISH_STATUSES } from '../services/cms-pages'
import { requireAuth, requireCmsAccess } from './auth-middleware'
import { validateRequest } from './middleware'
import {
    publicReadLimit,
    authReadLimit,
    authWriteLimit,
} from './rate-limits'

const router = Router()

const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const PATCH_STATUSES = ['draft', 'archived']

// Public endpoint — NO auth middleware. Used by client websites to
// fetch published CMS content. Only returns pages with status = 'published'.
router.get(
    '/api/cms/clients/:clientId/pages/:slug/published',
    publicReadLimit,
    [
        param('clientId').isUUID().withMessage('clientId must be a UUID'),
        param('slug')
            .isString()
            .notEmpty()
            .isLength({ max: 64 })
            .matches(SLUG_REGEX)
            .withMessage(
                'slug must be lowercase alphanumeric with optional hyphens'
            ),
    ],
    validateRequest,
    controller.getPublished
)

router.get(
    '/api/cms/clients/:clientId/pages',
    authReadLimit,
    requireAuth,
    requireCmsAccess('view'),
    [
        param('clientId').isUUID().withMessage('clientId must be a UUID'),
        query('status')
            .optional()
            .isIn(VALID_PUBLISH_STATUSES)
            .withMessage(
                `status must be one of ${VALID_PUBLISH_STATUSES.join(', ')}`
            ),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 })
            .toInt()
            .withMessage('limit must be an integer between 1 and 100'),
        query('offset')
            .optional()
            .isInt({ min: 0 })
            .toInt()
            .withMessage('offset must be a non-negative integer'),
    ],
    validateRequest,
    controller.list
)

router.get(
    '/api/cms/pages/:id',
    authReadLimit,
    requireAuth,
    [param('id').isUUID().withMessage('id must be a UUID')],
    validateRequest,
    controller.getById
)

router.post(
    '/api/cms/clients/:clientId/pages',
    authWriteLimit,
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
            .isIn(VALID_PUBLISH_STATUSES)
            .withMessage(
                `status must be one of ${VALID_PUBLISH_STATUSES.join(', ')}`
            ),
    ],
    validateRequest,
    controller.create
)

router.patch(
    '/api/cms/pages/:id',
    authWriteLimit,
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
            .isIn(PATCH_STATUSES)
            .withMessage(
                'status can only be set to draft or archived via PATCH; use /publish endpoint to publish'
            ),
    ],
    validateRequest,
    controller.update
)

router.post(
    '/api/cms/pages/:id/publish',
    authWriteLimit,
    requireAuth,
    [param('id').isUUID().withMessage('id must be a UUID')],
    validateRequest,
    controller.publish
)

router.delete(
    '/api/cms/pages/:id',
    authWriteLimit,
    requireAuth,
    [param('id').isUUID().withMessage('id must be a UUID')],
    validateRequest,
    controller.remove
)

export default router
