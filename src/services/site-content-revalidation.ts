export const MINI_SESSION_REVALIDATION_PATHS = [
    '/',
    '/mini-sessions',
    '/sitemap.xml',
] as const

export type MiniSessionRevalidationReason =
    | 'campaign_updated'
    | 'campaign_published'
    | 'campaign_marked_sold_out'
    | 'campaign_closed'
    | 'campaign_archived'

export interface TriggerMiniSessionRevalidationInput {
    websiteSlug: string
    campaignId: string
    reason: MiniSessionRevalidationReason
    actor?: string
}

export interface SiteContentRevalidationResult {
    configured: boolean
    triggered: boolean
    skipped: boolean
    content_type: 'mini_session_campaign'
    reason: MiniSessionRevalidationReason
    website_slug: string
    campaign_id: string
    affected_paths: string[]
    revalidate_layout: boolean
    triggered_at: string
    status?: number
}

export class SiteContentRevalidationError extends Error {
    readonly code = 'site_content.revalidation_failed'

    constructor(
        message: string,
        public readonly details?: Record<string, unknown>
    ) {
        super(message)
        this.name = 'SiteContentRevalidationError'
    }
}

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_PUBLIC_MAX_AGE_SECONDS = 60

const webhookUrl = (): string | null =>
    process.env.SITE_REVALIDATION_WEBHOOK_URL?.trim() ||
    process.env.MEDIA_REVALIDATION_WEBHOOK_URL?.trim() ||
    null

const webhookSecret = (): string | null =>
    process.env.SITE_REVALIDATION_SECRET?.trim() ||
    process.env.MEDIA_REVALIDATION_SECRET?.trim() ||
    null

const safePositiveInteger = (
    primaryKey: string,
    fallbackKey: string | null,
    fallback: number
): number => {
    const raw =
        process.env[primaryKey]?.trim() ||
        (fallbackKey ? process.env[fallbackKey]?.trim() : '')
    const parsed = Number(raw)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const webhookTimeoutMs = (): number =>
    safePositiveInteger(
        'SITE_REVALIDATION_TIMEOUT_MS',
        'MEDIA_REVALIDATION_TIMEOUT_MS',
        DEFAULT_TIMEOUT_MS
    )

export const publicCampaignCacheControl = (): string => {
    const maxAge = safePositiveInteger(
        'MINI_SESSION_PUBLIC_MAX_AGE_SECONDS',
        null,
        DEFAULT_PUBLIC_MAX_AGE_SECONDS
    )
    return `public, max-age=${Math.min(maxAge, 60)}, must-revalidate`
}

export const buildMiniSessionRevalidationPayload = ({
    websiteSlug,
    campaignId,
    reason,
    actor,
}: TriggerMiniSessionRevalidationInput): Record<string, unknown> => ({
    content_type: 'mini_session_campaign',
    reason,
    website_slug: websiteSlug,
    campaign_id: campaignId,
    affected_paths: [...MINI_SESSION_REVALIDATION_PATHS],
    revalidate_layout: true,
    ...(actor && { actor }),
    triggered_at: new Date().toISOString(),
})

export const triggerMiniSessionRevalidation = async (
    input: TriggerMiniSessionRevalidationInput
): Promise<SiteContentRevalidationResult> => {
    const url = webhookUrl()
    const payload = buildMiniSessionRevalidationPayload(input)
    const baseResult = {
        configured: Boolean(url),
        triggered: false,
        skipped: !url,
        content_type: 'mini_session_campaign' as const,
        reason: input.reason,
        website_slug: input.websiteSlug,
        campaign_id: input.campaignId,
        affected_paths: payload.affected_paths as string[],
        revalidate_layout: true,
        triggered_at: payload.triggered_at as string,
    }

    if (!url) return baseResult

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), webhookTimeoutMs())
    const secret = webhookSecret()

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
            const responseBody = await response.text()
            throw new SiteContentRevalidationError(
                'Site content revalidation webhook failed',
                {
                    status: response.status,
                    response: responseBody.slice(0, 500),
                }
            )
        }

        return {
            ...baseResult,
            triggered: true,
            skipped: false,
            status: response.status,
        }
    } catch (error) {
        if (error instanceof SiteContentRevalidationError) throw error
        throw new SiteContentRevalidationError(
            'Site content revalidation webhook failed',
            {
                error:
                    error instanceof Error ? error.message : 'Unknown fetch error',
            }
        )
    } finally {
        clearTimeout(timeout)
    }
}

export default {
    MINI_SESSION_REVALIDATION_PATHS,
    publicCampaignCacheControl,
    triggerMiniSessionRevalidation,
}
