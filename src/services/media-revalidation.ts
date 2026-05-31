import { MediaValidationError } from '../lib/media-r2'

export const MEDIA_REVALIDATION_PATHS = [
    '/',
    '/portfolio',
    '/services',
    '/services/events',
    '/services/family',
    '/services/maternity',
    '/services/couples-engagement',
    '/services/portrait',
    '/investment',
    '/faq',
] as const

export type MediaRevalidationReason =
    | 'manual'
    | 'published'
    | 'archived'
    | 'restored'
    | 'metadata_edited'
    | 'reorder_changed'
    | 'renamed_moved'

export interface TriggerMediaRevalidationInput {
    websiteSlug: string
    reason: MediaRevalidationReason
    mediaId?: number
    mediaKey?: string
    actor?: string
}

export interface MediaRevalidationResult {
    configured: boolean
    triggered: boolean
    skipped: boolean
    reason: MediaRevalidationReason
    website_slug: string
    affected_paths: string[]
    triggered_at: string
    status?: number
}

const DEFAULT_TIMEOUT_MS = 5000

const webhookUrl = (): string | null => {
    const url = process.env.MEDIA_REVALIDATION_WEBHOOK_URL?.trim()
    return url || null
}

const webhookTimeoutMs = (): number => {
    const configured = Number(process.env.MEDIA_REVALIDATION_TIMEOUT_MS)
    if (!Number.isFinite(configured) || configured <= 0) {
        return DEFAULT_TIMEOUT_MS
    }

    return configured
}

const optionalNonNegativeEnvNumber = (
    key: string,
    fallback: number
): number => {
    const rawValue = process.env[key]?.trim()
    if (!rawValue) return fallback

    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed) || parsed < 0) return fallback

    return Math.floor(parsed)
}

export const publicCatalogCacheControl = (): string => {
    const safeMaxAge = optionalNonNegativeEnvNumber(
        'MEDIA_PUBLIC_CATALOG_MAX_AGE_SECONDS',
        60
    )
    const safeStale = optionalNonNegativeEnvNumber(
        'MEDIA_PUBLIC_CATALOG_STALE_WHILE_REVALIDATE_SECONDS',
        300
    )

    return `public, max-age=${safeMaxAge}, stale-while-revalidate=${safeStale}`
}

export const buildMediaRevalidationPayload = ({
    websiteSlug,
    reason,
    mediaId,
    mediaKey,
    actor,
}: TriggerMediaRevalidationInput): Record<string, unknown> => ({
    website_slug: websiteSlug,
    reason,
    affected_paths: [...MEDIA_REVALIDATION_PATHS],
    ...(mediaId !== undefined && { media_id: mediaId }),
    ...(mediaKey && { media_key: mediaKey }),
    ...(actor && { actor }),
    triggered_at: new Date().toISOString(),
})

export const triggerMediaRevalidation = async (
    input: TriggerMediaRevalidationInput
): Promise<MediaRevalidationResult> => {
    const url = webhookUrl()
    const payload = buildMediaRevalidationPayload(input)
    const triggeredAt = payload.triggered_at as string

    if (!url) {
        return {
            configured: false,
            triggered: false,
            skipped: true,
            reason: input.reason,
            website_slug: input.websiteSlug,
            affected_paths: [...MEDIA_REVALIDATION_PATHS],
            triggered_at: triggeredAt,
        }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), webhookTimeoutMs())
    const secret = process.env.MEDIA_REVALIDATION_SECRET?.trim()

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(secret && { Authorization: `Bearer ${secret}` }),
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        })

        if (!response.ok) {
            const body = await response.text()
            throw new MediaValidationError(
                502,
                'media.revalidation_failed',
                'Media cache revalidation webhook failed.',
                {
                    status: response.status,
                    response: body.slice(0, 500),
                }
            )
        }

        return {
            configured: true,
            triggered: true,
            skipped: false,
            reason: input.reason,
            website_slug: input.websiteSlug,
            affected_paths: [...MEDIA_REVALIDATION_PATHS],
            triggered_at: triggeredAt,
            status: response.status,
        }
    } catch (err) {
        if (err instanceof MediaValidationError) throw err

        throw new MediaValidationError(
            502,
            'media.revalidation_failed',
            'Media cache revalidation webhook failed.',
            {
                error: err instanceof Error ? err.message : 'Unknown fetch error',
            }
        )
    } finally {
        clearTimeout(timeout)
    }
}

export const tryTriggerMediaRevalidation = (
    input: TriggerMediaRevalidationInput
): void => {
    void triggerMediaRevalidation(input).catch(err => {
        console.error(
            `Failed to trigger media cache revalidation for ${input.websiteSlug}: ${input.reason}`,
            err
        )
    })
}

export default {
    MEDIA_REVALIDATION_PATHS,
    publicCatalogCacheControl,
    triggerMediaRevalidation,
    tryTriggerMediaRevalidation,
}
