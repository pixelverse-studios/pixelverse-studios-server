declare namespace Express {
    export interface Request {
        mediaAdmin?: {
            email: string
            sessionId: string
            expiresAt: string
        }
        mediaAdminSessionToken?: string
    }
}
