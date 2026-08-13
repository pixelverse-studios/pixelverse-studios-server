import { NextFunction, Request, Response } from 'express'

import { adminReleaseErrorResponse } from '../lib/admin-releases'
import {
    dashboardActorFromIdentity,
    verifyDashboardAccessToken
} from '../services/admin-release-auth'

export const requireDashboardActor = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const authorization = req.get('authorization')
    const match = authorization?.match(/^Bearer ([^\s]+)$/)
    if (!match) {
        adminReleaseErrorResponse(
            req,
            res,
            401,
            'AUTH_REQUIRED',
            'Authentication is required'
        )
        return
    }

    try {
        const identity = await verifyDashboardAccessToken(match[1])
        if (!identity) {
            adminReleaseErrorResponse(
                req,
                res,
                401,
                'AUTH_INVALID',
                'Access token is invalid or expired'
            )
            return
        }
        req.dashboardActor = dashboardActorFromIdentity(identity)
        next()
    } catch (error) {
        console.error('Dashboard release authentication failed:', {
            requestId: req.requestId,
            message: error instanceof Error ? error.message : String(error)
        })
        adminReleaseErrorResponse(
            req,
            res,
            500,
            'INTERNAL_ERROR',
            'Unable to verify dashboard access'
        )
    }
}
