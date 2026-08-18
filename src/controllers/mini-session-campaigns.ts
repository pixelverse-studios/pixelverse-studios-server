import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import {
    miniSessionCampaignInputSchema,
    MiniSessionDomainError,
    MiniSessionDomainErrorCode,
} from '../lib/mini-session-campaigns'
import miniSessionCampaigns from '../services/mini-session-campaigns'
import siteContentRevalidation, {
    MiniSessionRevalidationReason,
    SiteContentRevalidationError,
} from '../services/site-content-revalidation'
import { handleGenericError } from '../utils/http'

const campaignBodySchema = z
    .object({ campaign: miniSessionCampaignInputSchema })
    .strict()

const mutationBodySchema = z
    .object({ expectedUpdatedAt: z.string().datetime({ offset: true }) })
    .strict()

const updateBodySchema = z
    .object({
        expectedUpdatedAt: z.string().datetime({ offset: true }),
        campaign: miniSessionCampaignInputSchema,
    })
    .strict()

const publishBodySchema = mutationBodySchema
    .extend({ calComVerified: z.literal(true) })
    .strict()

interface ApiErrorShape {
    status: number
    code: string
    message: string
    details?: unknown
    retryable: boolean
}

const DOMAIN_ERROR_MAP: Record<
    MiniSessionDomainErrorCode,
    Omit<ApiErrorShape, 'message' | 'details'>
> = {
    VALIDATION_ERROR: {
        status: 400,
        code: 'mini_sessions.invalid_payload',
        retryable: false,
    },
    WEBSITE_NOT_FOUND: {
        status: 404,
        code: 'mini_sessions.website_not_found',
        retryable: false,
    },
    CAMPAIGN_NOT_FOUND: {
        status: 404,
        code: 'mini_sessions.campaign_not_found',
        retryable: false,
    },
    STALE_WRITE: {
        status: 409,
        code: 'mini_sessions.stale_write',
        retryable: true,
    },
    INVALID_TRANSITION: {
        status: 409,
        code: 'mini_sessions.invalid_transition',
        retryable: false,
    },
    CAMPAIGN_NOT_READY: {
        status: 422,
        code: 'mini_sessions.campaign_not_ready',
        retryable: false,
    },
    HERO_MEDIA_INVALID: {
        status: 422,
        code: 'mini_sessions.hero_media_invalid',
        retryable: false,
    },
    OPEN_OPTION_REQUIRED: {
        status: 422,
        code: 'mini_sessions.open_option_required',
        retryable: false,
    },
}

const sendApiError = (res: Response, error: ApiErrorShape): Response =>
    res.status(error.status).json({
        ok: false,
        error: {
            code: error.code,
            message: error.message,
            ...(error.details !== undefined && { details: error.details }),
            retryable: error.retryable,
        },
    })

const sendKnownError = (res: Response, error: unknown): Response | null => {
    if (error instanceof ZodError) {
        return sendApiError(res, {
            status: 400,
            code: 'mini_sessions.invalid_payload',
            message: 'Mini Sessions request payload is invalid',
            details: error.flatten(),
            retryable: false,
        })
    }

    if (error instanceof MiniSessionDomainError) {
        return sendApiError(res, {
            ...DOMAIN_ERROR_MAP[error.code],
            message: error.message,
            details: error.details,
        })
    }

    return null
}

const adminActor = (req: Request): string => {
    const actor = req.mediaAdmin?.email
    if (!actor) {
        throw new MiniSessionDomainError(
            'VALIDATION_ERROR',
            'Authenticated administrator identity is required'
        )
    }
    return actor
}

const revalidateCampaign = async (
    req: Request,
    campaignId: string,
    reason: MiniSessionRevalidationReason
): Promise<object> => {
    try {
        return await siteContentRevalidation.triggerMiniSessionRevalidation({
            websiteSlug: req.params.websiteSlug,
            campaignId,
            reason,
            actor: req.mediaAdmin?.email,
        })
    } catch (error) {
        console.error(
            `Mini Sessions campaign persisted but revalidation failed for ${campaignId}: ${reason}`,
            error
        )
        return {
            configured: true,
            triggered: false,
            skipped: false,
            error: {
                code:
                    error instanceof SiteContentRevalidationError
                        ? error.code
                        : 'site_content.revalidation_failed',
                message:
                    error instanceof Error
                        ? error.message
                        : 'Site content revalidation failed',
                ...(error instanceof SiteContentRevalidationError &&
                    error.details && { details: error.details }),
            },
        }
    }
}

const getActive = async (req: Request, res: Response): Promise<Response> => {
    try {
        const campaign = await miniSessionCampaigns.getActiveCampaign(
            req.params.websiteSlug
        )
        res.set(
            'Cache-Control',
            siteContentRevalidation.publicCampaignCacheControl()
        )

        if (!campaign) {
            return sendApiError(res, {
                status: 404,
                code: 'mini_sessions.not_found',
                message: 'No public Mini Sessions campaign is available',
                retryable: false,
            })
        }

        return res.status(200).json({ campaign })
    } catch (error) {
        if (
            error instanceof MiniSessionDomainError &&
            error.code === 'WEBSITE_NOT_FOUND'
        ) {
            res.set(
                'Cache-Control',
                siteContentRevalidation.publicCampaignCacheControl()
            )
            return sendApiError(res, {
                status: 404,
                code: 'mini_sessions.not_found',
                message: 'No public Mini Sessions campaign is available',
                retryable: false,
            })
        }

        const known = sendKnownError(res, error)
        return known || handleGenericError(error, res)
    }
}

const listAdmin = async (req: Request, res: Response): Promise<Response> => {
    try {
        const campaigns = await miniSessionCampaigns.listCampaigns({
            websiteSlug: req.params.websiteSlug,
            includeArchived: req.query.includeArchived === 'true',
        })
        res.set('Cache-Control', 'no-store')
        return res.status(200).json({ campaigns })
    } catch (error) {
        const known = sendKnownError(res, error)
        return known || handleGenericError(error, res)
    }
}

const getAdmin = async (req: Request, res: Response): Promise<Response> => {
    try {
        const campaign = await miniSessionCampaigns.getCampaign({
            websiteSlug: req.params.websiteSlug,
            campaignId: req.params.campaignId,
        })
        res.set('Cache-Control', 'no-store')
        return res.status(200).json({ campaign })
    } catch (error) {
        const known = sendKnownError(res, error)
        return known || handleGenericError(error, res)
    }
}

const create = async (req: Request, res: Response): Promise<Response> => {
    try {
        const parsed = campaignBodySchema.parse(req.body)
        const campaign = await miniSessionCampaigns.createCampaign({
            websiteSlug: req.params.websiteSlug,
            input: parsed.campaign,
            actor: adminActor(req),
        })
        res.set('Cache-Control', 'no-store')
        return res.status(201).json({ campaign })
    } catch (error) {
        const known = sendKnownError(res, error)
        return known || handleGenericError(error, res)
    }
}

const update = async (req: Request, res: Response): Promise<Response> => {
    try {
        const parsed = updateBodySchema.parse(req.body)
        const campaign = await miniSessionCampaigns.updateCampaign({
            websiteSlug: req.params.websiteSlug,
            campaignId: req.params.campaignId,
            expectedUpdatedAt: parsed.expectedUpdatedAt,
            actor: adminActor(req),
            input: parsed.campaign,
        })
        const revalidation = ['live', 'sold_out'].includes(campaign.status)
            ? await revalidateCampaign(
                  req,
                  campaign.id,
                  'campaign_updated'
              )
            : undefined

        res.set('Cache-Control', 'no-store')
        return res.status(200).json({
            campaign,
            ...(revalidation && { revalidation }),
        })
    } catch (error) {
        const known = sendKnownError(res, error)
        return known || handleGenericError(error, res)
    }
}

const duplicate = async (req: Request, res: Response): Promise<Response> => {
    try {
        const parsed = mutationBodySchema.parse(req.body)
        const campaign = await miniSessionCampaigns.duplicateCampaign({
            websiteSlug: req.params.websiteSlug,
            campaignId: req.params.campaignId,
            expectedUpdatedAt: parsed.expectedUpdatedAt,
            actor: adminActor(req),
        })
        res.set('Cache-Control', 'no-store')
        return res.status(201).json({ campaign })
    } catch (error) {
        const known = sendKnownError(res, error)
        return known || handleGenericError(error, res)
    }
}

const lifecycleAction = async (
    req: Request,
    res: Response,
    action: 'publish' | 'sold_out' | 'close' | 'archive'
): Promise<Response> => {
    try {
        const parsed =
            action === 'publish'
                ? publishBodySchema.parse(req.body)
                : mutationBodySchema.parse(req.body)
        const mutation = {
            websiteSlug: req.params.websiteSlug,
            campaignId: req.params.campaignId,
            expectedUpdatedAt: parsed.expectedUpdatedAt,
            actor: adminActor(req),
        }
        const campaign = await {
            publish: miniSessionCampaigns.publishCampaign,
            sold_out: miniSessionCampaigns.markCampaignSoldOut,
            close: miniSessionCampaigns.closeCampaign,
            archive: miniSessionCampaigns.archiveCampaign,
        }[action](mutation)
        const reason = {
            publish: 'campaign_published',
            sold_out: 'campaign_marked_sold_out',
            close: 'campaign_closed',
            archive: 'campaign_archived',
        }[action] as MiniSessionRevalidationReason
        const revalidation = await revalidateCampaign(req, campaign.id, reason)

        res.set('Cache-Control', 'no-store')
        return res.status(200).json({ campaign, revalidation })
    } catch (error) {
        const known = sendKnownError(res, error)
        return known || handleGenericError(error, res)
    }
}

export default {
    getActive,
    listAdmin,
    getAdmin,
    create,
    update,
    duplicate,
    publish: (req: Request, res: Response) =>
        lifecycleAction(req, res, 'publish'),
    markSoldOut: (req: Request, res: Response) =>
        lifecycleAction(req, res, 'sold_out'),
    close: (req: Request, res: Response) => lifecycleAction(req, res, 'close'),
    archive: (req: Request, res: Response) =>
        lifecycleAction(req, res, 'archive'),
}
