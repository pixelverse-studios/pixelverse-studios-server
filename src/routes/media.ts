import { Router } from 'express'
import { body, param } from 'express-validator'

import media from '../controllers/media'
import { requireMediaAdminSession, validateRequest } from './middleware'

const router: Router = Router()
const BASE_ROUTE = '/api/media'

router.get(
    `${BASE_ROUTE}/:websiteSlug/catalog`,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
    ],
    validateRequest,
    media.getPublicCatalog
)

router.get(
    `${BASE_ROUTE}/:websiteSlug/placements`,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
    ],
    validateRequest,
    media.getPublicPlacements
)

router.get(
    `${BASE_ROUTE}/:websiteSlug/admin/catalog`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
    ],
    validateRequest,
    media.getAdminCatalog
)

router.get(
    `${BASE_ROUTE}/:websiteSlug/admin/placements`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
    ],
    validateRequest,
    media.getAdminPlacements
)

router.put(
    `${BASE_ROUTE}/:websiteSlug/admin/placements/:slotKey`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
        param('slotKey')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('slotKey is required'),
        body('media_id')
            .isInt({ min: 1 })
            .withMessage('media_id must be a positive integer'),
    ],
    validateRequest,
    media.assignPlacement
)

router.delete(
    `${BASE_ROUTE}/:websiteSlug/admin/placements/:slotKey`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
        param('slotKey')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('slotKey is required'),
    ],
    validateRequest,
    media.clearPlacement
)

router.get(
    `${BASE_ROUTE}/:websiteSlug/admin/objects`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
    ],
    validateRequest,
    media.listObjects
)

router.post(
    `${BASE_ROUTE}/:websiteSlug/admin/revalidate`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
        body('reason')
            .optional()
            .isIn([
                'manual',
                'published',
                'archived',
                'restored',
                'metadata_edited',
                'reorder_changed',
                'renamed_moved',
                'placement_assigned',
                'placement_replaced',
                'placement_cleared',
            ])
            .withMessage('reason must be a valid media revalidation reason'),
        body('media_id')
            .optional()
            .isInt({ min: 1 })
            .withMessage('media_id must be a positive integer'),
        body('media_key')
            .optional()
            .isString()
            .trim()
            .notEmpty()
            .withMessage('media_key must be a non-empty string'),
    ],
    validateRequest,
    media.revalidateCatalog
)

router.post(
    `${BASE_ROUTE}/:websiteSlug/admin/objects/check-destination`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
        body('destination_key')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('destination_key is required'),
        body('exclude_media_id')
            .optional()
            .isInt({ min: 1 })
            .withMessage('exclude_media_id must be a positive integer'),
    ],
    validateRequest,
    media.checkDestination
)

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

router.post(
    `${BASE_ROUTE}/:websiteSlug/admin/items`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
        body('key').isString().trim().notEmpty().withMessage('key is required'),
        body('filename')
            .optional()
            .isString()
            .trim()
            .notEmpty()
            .withMessage('filename must be a non-empty string'),
        body('src')
            .optional()
            .isURL({ require_protocol: true })
            .withMessage('src must be a valid URL'),
        body('alt')
            .optional()
            .isString()
            .withMessage('alt must be a string'),
        body('library')
            .optional({ nullable: true })
            .isString()
            .withMessage('library must be a string'),
        body('siteCategory')
            .optional({ nullable: true })
            .isString()
            .withMessage('siteCategory must be a string'),
        body('service')
            .optional({ nullable: true })
            .isString()
            .withMessage('service must be a string'),
        body('subCategory')
            .optional({ nullable: true })
            .isString()
            .withMessage('subCategory must be a string'),
        body('aspectRatio')
            .optional({ nullable: true })
            .isString()
            .withMessage('aspectRatio must be a string'),
        body('sortOrder')
            .optional()
            .isInt({ min: 0 })
            .withMessage('sortOrder must be a non-negative integer'),
    ],
    validateRequest,
    media.createCatalogItem
)

router.patch(
    `${BASE_ROUTE}/:websiteSlug/admin/items/batch`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
        body('ids')
            .isArray({ min: 1, max: 50 })
            .withMessage('ids must be a non-empty array of up to 50 items'),
        body('ids.*')
            .isInt({ min: 1 })
            .withMessage('ids must contain positive integers'),
        body('status')
            .isIn(['archived'])
            .withMessage('status must be archived'),
    ],
    validateRequest,
    media.batchUpdateCatalogItems
)

router.post(
    `${BASE_ROUTE}/:websiteSlug/admin/items/:id/move`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
        param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
        body('destination_key')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('destination_key is required'),
    ],
    validateRequest,
    media.moveCatalogItem
)

router.patch(
    `${BASE_ROUTE}/:websiteSlug/admin/items/:id`,
    requireMediaAdminSession,
    [
        param('websiteSlug')
            .isString()
            .trim()
            .notEmpty()
            .withMessage('websiteSlug is required'),
        param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
        body('key')
            .optional()
            .isString()
            .trim()
            .notEmpty()
            .withMessage('key must be a non-empty string'),
        body('filename')
            .optional()
            .isString()
            .trim()
            .notEmpty()
            .withMessage('filename must be a non-empty string'),
        body('src')
            .optional()
            .isURL({ require_protocol: true })
            .withMessage('src must be a valid URL'),
        body('alt')
            .optional()
            .isString()
            .withMessage('alt must be a string'),
        body('library')
            .optional({ nullable: true })
            .isString()
            .withMessage('library must be a string'),
        body('siteCategory')
            .optional({ nullable: true })
            .isString()
            .withMessage('siteCategory must be a string'),
        body('service')
            .optional({ nullable: true })
            .isString()
            .withMessage('service must be a string'),
        body('subCategory')
            .optional({ nullable: true })
            .isString()
            .withMessage('subCategory must be a string'),
        body('aspectRatio')
            .optional({ nullable: true })
            .isString()
            .withMessage('aspectRatio must be a string'),
        body('status')
            .optional()
            .isString()
            .withMessage('status must be a string'),
        body('sortOrder')
            .optional()
            .isInt({ min: 0 })
            .withMessage('sortOrder must be a non-negative integer'),
    ],
    validateRequest,
    media.updateCatalogItem
)

export default router
