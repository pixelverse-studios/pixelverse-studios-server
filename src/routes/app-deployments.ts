import { Router } from 'express'
import { body, param, query } from 'express-validator'

import { validateRequest } from './middleware'
import appDeployments from '../controllers/app-deployments'

const router = Router()

// Environment validation
const environmentValidator = body('environment')
    .optional()
    .isIn(['development', 'staging', 'production'])
    .withMessage(
        'environment must be "development", "staging", or "production"'
    )

// Status validation
const statusValidator = body('status')
    .isIn(['pending', 'deploying', 'deployed', 'failed', 'rolled_back'])
    .withMessage(
        'status must be "pending", "deploying", "deployed", "failed", or "rolled_back"'
    )

// POST /api/app-deployments - Create new app deployment
router.post(
    '/api/app-deployments',
    [
        body('app_id').isUUID().withMessage('app_id must be a valid UUID'),
        body('version')
            .isString()
            .notEmpty()
            .withMessage('version is required'),
        environmentValidator,
        body('deploy_summary')
            .isString()
            .notEmpty()
            .withMessage('deploy_summary is required'),
        body('commit_sha')
            .optional()
            .isString()
            .isLength({ min: 7, max: 40 })
            .withMessage('commit_sha must be 7-40 characters'),
        body('commit_url')
            .optional()
            .isURL()
            .withMessage('commit_url must be a valid URL'),
        body('internal_notes')
            .optional()
            .isString()
            .withMessage('internal_notes must be a string'),
        body('deployed_by')
            .optional()
            .isString()
            .withMessage('deployed_by must be a string')
    ],
    validateRequest,
    appDeployments.create
)

// GET /api/app-deployments/active - Get pending/deploying deployments
// IMPORTANT: This must come BEFORE /api/app-deployments/:id
router.get(
    '/api/app-deployments/active',
    [
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 })
            .withMessage('limit must be between 1 and 100')
    ],
    validateRequest,
    appDeployments.getActive
)

// GET /api/app-deployments/:id - Get specific deployment
router.get(
    '/api/app-deployments/:id',
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    validateRequest,
    appDeployments.getById
)

// GET /api/apps/:appId/deployments - Get deployment history for an app
router.get(
    '/api/apps/:appId/deployments',
    [
        param('appId').isUUID().withMessage('appId must be a valid UUID'),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 })
            .withMessage('limit must be between 1 and 100'),
        query('offset')
            .optional()
            .isInt({ min: 0 })
            .withMessage('offset must be a non-negative integer'),
        query('environment')
            .optional()
            .isIn(['development', 'staging', 'production'])
            .withMessage(
                'environment must be "development", "staging", or "production"'
            )
    ],
    validateRequest,
    appDeployments.getByApp
)

// GET /api/apps/:appId/deployments/latest - Get latest deployment per environment
router.get(
    '/api/apps/:appId/deployments/latest',
    [param('appId').isUUID().withMessage('appId must be a valid UUID')],
    validateRequest,
    appDeployments.getLatest
)

// PATCH /api/app-deployments/:id/status - Update deployment status
router.patch(
    '/api/app-deployments/:id/status',
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        statusValidator,
        body('rollback_reason')
            .optional()
            .isString()
            .withMessage('rollback_reason must be a string')
    ],
    validateRequest,
    appDeployments.updateStatus
)

export default router
