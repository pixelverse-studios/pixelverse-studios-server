declare global {
    namespace NodeJS {
        interface ProcessENV {
            PORT?: string
            MONGODB: string
            TOKEN_SECRET: string
            TOKEN_EXPIRE: string
            // EMAIL_USER: string
            // EMAIL_PASSWORD: string
            // GOOGLE_OAUTH_ID: string
            // GOOGLE_OAUTH_SECRET: string
            // GOOGLE_REFRESH_TOKEN: string
        }
    }
}

export {}
