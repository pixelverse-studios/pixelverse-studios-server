import { db, Tables } from '../lib/db'
import { DashboardActor, DashboardRole } from '../lib/admin-releases'

interface DashboardRoleRow {
    user_id: string
    role: DashboardRole
    is_active: boolean
}

export const verifyDashboardAccessToken = async (
    accessToken: string
): Promise<{ userId: string; email: string } | null> => {
    const { data, error } = await db.auth.getUser(accessToken)
    if (error || !data.user?.id || !data.user.email) return null
    return {
        userId: data.user.id,
        email: data.user.email.trim().toLowerCase(),
    }
}

export const loadDashboardActor = async (
    identity: { userId: string; email: string }
): Promise<DashboardActor | null> => {
    const { data, error } = await db
        .from(Tables.DASHBOARD_USER_ROLES)
        .select('user_id,role,is_active')
        .eq('user_id', identity.userId)
        .eq('is_active', true)
        .maybeSingle()
    if (error) throw error
    if (!data) return null

    const role = data as DashboardRoleRow
    return { ...identity, role: role.role }
}
