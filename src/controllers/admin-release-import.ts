import { Request, Response } from 'express'

import {
    ADMIN_RELEASE_API_VERSION,
    AdminReleaseApiError,
    adminReleaseErrorResponse,
    normalizeImportMarkdownRequest,
    requestIdFor,
} from '../lib/admin-releases'
import { importReleaseMarkdown } from '../services/admin-release-import'

export const importMarkdown = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        if (!req.dashboardActor) {
            return adminReleaseErrorResponse(req, res, 401, 'AUTH_REQUIRED', 'Authentication is required')
        }
        const input = normalizeImportMarkdownRequest(req)
        const result = await importReleaseMarkdown(input, req.dashboardActor, requestId)
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('ETag', `"${result.release.rowVersion}"`)
        return res.status(result.duplicate ? 200 : 201).json({
            data: result,
            meta: {
                apiVersion: ADMIN_RELEASE_API_VERSION,
                requestId,
                nextCursor: null,
            },
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
        console.error('Admin Markdown import failed:', {
            requestId,
            actorUserId: req.dashboardActor?.userId,
            message: error instanceof Error ? error.message : String(error),
        })
        return adminReleaseErrorResponse(
            req,
            res,
            500,
            'INTERNAL_ERROR',
            'Unable to import Markdown'
        )
    }
}
