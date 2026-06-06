import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import mediaCatalogService from '../services/media-catalog'
import mediaPlacementsService from '../services/media-placements'
import mediaR2Service from '../services/media-r2'
import mediaRevalidationService from '../services/media-revalidation'
import { MediaValidationError } from '../lib/media-r2'
import { handleGenericError } from '../utils/http'

const presignUploadSchema = z.object({
    filename: z.string().trim().min(1).max(255),
    content_type: z.string().trim().min(1).max(100),
    folder: z.string().trim().max(500).optional(),
    size: z.number().int().positive(),
})

const checkDestinationSchema = z.object({
    destination_key: z.string().trim().min(1).max(1000),
    exclude_media_id: z.number().int().positive().optional(),
})

const moveCatalogItemSchema = z.object({
    destination_key: z.string().trim().min(1).max(1000),
})

const revalidateCatalogSchema = z.object({
    reason: z
        .enum([
            'manual',
            'published',
            'archived',
            'restored',
            'metadata_edited',
            'reorder_changed',
            'renamed_moved',
        ])
        .optional()
        .default('manual'),
    media_id: z.number().int().positive().optional(),
    media_key: z.string().trim().min(1).max(1000).optional(),
})

const nullableCatalogString = z
    .union([z.string().trim().max(255), z.null()])
    .optional()

const createCatalogItemSchema = z.object({
    key: z.string().trim().min(1).max(1000),
    filename: z.string().trim().min(1).max(255).optional(),
    src: z.string().trim().url().max(2000).optional(),
    alt: z.string().trim().max(1000).optional(),
    service: nullableCatalogString,
    subCategory: nullableCatalogString,
    aspectRatio: nullableCatalogString,
    sortOrder: z.number().int().min(0).optional(),
})

const updateCatalogItemSchema = createCatalogItemSchema
    .partial()
    .extend({
        status: z.string().trim().max(50).optional(),
    })
    .refine(value => Object.keys(value).length > 0, {
        message: 'At least one field is required.',
    })

const assignPlacementSchema = z.object({
    media_id: z.number().int().positive(),
})

const sendMediaError = (
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
): Response =>
    res.status(status).json({
        error: {
            code,
            message,
            ...(details && { details }),
        },
    })

const presignUpload = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const { websiteSlug } = req.params
        const parsed = presignUploadSchema.parse(req.body)
        const result = await mediaR2Service.createPresignedUpload({
            websiteSlug,
            filename: parsed.filename,
            contentType: parsed.content_type,
            folder: parsed.folder,
            size: parsed.size,
        })

        return res.status(200).json(result)
    } catch (err) {
        if (err instanceof ZodError) {
            return sendMediaError(
                res,
                400,
                'media.invalid_payload',
                'Invalid upload presign payload.',
                err.flatten()
            )
        }

        if (err instanceof MediaValidationError) {
            return sendMediaError(
                res,
                err.status,
                err.code,
                err.message,
                err.details
            )
        }

        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404
                    ? 'media.website_not_found'
                    : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

const listObjects = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const prefix =
            typeof req.query.prefix === 'string' ? req.query.prefix : undefined
        const result = await mediaR2Service.listObjects({
            websiteSlug: req.params.websiteSlug,
            prefix,
        })

        res.set('Cache-Control', 'no-store')
        return res.status(200).json(result)
    } catch (err) {
        if (err instanceof MediaValidationError) {
            return sendMediaError(
                res,
                err.status,
                err.code,
                err.message,
                err.details
            )
        }

        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404
                    ? 'media.website_not_found'
                    : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

const checkDestination = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const parsed = checkDestinationSchema.parse(req.body)
        const result = await mediaR2Service.checkDestination({
            websiteSlug: req.params.websiteSlug,
            destinationKey: parsed.destination_key,
            excludeMediaId: parsed.exclude_media_id,
        })

        return res.status(200).json(result)
    } catch (err) {
        if (err instanceof ZodError) {
            return sendMediaError(
                res,
                400,
                'media.invalid_payload',
                'Invalid destination check payload.',
                err.flatten()
            )
        }

        if (err instanceof MediaValidationError) {
            return sendMediaError(
                res,
                err.status,
                err.code,
                err.message,
                err.details
            )
        }

        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404
                    ? 'media.website_not_found'
                    : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

const moveCatalogItem = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const parsed = moveCatalogItemSchema.parse(req.body)
        const result = await mediaR2Service.moveCatalogItemObject({
            websiteSlug: req.params.websiteSlug,
            id: Number(req.params.id),
            destinationKey: parsed.destination_key,
            actor: req.mediaAdmin?.email,
        })

        return res.status(200).json(result)
    } catch (err) {
        if (err instanceof ZodError) {
            return sendMediaError(
                res,
                400,
                'media.invalid_payload',
                'Invalid media move payload.',
                err.flatten()
            )
        }

        if (err instanceof MediaValidationError) {
            return sendMediaError(
                res,
                err.status,
                err.code,
                err.message,
                err.details
            )
        }

        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404 ? 'media.not_found' : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

const getPublicCatalog = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const catalog = await mediaCatalogService.listCatalog({
            websiteSlug: req.params.websiteSlug,
            includeAdminFields: false,
        })

        res.set('Cache-Control', mediaRevalidationService.publicCatalogCacheControl())
        return res.status(200).json(catalog)
    } catch (err) {
        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404
                    ? 'media.website_not_found'
                    : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

const getPublicPlacements = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const placements = await mediaPlacementsService.listPublicPlacements({
            websiteSlug: req.params.websiteSlug,
        })

        res.set('Cache-Control', mediaRevalidationService.publicCatalogCacheControl())
        return res.status(200).json(placements)
    } catch (err) {
        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404
                    ? 'media.website_not_found'
                    : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

const revalidateCatalog = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const parsed = revalidateCatalogSchema.parse(req.body || {})
        const result = await mediaRevalidationService.triggerMediaRevalidation({
            websiteSlug: req.params.websiteSlug,
            reason: parsed.reason,
            mediaId: parsed.media_id,
            mediaKey: parsed.media_key,
            actor: req.mediaAdmin?.email,
        })

        res.set('Cache-Control', 'no-store')
        return res.status(200).json(result)
    } catch (err) {
        if (err instanceof ZodError) {
            return sendMediaError(
                res,
                400,
                'media.invalid_payload',
                'Invalid media revalidation payload.',
                err.flatten()
            )
        }

        if (err instanceof MediaValidationError) {
            return sendMediaError(
                res,
                err.status,
                err.code,
                err.message,
                err.details
            )
        }

        return handleGenericError(err, res)
    }
}

const getAdminCatalog = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const catalog = await mediaCatalogService.listCatalog({
            websiteSlug: req.params.websiteSlug,
            includeAdminFields: true,
        })

        res.set('Cache-Control', 'no-store')
        return res.status(200).json(catalog)
    } catch (err) {
        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404
                    ? 'media.website_not_found'
                    : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

const getAdminPlacements = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const placements = await mediaPlacementsService.listAdminPlacements({
            websiteSlug: req.params.websiteSlug,
        })

        res.set('Cache-Control', 'no-store')
        return res.status(200).json(placements)
    } catch (err) {
        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404
                    ? 'media.website_not_found'
                    : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

const assignPlacement = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const parsed = assignPlacementSchema.parse(req.body)
        const placement = await mediaPlacementsService.assignPlacement({
            websiteSlug: req.params.websiteSlug,
            slotKey: req.params.slotKey,
            mediaId: parsed.media_id,
            actor: req.mediaAdmin?.email,
        })

        res.set('Cache-Control', 'no-store')
        return res.status(200).json(placement)
    } catch (err) {
        if (err instanceof ZodError) {
            return sendMediaError(
                res,
                400,
                'media.invalid_payload',
                'Invalid media placement payload.',
                err.flatten()
            )
        }

        if (err instanceof MediaValidationError) {
            return sendMediaError(
                res,
                err.status,
                err.code,
                err.message,
                err.details
            )
        }

        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404 ? 'media.not_found' : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

const clearPlacement = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const result = await mediaPlacementsService.clearPlacement({
            websiteSlug: req.params.websiteSlug,
            slotKey: req.params.slotKey,
        })

        res.set('Cache-Control', 'no-store')
        return res.status(200).json(result)
    } catch (err) {
        if (err instanceof MediaValidationError) {
            return sendMediaError(
                res,
                err.status,
                err.code,
                err.message,
                err.details
            )
        }

        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404
                    ? 'media.website_not_found'
                    : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

const createCatalogItem = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const parsed = createCatalogItemSchema.parse(req.body)
        const item = await mediaCatalogService.createItem({
            websiteSlug: req.params.websiteSlug,
            key: parsed.key,
            filename: parsed.filename,
            src: parsed.src,
            alt: parsed.alt,
            service: parsed.service,
            subCategory: parsed.subCategory,
            aspectRatio: parsed.aspectRatio,
            sortOrder: parsed.sortOrder,
            actor: req.mediaAdmin?.email,
        })

        return res.status(201).json(item)
    } catch (err) {
        if (err instanceof ZodError) {
            return sendMediaError(
                res,
                400,
                'media.invalid_payload',
                'Invalid media catalog item payload.',
                err.flatten()
            )
        }

        if (err instanceof MediaValidationError) {
            return sendMediaError(
                res,
                err.status,
                err.code,
                err.message,
                err.details
            )
        }

        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404
                    ? 'media.website_not_found'
                    : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

const updateCatalogItem = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const parsed = updateCatalogItemSchema.parse(req.body)
        const itemId = Number(req.params.id)
        const item = await mediaCatalogService.updateItem({
            websiteSlug: req.params.websiteSlug,
            id: itemId,
            key: parsed.key,
            filename: parsed.filename,
            src: parsed.src,
            alt: parsed.alt,
            service: parsed.service,
            subCategory: parsed.subCategory,
            aspectRatio: parsed.aspectRatio,
            sortOrder: parsed.sortOrder,
            status: parsed.status,
            actor: req.mediaAdmin?.email,
        })

        return res.status(200).json(item)
    } catch (err) {
        if (err instanceof ZodError) {
            return sendMediaError(
                res,
                400,
                'media.invalid_payload',
                'Invalid media catalog item payload.',
                err.flatten()
            )
        }

        if (err instanceof MediaValidationError) {
            return sendMediaError(
                res,
                err.status,
                err.code,
                err.message,
                err.details
            )
        }

        if (typeof (err as { status?: unknown })?.status === 'number') {
            const status = (err as { status: number }).status
            const message =
                err instanceof Error ? err.message : 'Media request failed'
            const code =
                status === 404
                    ? 'media.not_found'
                    : 'media.r2_not_configured'

            return sendMediaError(res, status, code, message)
        }

        return handleGenericError(err, res)
    }
}

export default {
    presignUpload,
    listObjects,
    checkDestination,
    moveCatalogItem,
    getPublicCatalog,
    getPublicPlacements,
    getAdminCatalog,
    getAdminPlacements,
    revalidateCatalog,
    createCatalogItem,
    updateCatalogItem,
    assignPlacement,
    clearPlacement,
}
