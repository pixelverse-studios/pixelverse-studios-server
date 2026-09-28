import {
    PvsAuthRequestError,
    verifyPvsAccessToken
} from '../lib/pvs-auth'
import type { DashboardActor } from '../lib/admin-releases'

export class DomaniStaffAuthError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string
    ) {
        super(message)
        this.name = 'DomaniStaffAuthError'
    }
}

/** Authorize a verified active PVS session against the configured staff allowlist. */
export const verifyDomaniStaffAccessToken = async (
    accessToken: string
): Promise<DashboardActor> => {
    const staffEmails = new Set(
        (process.env.DOMANI_DASHBOARD_STAFF_EMAILS || '')
            .split(',')
            .map(email => email.trim().toLowerCase())
            .filter(Boolean)
    )
    if (!staffEmails.size) {
        throw new DomaniStaffAuthError(
            503,
            'STAFF_ACCESS_UNCONFIGURED',
            'Dashboard staff access is not configured'
        )
    }

    let user
    try {
        user = await verifyPvsAccessToken(accessToken)
    } catch (error) {
        if (
            !(error instanceof PvsAuthRequestError) ||
            (error.status !== 401 && error.status !== 403)
        ) {
            throw new DomaniStaffAuthError(
                503,
                'AUTH_UNAVAILABLE',
                'Unable to verify dashboard access'
            )
        }
        throw new DomaniStaffAuthError(
            401,
            'AUTH_INVALID',
            'Access token is invalid or expired'
        )
    }
    if (!user) {
        throw new DomaniStaffAuthError(401, 'AUTH_INVALID', 'Access token is invalid or expired')
    }
    const email = user.email.trim().toLowerCase()
    if (!staffEmails.has(email)) {
        throw new DomaniStaffAuthError(403, 'STAFF_ACCESS_REQUIRED', 'Dashboard staff access is required')
    }
    return { userId: user.id, email, role: 'admin' }
}
