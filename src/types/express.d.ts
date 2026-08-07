declare namespace Express {
    export interface Request {
        requestId?: string
        dashboardActor?: import('../lib/admin-releases').DashboardActor
        mediaAdmin?: {
            email: string
            sessionId: string
            expiresAt: string
        }
        mediaAdminSessionToken?: string
    }
}
