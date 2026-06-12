import { Request, Response } from 'express'
import crypto from 'crypto'
import { z, ZodError } from 'zod'

import mediaCatalogService from '../services/media-catalog'
import mediaPlacementsService from '../services/media-placements'
import mediaR2Service from '../services/media-r2'
import mediaRevalidationService from '../services/media-revalidation'
import {
    mediaUploadBatchMaxItems,
    MediaOperationError,
    MediaValidationError,
} from '../lib/media-r2'
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
            'placement_assigned',
            'placement_replaced',
            'placement_cleared',
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
    library: nullableCatalogString,
    siteCategory: nullableCatalogString,
    service: nullableCatalogString,
    subCategory: nullableCatalogString,
    aspectRatio: nullableCatalogString,
    sortOrder: z.number().int().min(0).optional(),
})

const batchCreateCatalogItemsSchema = z.object({
    items: z.array(z.unknown()).min(1).max(mediaUploadBatchMaxItems()),
})

const updateCatalogItemSchema = createCatalogItemSchema
    .partial()
    .extend({
        status: z.string().trim().max(50).optional(),
    })
    .refine(value => Object.keys(value).length > 0, {
        message: 'At least one field is required.',
    })

const batchUpdateCatalogItemsSchema = z
    .object({
        ids: z.array(z.number().int().positive()).min(1).max(50),
        status: z.enum(['archived']),
    })

const assignPlacementSchema = z.object({
    media_id: z.number().int().positive(),
})

const sendMediaError = (
    res: Response,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    options?: {
        requestId?: string
        retryable?: boolean
    }
): Response =>
    res.status(status).json({
        error: {
            code,
            message,
            ...(options?.requestId && { request_id: options.requestId }),
            ...(options?.retryable !== undefined && {
                retryable: options.retryable,
            }),
            ...(details && { details }),
        },
    })

interface MediaErrorPayload {
    status: number
    code: string
    message: string
    details?: Record<string, unknown>
    retryable?: boolean
}

const requestIdFor = (req: Request): string => {
    const header = req.headers?.['x-request-id']
    return typeof header === 'string' && header.trim()
        ? header.trim()
        : crypto.randomUUID()
}

const logMediaEvent = (
    level: 'info' | 'warn' | 'error',
    event: string,
    fields: Record<string, unknown>
): void => {
    console[level](`Media upload ${event}`, fields)
}

const knownMediaError = (
    err: unknown,
    fallbackCodes: {
        notFound: string
        unavailable?: string
    }
): MediaErrorPayload | null => {
    if (err instanceof MediaValidationError) {
        return {
            status: err.status,
            code: err.code,
            message: err.message,
            details: err.details,
            retryable: false,
        }
    }

    if (err instanceof MediaOperationError) {
        return {
            status: err.status,
            code: err.code,
            message: err.message,
            details: err.details,
            retryable: err.retryable,
        }
    }

    if (typeof (err as { status?: unknown })?.status === 'number') {
        const status = (err as { status: number }).status
        return {
            status,
            message: err instanceof Error ? err.message : 'Media request failed',
            code:
                status === 404
                    ? fallbackCodes.notFound
                    : fallbackCodes.unavailable || 'media.r2_not_configured',
            retryable: status >= 500,
        }
    }

    return null
}

const sendKnownMediaError = (
    res: Response,
    err: unknown,
    requestId: string,
    fallbackCodes: {
        notFound: string
        unavailable?: string
    }
): Response | null => {
    const payload = knownMediaError(err, fallbackCodes)
    if (!payload) return null

    return sendMediaError(
        res,
        payload.status,
        payload.code,
        payload.message,
        payload.details,
        { requestId, retryable: payload.retryable }
    )
}

const batchErrorFrom = (
    err: unknown,
    fallbackCodes: {
        notFound: string
        unavailable?: string
    }
): MediaErrorPayload => {
    if (err instanceof ZodError) {
        return {
            status: 400,
            code: 'media.invalid_payload',
            message: 'Invalid media catalog item payload.',
            details: err.flatten(),
            retryable: false,
        }
    }

    return (
        knownMediaError(err, fallbackCodes) || {
            status: 500,
            code: 'media.upload_catalog_create_failed',
            message: 'Media catalog item could not be created after upload.',
            retryable: true,
        }
    )
}

const presignUpload = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const startedAt = Date.now()
    const requestId = requestIdFor(req)
    res.set('X-Request-Id', requestId)

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

        logMediaEvent('info', 'presign_completed', {
            requestId,
            websiteSlug,
            filename: parsed.filename,
            contentType: parsed.content_type,
            size: parsed.size,
            r2Key: result.r2_key,
            durationMs: Date.now() - startedAt,
            actor: req.mediaAdmin?.email,
        })

        return res.status(200).json({
            ...result,
            request_id: requestId,
        })
    } catch (err) {
        logMediaEvent('error', 'presign_failed', {
            requestId,
            websiteSlug: req.params.websiteSlug,
            filename:
                typeof (req.body as { filename?: unknown })?.filename === 'string'
                    ? (req.body as { filename: string }).filename
                    : undefined,
            size:
                typeof (req.body as { size?: unknown })?.size === 'number'
                    ? (req.body as { size: number }).size
                    : undefined,
            durationMs: Date.now() - startedAt,
            actor: req.mediaAdmin?.email,
            error: err instanceof Error ? err.message : err,
        })

        if (err instanceof ZodError) {
            return sendMediaError(
                res,
                400,
                'media.invalid_payload',
                'Invalid upload presign payload.',
                err.flatten(),
                { requestId, retryable: false }
            )
        }

        const knownErrorResponse = sendKnownMediaError(res, err, requestId, {
            notFound: 'media.website_not_found',
        })
        if (knownErrorResponse) return knownErrorResponse

        return handleGenericError(err, res)
    }
}

const listObjects = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req)
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

        const knownErrorResponse = sendKnownMediaError(res, err, requestId, {
            notFound: 'media.website_not_found',
        })
        if (knownErrorResponse) return knownErrorResponse

        return handleGenericError(err, res)
    }
}

const checkDestination = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req)
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
                err.flatten(),
                { requestId, retryable: false }
            )
        }

        const knownErrorResponse = sendKnownMediaError(res, err, requestId, {
            notFound: 'media.website_not_found',
        })
        if (knownErrorResponse) return knownErrorResponse

        return handleGenericError(err, res)
    }
}

const moveCatalogItem = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req)
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
                err.flatten(),
                { requestId, retryable: false }
            )
        }

        const knownErrorResponse = sendKnownMediaError(res, err, requestId, {
            notFound: 'media.not_found',
        })
        if (knownErrorResponse) return knownErrorResponse

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
            actor: req.mediaAdmin?.email,
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
    const startedAt = Date.now()
    const requestId = requestIdFor(req)
    res.set('X-Request-Id', requestId)

    try {
        const parsed = createCatalogItemSchema.parse(req.body)
        const item = await mediaCatalogService.createItem({
            websiteSlug: req.params.websiteSlug,
            key: parsed.key,
            filename: parsed.filename,
            src: parsed.src,
            alt: parsed.alt,
            library: parsed.library,
            siteCategory: parsed.siteCategory,
            service: parsed.service,
            subCategory: parsed.subCategory,
            aspectRatio: parsed.aspectRatio,
            sortOrder: parsed.sortOrder,
            actor: req.mediaAdmin?.email,
        })

        logMediaEvent('info', 'catalog_item_created', {
            requestId,
            websiteSlug: req.params.websiteSlug,
            mediaId: item.id,
            key: item.key,
            durationMs: Date.now() - startedAt,
            actor: req.mediaAdmin?.email,
        })

        return res.status(201).json(item)
    } catch (err) {
        logMediaEvent('error', 'catalog_item_create_failed', {
            requestId,
            websiteSlug: req.params.websiteSlug,
            key:
                typeof (req.body as { key?: unknown })?.key === 'string'
                    ? (req.body as { key: string }).key
                    : undefined,
            durationMs: Date.now() - startedAt,
            actor: req.mediaAdmin?.email,
            error: err instanceof Error ? err.message : err,
        })

        if (err instanceof ZodError) {
            return sendMediaError(
                res,
                400,
                'media.invalid_payload',
                'Invalid media catalog item payload.',
                err.flatten(),
                { requestId, retryable: false }
            )
        }

        const knownErrorResponse = sendKnownMediaError(res, err, requestId, {
            notFound: 'media.website_not_found',
        })
        if (knownErrorResponse) return knownErrorResponse

        return handleGenericError(err, res)
    }
}

const batchCreateCatalogItems = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const startedAt = Date.now()
    const requestId = requestIdFor(req)
    res.set('X-Request-Id', requestId)
    const requestedCount = Array.isArray((req.body as { items?: unknown })?.items)
        ? ((req.body as { items: unknown[] }).items.length)
        : 0

    try {
        const parsed = batchCreateCatalogItemsSchema.parse(req.body)
        const items = []

        for (const [index, rawItem] of parsed.items.entries()) {
            try {
                const itemInput = createCatalogItemSchema.parse(rawItem)
                const item = await mediaCatalogService.createItem({
                    websiteSlug: req.params.websiteSlug,
                    key: itemInput.key,
                    filename: itemInput.filename,
                    src: itemInput.src,
                    alt: itemInput.alt,
                    library: itemInput.library,
                    siteCategory: itemInput.siteCategory,
                    service: itemInput.service,
                    subCategory: itemInput.subCategory,
                    aspectRatio: itemInput.aspectRatio,
                    sortOrder: itemInput.sortOrder,
                    actor: req.mediaAdmin?.email,
                })

                items.push({
                    index,
                    key: item.key,
                    ok: true,
                    item,
                })
            } catch (err) {
                const error = batchErrorFrom(err, {
                    notFound: 'media.website_not_found',
                })
                const rawKey =
                    typeof (rawItem as { key?: unknown })?.key === 'string'
                        ? (rawItem as { key: string }).key
                        : undefined

                items.push({
                    index,
                    ...(rawKey && { key: rawKey }),
                    ok: false,
                    error: {
                        code: error.code,
                        message: error.message,
                        status: error.status,
                        retryable: error.retryable ?? false,
                        ...(error.details && { details: error.details }),
                    },
                })
            }
        }

        const succeeded = items.filter(item => item.ok).length
        const failed = items.length - succeeded
        const status =
            failed === 0 ? 'completed' : succeeded > 0 ? 'partial_success' : 'failed'

        logMediaEvent(failed > 0 ? 'warn' : 'info', 'catalog_batch_completed', {
            requestId,
            websiteSlug: req.params.websiteSlug,
            requested: requestedCount,
            succeeded,
            failed,
            status,
            durationMs: Date.now() - startedAt,
            actor: req.mediaAdmin?.email,
        })

        return res.status(failed > 0 ? 207 : 201).json({
            request_id: requestId,
            status,
            items,
            summary: {
                requested: items.length,
                succeeded,
                failed,
            },
        })
    } catch (err) {
        logMediaEvent('error', 'catalog_batch_failed', {
            requestId,
            websiteSlug: req.params.websiteSlug,
            requested: requestedCount,
            durationMs: Date.now() - startedAt,
            actor: req.mediaAdmin?.email,
            error: err instanceof Error ? err.message : err,
        })

        if (err instanceof ZodError) {
            return sendMediaError(
                res,
                400,
                'media.invalid_payload',
                `Invalid media catalog batch payload. Upload batches support up to ${mediaUploadBatchMaxItems()} items.`,
                err.flatten(),
                { requestId, retryable: false }
            )
        }

        const knownErrorResponse = sendKnownMediaError(res, err, requestId, {
            notFound: 'media.website_not_found',
        })
        if (knownErrorResponse) return knownErrorResponse

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
            library: parsed.library,
            siteCategory: parsed.siteCategory,
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

const batchUpdateCatalogItems = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const startedAt = Date.now()
    const requestedCount = Array.isArray((req.body as { ids?: unknown })?.ids)
        ? ((req.body as { ids: unknown[] }).ids.length)
        : 0
    try {
        const parsed = batchUpdateCatalogItemsSchema.parse(req.body)
        const result = await mediaCatalogService.batchUpdateItems({
            websiteSlug: req.params.websiteSlug,
            ids: parsed.ids,
            status: parsed.status,
            actor: req.mediaAdmin?.email,
        })

        console.info('Media batch catalog update completed', {
            websiteSlug: req.params.websiteSlug,
            status: parsed.status,
            requested: requestedCount,
            processed: result.summary.requested,
            succeeded: result.summary.succeeded,
            failed: result.summary.failed,
            durationMs: Date.now() - startedAt,
            actor: req.mediaAdmin?.email,
        })

        return res.status(200).json(result)
    } catch (err) {
        console.error('Media batch catalog update failed', {
            websiteSlug: req.params.websiteSlug,
            requested: requestedCount,
            durationMs: Date.now() - startedAt,
            actor: req.mediaAdmin?.email,
            error: err instanceof Error ? err.message : err,
        })

        if (err instanceof ZodError) {
            return sendMediaError(
                res,
                400,
                'media.invalid_payload',
                'Invalid media catalog batch payload.',
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
    batchCreateCatalogItems,
    updateCatalogItem,
    batchUpdateCatalogItems,
    assignPlacement,
    clearPlacement,
}
