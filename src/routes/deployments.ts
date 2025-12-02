import { Router } from 'express'
import { body, param, query } from 'express-validator'

import { validateRequest } from './middleware'
import deployments from '../controllers/deployments'

const router = Router()

// Status validation - only allow 'requested' or 'indexed'
const statusValidator = body('status')
    .isIn(['requested', 'indexed'])
    .withMessage('status must be either "requested" or "indexed"')

// POST /api/deployments - Create a new deployment record
router.post(
    '/api/deployments',
    [
        body('website_id')
            .isUUID()
            .withMessage('website_id must be a valid UUID'),
        body('changed_urls')
            .isArray({ min: 1 })
            .withMessage('changed_urls must be a non-empty array'),
        body('changed_urls.*')
            .isURL()
            .withMessage('Each URL must be valid'),
        body('deploy_summary')
            .isString()
            .notEmpty()
            .withMessage('deploy_summary is required and must be markdown'),
        body('internal_notes')
            .optional()
            .isString()
            .withMessage('internal_notes must be a string if provided')
    ],
    validateRequest,
    deployments.create
)

// GET /api/websites/:websiteId/deployments - Get deployment history for a website
router.get(
    '/api/websites/:websiteId/deployments',
    [
        param('websiteId')
            .isUUID()
            .withMessage('websiteId must be a valid UUID'),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 })
            .withMessage('limit must be between 1 and 100'),
        query('offset')
            .optional()
            .isInt({ min: 0 })
            .withMessage('offset must be a non-negative integer')
    ],
    validateRequest,
    deployments.getByWebsite
)

// GET /api/deployments/unindexed - Get all deployments not yet fully indexed
// IMPORTANT: This must come BEFORE /api/deployments/:id to avoid route collision
router.get(
    '/api/deployments/unindexed',
    [
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 })
            .withMessage('limit must be between 1 and 100')
    ],
    validateRequest,
    deployments.getUnindexed
)

// GET /api/deployments/:id - Get a specific deployment by ID
router.get(
    '/api/deployments/:id',
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    validateRequest,
    deployments.getById
)

// ============================================================================
// NEW THREE-STATE ENDPOINTS
// ============================================================================

// PATCH /api/deployments/:id/status - Update deployment status (bulk update all URLs)
// Body: { status: 'requested' | 'indexed' }
router.patch(
    '/api/deployments/:id/status',
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        statusValidator
    ],
    validateRequest,
    deployments.updateDeploymentStatus
)

// PATCH /api/deployments/:id/urls/status - Update a single URL's status
// Body: { url: string, status: 'requested' | 'indexed' }
router.patch(
    '/api/deployments/:id/urls/status',
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        body('url').isURL().withMessage('url must be a valid URL'),
        statusValidator
    ],
    validateRequest,
    deployments.updateUrlStatus
)

// PATCH /api/deployments/:id/urls/batch - Batch update multiple URLs' status
// Body: { urls: string[], status: 'requested' | 'indexed' }
router.patch(
    '/api/deployments/:id/urls/batch',
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        body('urls')
            .isArray({ min: 1 })
            .withMessage('urls must be a non-empty array'),
        body('urls.*')
            .isURL()
            .withMessage('Each URL must be valid'),
        statusValidator
    ],
    validateRequest,
    deployments.updateUrlsBatch
)

// ============================================================================
// LEGACY ENDPOINTS (for backward compatibility)
// ============================================================================

// PATCH /api/deployments/:id/indexed - Mark entire deployment as indexed in GSC
// @deprecated Use PATCH /api/deployments/:id/status with { status: 'indexed' }
router.patch(
    '/api/deployments/:id/indexed',
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    validateRequest,
    deployments.markAsIndexed
)

// PATCH /api/deployments/:id/urls/indexed - Mark specific URL as indexed
// @deprecated Use PATCH /api/deployments/:id/urls/status with { url, status: 'indexed' }
router.patch(
    '/api/deployments/:id/urls/indexed',
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        body('url').isURL().withMessage('url must be a valid URL')
    ],
    validateRequest,
    deployments.markUrlAsIndexed
)

export default router
