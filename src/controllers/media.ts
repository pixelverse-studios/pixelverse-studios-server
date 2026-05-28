import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import mediaCatalogService from '../services/media-catalog'
import mediaR2Service from '../services/media-r2'
import { MediaValidationError } from '../lib/media-r2'
import { handleGenericError } from '../utils/http'

const presignUploadSchema = z.object({
    filename: z.string().trim().min(1).max(255),
    content_type: z.string().trim().min(1).max(100),
    folder: z.string().trim().max(500).optional(),
    size: z.number().int().positive(),
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

const getPublicCatalog = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const catalog = await mediaCatalogService.listCatalog({
            websiteSlug: req.params.websiteSlug,
            includeAdminFields: false,
        })

        res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
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
    getPublicCatalog,
    getAdminCatalog,
    createCatalogItem,
    updateCatalogItem,
}
