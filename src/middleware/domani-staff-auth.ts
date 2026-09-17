import { NextFunction, Request, Response } from 'express'
import { DomaniStaffAuthError, verifyDomaniStaffAccessToken } from '../services/domani-staff-auth'

const respond = (res: Response, status: number, code: string, message: string): void => {
    res.status(status).json({ error: { code, message }, message })
}

export const requireDomaniStaff = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store')
    const origin = req.get('origin')
    if (origin !== undefined) {
        const allowedOrigins = (process.env.PVS_DASHBOARD_ORIGINS || '')
            .split(',').map(value => value.trim()).filter(Boolean)
        if (!allowedOrigins.includes(origin)) {
            respond(res, 403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed')
            return
        }
    }
    const match = req.get('authorization')?.match(/^Bearer ([^\s]+)$/i)
    if (!match) {
        respond(res, 401, 'AUTH_REQUIRED', 'Authentication is required')
        return
    }
    try {
        req.dashboardActor = await verifyDomaniStaffAccessToken(match[1])
        next()
    } catch (error) {
        if (error instanceof DomaniStaffAuthError) {
            respond(res, error.status, error.code, error.message)
            return
        }
        respond(res, 503, 'AUTH_UNAVAILABLE', 'Unable to verify dashboard access')
    }
}
