import { Request, Response } from 'express'

import {
    ADMIN_RELEASE_API_VERSION,
    AdminReleaseApiError,
    adminReleaseErrorResponse,
    normalizeConvertMarkdownRequest,
    requestIdFor,
} from '../lib/admin-releases'
import { convertSavedReleaseMarkdown } from '../services/admin-release-conversion'

export const convertMarkdown = async (req: Request, res: Response): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        if (!req.dashboardActor) {
            return adminReleaseErrorResponse(req, res, 401, 'AUTH_REQUIRED', 'Authentication is required')
        }
        const input = normalizeConvertMarkdownRequest(req)
        const result = await convertSavedReleaseMarkdown(input, req.dashboardActor, requestId)
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('ETag', `"${result.source.rowVersion}"`)
        res.setHeader('X-Release-ETag', `"${result.releaseRowVersion}"`)
        return res.status(200).json({
            data: result,
            meta: { apiVersion: ADMIN_RELEASE_API_VERSION, requestId, nextCursor: null },
        })
    } catch (error) {
        if (error instanceof AdminReleaseApiError) {
            return adminReleaseErrorResponse(
                req,
                res,
                error.status,
                error.code,
                error.message,
                error.fieldErrors
            )
        }
        console.error('Admin Markdown conversion failed:', {
            requestId,
            actorUserId: req.dashboardActor?.userId,
            message: error instanceof Error ? error.message : String(error),
        })
        return adminReleaseErrorResponse(
            req,
            res,
            500,
            'INTERNAL_ERROR',
            'Unable to convert Markdown'
        )
    }
}
