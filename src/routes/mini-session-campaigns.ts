import { Router } from 'express'
import { body, param, query } from 'express-validator'

import miniSessionCampaigns from '../controllers/mini-session-campaigns'
import { requireMediaAdminSession, validateRequest } from './middleware'

const router: Router = Router()
const BASE_ROUTE = '/api/mini-session-campaigns'

const websiteSlugValidator = param('websiteSlug')
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 100 })
    .withMessage('websiteSlug is required and must be at most 100 characters')

const campaignIdValidator = param('campaignId')
    .isUUID()
    .withMessage('campaignId must be a UUID')

const campaignBodyValidator = body('campaign')
    .isObject()
    .withMessage('campaign must be an object')

const expectedUpdatedAtValidator = body('expectedUpdatedAt')
    .isISO8601({ strict: true, strictSeparator: true })
    .withMessage('expectedUpdatedAt must be an ISO-8601 timestamp')

router.get(
    `${BASE_ROUTE}/:websiteSlug/active`,
    [websiteSlugValidator],
    validateRequest,
    miniSessionCampaigns.getActive
)

router.get(
    `${BASE_ROUTE}/:websiteSlug/admin`,
    requireMediaAdminSession,
    [
        websiteSlugValidator,
        query('includeArchived')
            .optional()
            .isBoolean()
            .withMessage('includeArchived must be a boolean'),
    ],
    validateRequest,
    miniSessionCampaigns.listAdmin
)

router.get(
    `${BASE_ROUTE}/:websiteSlug/admin/:campaignId`,
    requireMediaAdminSession,
    [websiteSlugValidator, campaignIdValidator],
    validateRequest,
    miniSessionCampaigns.getAdmin
)

router.post(
    `${BASE_ROUTE}/:websiteSlug/admin`,
    requireMediaAdminSession,
    [websiteSlugValidator, campaignBodyValidator],
    validateRequest,
    miniSessionCampaigns.create
)

router.patch(
    `${BASE_ROUTE}/:websiteSlug/admin/:campaignId`,
    requireMediaAdminSession,
    [
        websiteSlugValidator,
        campaignIdValidator,
        campaignBodyValidator,
        expectedUpdatedAtValidator,
        body('campaign.status')
            .not()
            .exists()
            .withMessage('Use an explicit lifecycle action to change status'),
    ],
    validateRequest,
    miniSessionCampaigns.update
)

router.post(
    `${BASE_ROUTE}/:websiteSlug/admin/:campaignId/duplicate`,
    requireMediaAdminSession,
    [websiteSlugValidator, campaignIdValidator, expectedUpdatedAtValidator],
    validateRequest,
    miniSessionCampaigns.duplicate
)

router.post(
    `${BASE_ROUTE}/:websiteSlug/admin/:campaignId/publish`,
    requireMediaAdminSession,
    [
        websiteSlugValidator,
        campaignIdValidator,
        expectedUpdatedAtValidator,
        body('calComVerified')
            .custom(value => value === true)
            .withMessage('calComVerified must be true before publishing'),
    ],
    validateRequest,
    miniSessionCampaigns.publish
)

router.post(
    `${BASE_ROUTE}/:websiteSlug/admin/:campaignId/mark-sold-out`,
    requireMediaAdminSession,
    [websiteSlugValidator, campaignIdValidator, expectedUpdatedAtValidator],
    validateRequest,
    miniSessionCampaigns.markSoldOut
)

router.post(
    `${BASE_ROUTE}/:websiteSlug/admin/:campaignId/close`,
    requireMediaAdminSession,
    [websiteSlugValidator, campaignIdValidator, expectedUpdatedAtValidator],
    validateRequest,
    miniSessionCampaigns.close
)

router.post(
    `${BASE_ROUTE}/:websiteSlug/admin/:campaignId/archive`,
    requireMediaAdminSession,
    [websiteSlugValidator, campaignIdValidator, expectedUpdatedAtValidator],
    validateRequest,
    miniSessionCampaigns.archive
)

export default router
