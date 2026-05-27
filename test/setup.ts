import { afterAll, afterEach, beforeEach, vi } from 'vitest'

const originalEnv = { ...process.env }
const externalServiceEnvKeys = [
    'OPS_NOTIFY_SLACK_WEBHOOK',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GMAIL_USER',
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
    'GMAIL_APP_PASSWORD',
    'RESEND_API_KEY',
    'CALENDLY_API_TOKEN',
    'MEDIA_ADMIN_EMAILS',
    'MEDIA_ADMIN_APP_BASE_URL',
    'MEDIA_ADMIN_MAGIC_LINK_TTL_MINUTES',
    'MEDIA_ADMIN_SESSION_TTL_HOURS',
    'MEDIA_ADMIN_REQUEST_MIN_RESPONSE_MS',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_ACCOUNT_ID',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_BASE_URL',
    'R2_PRESIGN_EXPIRES_SECONDS',
    'MEDIA_MAX_UPLOAD_BYTES',
]

const buildTestEnv = (): NodeJS.ProcessEnv => {
    const testEnv = {
        ...originalEnv,
        NODE_ENV: 'test',
    }

    externalServiceEnvKeys.forEach(key => {
        delete testEnv[key]
    })

    return testEnv
}

const stubFetch = (): void => {
    vi.stubGlobal(
        'fetch',
        vi.fn(() =>
            Promise.reject(new Error('Unexpected network call in test'))
        )
    )
}

process.env = buildTestEnv()
stubFetch()

beforeEach(() => {
    process.env = buildTestEnv()
    stubFetch()
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    process.env = buildTestEnv()
})

afterAll(() => {
    process.env = { ...originalEnv }
})
