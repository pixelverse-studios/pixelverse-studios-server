import { db } from '../lib/db'
import { DashboardActor } from '../lib/admin-releases'

export const verifyDashboardAccessToken = async (
    accessToken: string
): Promise<{ userId: string; email: string } | null> => {
    const { data, error } = await db.auth.getUser(accessToken)
    if (error || !data.user?.id || !data.user.email) return null
    return {
        userId: data.user.id,
        email: data.user.email.trim().toLowerCase()
    }
}

export const dashboardActorFromIdentity = (identity: {
    userId: string
    email: string
}): DashboardActor => ({ ...identity, role: 'admin' })
