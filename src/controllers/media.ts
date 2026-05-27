import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import mediaR2Service from '../services/media-r2'
import { MediaValidationError } from '../lib/media-r2'
import { handleGenericError } from '../utils/http'

const presignUploadSchema = z.object({
    filename: z.string().trim().min(1).max(255),
    content_type: z.string().trim().min(1).max(100),
    folder: z.string().trim().max(500).optional(),
    size: z.number().int().positive(),
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

export default { presignUpload }
