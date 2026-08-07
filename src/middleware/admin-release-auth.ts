import { NextFunction, Request, Response } from 'express'

import {
    adminReleaseErrorResponse,
    DashboardRole,
} from '../lib/admin-releases'
import {
    loadDashboardActor,
    verifyDashboardAccessToken,
} from '../services/admin-release-auth'

const roleRank: Record<DashboardRole, number> = {
    viewer: 0,
    editor: 1,
    admin: 2,
}

export const requireDashboardActor = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const authorization = req.get('authorization')
    const match = authorization?.match(/^Bearer ([^\s]+)$/)
    if (!match) {
        adminReleaseErrorResponse(req, res, 401, 'AUTH_REQUIRED', 'Authentication is required')
        return
    }

    try {
        const identity = await verifyDashboardAccessToken(match[1])
        if (!identity) {
            adminReleaseErrorResponse(req, res, 401, 'AUTH_INVALID', 'Access token is invalid or expired')
            return
        }
        const actor = await loadDashboardActor(identity)
        if (!actor) {
            adminReleaseErrorResponse(req, res, 403, 'ROLE_REQUIRED', 'An active dashboard role is required')
            return
        }
        req.dashboardActor = actor
        next()
    } catch (error) {
        console.error('Dashboard release authentication failed:', {
            requestId: req.requestId,
            message: error instanceof Error ? error.message : String(error),
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

export const requireDashboardRole = (minimumRole: DashboardRole) =>
    (req: Request, res: Response, next: NextFunction): void => {
        if (!req.dashboardActor) {
            adminReleaseErrorResponse(req, res, 401, 'AUTH_REQUIRED', 'Authentication is required')
            return
        }
        if (roleRank[req.dashboardActor.role] < roleRank[minimumRole]) {
            adminReleaseErrorResponse(req, res, 403, 'FORBIDDEN', 'Insufficient dashboard permissions')
            return
        }
        next()
    }
