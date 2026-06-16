import crypto from 'crypto'

import { sendEmail } from './mailer'

export const MEDIA_ADMIN_SESSION_COOKIE = 'pvs_media_admin_session'
export const MAGIC_LINK_TOKEN_BYTES = 32
export const SESSION_TOKEN_BYTES = 32
export const DEFAULT_MAGIC_LINK_TTL_MINUTES = 15
export const DEFAULT_SESSION_TTL_HOURS = 12
export const DEFAULT_REQUEST_MIN_RESPONSE_MS = 350
export const DEFAULT_MAGIC_LINK_REQUEST_COOLDOWN_SECONDS = 60
export const DEFAULT_MAGIC_LINK_RATE_LIMIT_SECONDS = 0
export const DEFAULT_MAGIC_LINK_CLOCK_SKEW_SECONDS = 120

export const normalizeAdminEmail = (email: string): string =>
    email.trim().toLowerCase()

export const getApprovedAdminEmails = (): string[] =>
    (process.env.MEDIA_ADMIN_EMAILS || '')
        .split(',')
        .map(normalizeAdminEmail)
        .filter(Boolean)

export const isApprovedAdminEmail = (email: string): boolean =>
    getApprovedAdminEmails().includes(normalizeAdminEmail(email))

export const hashToken = (token: string): string =>
    crypto.createHash('sha256').update(token).digest('hex')

export const generateToken = (bytes: number): string =>
    crypto.randomBytes(bytes).toString('base64url')

export const magicLinkTtlMinutes = (): number =>
    Number(process.env.MEDIA_ADMIN_MAGIC_LINK_TTL_MINUTES) ||
    DEFAULT_MAGIC_LINK_TTL_MINUTES

export const sessionTtlHours = (): number =>
    Number(process.env.MEDIA_ADMIN_SESSION_TTL_HOURS) ||
    DEFAULT_SESSION_TTL_HOURS

export const requestMinResponseMs = (): number =>
    Number.isFinite(Number(process.env.MEDIA_ADMIN_REQUEST_MIN_RESPONSE_MS)) &&
    Number(process.env.MEDIA_ADMIN_REQUEST_MIN_RESPONSE_MS) >= 0
        ? Number(process.env.MEDIA_ADMIN_REQUEST_MIN_RESPONSE_MS)
        : DEFAULT_REQUEST_MIN_RESPONSE_MS

export const magicLinkRequestCooldownSeconds = (): number =>
    Number.isFinite(
        Number(process.env.MEDIA_ADMIN_MAGIC_LINK_REQUEST_COOLDOWN_SECONDS)
    ) && Number(process.env.MEDIA_ADMIN_MAGIC_LINK_REQUEST_COOLDOWN_SECONDS) >= 0
        ? Number(process.env.MEDIA_ADMIN_MAGIC_LINK_REQUEST_COOLDOWN_SECONDS)
        : DEFAULT_MAGIC_LINK_REQUEST_COOLDOWN_SECONDS

export const magicLinkRateLimitSeconds = (): number =>
    Number.isFinite(Number(process.env.MEDIA_ADMIN_MAGIC_LINK_RATE_LIMIT_SECONDS)) &&
    Number(process.env.MEDIA_ADMIN_MAGIC_LINK_RATE_LIMIT_SECONDS) >= 0
        ? Number(process.env.MEDIA_ADMIN_MAGIC_LINK_RATE_LIMIT_SECONDS)
        : DEFAULT_MAGIC_LINK_RATE_LIMIT_SECONDS

export const magicLinkClockSkewSeconds = (): number =>
    Number.isFinite(Number(process.env.MEDIA_ADMIN_MAGIC_LINK_CLOCK_SKEW_SECONDS)) &&
    Number(process.env.MEDIA_ADMIN_MAGIC_LINK_CLOCK_SKEW_SECONDS) >= 0
        ? Number(process.env.MEDIA_ADMIN_MAGIC_LINK_CLOCK_SKEW_SECONDS)
        : DEFAULT_MAGIC_LINK_CLOCK_SKEW_SECONDS

export const isProductionEnvironment = (): boolean =>
    process.env.NODE_ENV === 'production' ||
    process.env.NODE_ENVIRONMENT === 'production'

export const expiresInMinutes = (minutes: number): Date =>
    new Date(Date.now() + minutes * 60 * 1000)

export const expiresInHours = (hours: number): Date =>
    new Date(Date.now() + hours * 60 * 60 * 1000)

export const buildMagicLinkUrl = (token: string): string => {
    const baseUrl = process.env.MEDIA_ADMIN_APP_BASE_URL?.trim()
    if (!baseUrl) {
        throw new Error('MEDIA_ADMIN_APP_BASE_URL is not configured')
    }

    const url = new URL('/admin/media/auth/callback', baseUrl)
    url.searchParams.set('token', token)
    return url.toString()
}

export const sendMediaAdminMagicLink = async (
    email: string,
    magicLinkUrl: string
): Promise<void> => {
    await sendEmail({
        to: email,
        subject: "Your Iffer's Pictures media manager sign-in link",
        text: `Use this secure link to sign in to the Iffer's Pictures media manager. It expires in ${magicLinkTtlMinutes()} minutes.\n\n${magicLinkUrl}`,
        html: `
            <p>Use this secure link to sign in to the Iffer's Pictures media manager.</p>
            <p><a href="${magicLinkUrl}">Sign in to media manager</a></p>
            <p>This link expires in ${magicLinkTtlMinutes()} minutes.</p>
        `,
    })
}
