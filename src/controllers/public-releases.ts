import crypto from 'crypto'
import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import {
    PUBLIC_RELEASE_CACHE_CONTROL,
    FieldErrors,
    PublicReleaseApiError,
    RELEASE_API_VERSION,
    ReleaseCollection,
    ReleasePlatform,
} from '../lib/public-releases'
import { listPublicReleases } from '../services/public-releases'

const requestIdFor = (req: Request, res: Response): string => {
    const requestId =
        req.requestId || res.getHeader('x-request-id')?.toString() || crypto.randomUUID()
    res.setHeader('x-request-id', requestId)
    return requestId
}

const errorResponse = (
    res: Response,
    requestId: string,
    status: number,
    code: string,
    message: string,
    fieldErrors: FieldErrors = {}
): Response => {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(status).json({
        error: { code, message, fieldErrors, requestId },
    })
}

export const getPublicReleases = (collection: ReleaseCollection) =>
    async (req: Request, res: Response): Promise<Response> => {
        const requestId = requestIdFor(req, res)
        const validation = validationResult(req)
        if (!validation.isEmpty()) {
            const fieldErrors: FieldErrors = {}
            validation.array().forEach(error => {
                if (error.type === 'field') {
                    const messages = fieldErrors[error.path] || []
                    if (!messages.includes(error.msg)) messages.push(error.msg)
                    fieldErrors[error.path] = messages
                }
            })
            return errorResponse(
                res,
                requestId,
                400,
                'VALIDATION_ERROR',
                'Invalid query parameters',
                fieldErrors
            )
        }

        try {
            const platform = (req.query.platform as ReleasePlatform | undefined) || null
            const limit = req.query.limit ? Number(req.query.limit) : 20
            const result = await listPublicReleases({
                collection,
                platform,
                limit,
                cursor: req.query.cursor as string | undefined,
            })
            res.setHeader('Cache-Control', PUBLIC_RELEASE_CACHE_CONTROL)
            res.setHeader('Vary', 'Accept-Encoding')
            return res.status(200).json({
                data: { releases: result.releases },
                meta: {
                    apiVersion: RELEASE_API_VERSION,
                    requestId,
                    nextCursor: result.nextCursor,
                },
            })
        } catch (error) {
            if (error instanceof PublicReleaseApiError) {
                return errorResponse(
                    res,
                    requestId,
                    error.status,
                    error.code,
                    error.message,
                    error.fieldErrors
                )
            }
            console.error('Public release API request failed:', {
                requestId,
                collection,
                message: error instanceof Error ? error.message : String(error),
            })
            return errorResponse(
                res,
                requestId,
                500,
                'INTERNAL_ERROR',
                'Unable to load releases'
            )
        }
    }
