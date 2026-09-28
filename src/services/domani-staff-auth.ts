import { pvsAuth } from '../lib/pvs-auth'
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

export const DEFAULT_DOMANI_STAFF_EMAILS = [
    'phil@pixelversestudios.io',
    'sami@pixelversestudios.io',
] as const

/** Authorize verified identities against built-in staff plus configured additions. */
export const verifyDomaniStaffAccessToken = async (
    accessToken: string
): Promise<DashboardActor> => {
    const staffEmails = new Set([
        ...DEFAULT_DOMANI_STAFF_EMAILS,
        ...(process.env.DOMANI_DASHBOARD_STAFF_EMAILS || '')
            .split(',')
            .map(email => email.trim().toLowerCase())
            .filter(Boolean),
    ])

    const { data, error } = await pvsAuth.getUser(accessToken)
    if (error) {
        const status = (error as { status?: number }).status
        if (status !== 401 && status !== 403) {
            throw new DomaniStaffAuthError(
                503,
                'AUTH_UNAVAILABLE',
                'Unable to verify dashboard access'
            )
        }
        throw new DomaniStaffAuthError(401, 'AUTH_INVALID', 'Access token is invalid or expired')
    }
    if (!data.user?.id || !data.user.email) {
        throw new DomaniStaffAuthError(401, 'AUTH_INVALID', 'Access token is invalid or expired')
    }
    const email = data.user.email.trim().toLowerCase()
    if (!staffEmails.has(email)) {
        throw new DomaniStaffAuthError(403, 'STAFF_ACCESS_REQUIRED', 'Dashboard staff access is required')
    }
    return { userId: data.user.id, email, role: 'admin' }
}
