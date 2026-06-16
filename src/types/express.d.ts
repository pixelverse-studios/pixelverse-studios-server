declare namespace Express {
    export interface Request {
        requestId?: string
        mediaAdmin?: {
            email: string
            sessionId: string
            expiresAt: string
        }
        mediaAdminSessionToken?: string
    }
}
