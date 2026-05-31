import { describe, expect, it, vi } from 'vitest'

import mediaRevalidationService, {
    MEDIA_REVALIDATION_PATHS,
} from '../src/services/media-revalidation'

const webhookUrl = 'https://revalidate.example.test/api/revalidate'

const mockWebhookResponse = (response: Response): void => {
    vi.mocked(fetch).mockResolvedValue(response)
}

describe('media revalidation service', () => {
    it('skips webhook delivery when no revalidation webhook is configured', async () => {
        const result = await mediaRevalidationService.triggerMediaRevalidation({
            websiteSlug: 'iffers-pictures',
            reason: 'manual',
        })

        expect(result).toEqual(
            expect.objectContaining({
                configured: false,
                triggered: false,
                skipped: true,
                reason: 'manual',
                website_slug: 'iffers-pictures',
                affected_paths: [...MEDIA_REVALIDATION_PATHS],
            })
        )
        expect(fetch).not.toHaveBeenCalled()
    })

    it('posts the documented revalidation payload to the configured webhook', async () => {
        process.env.MEDIA_REVALIDATION_WEBHOOK_URL = webhookUrl
        process.env.MEDIA_REVALIDATION_SECRET = 'secret-value'
        mockWebhookResponse(new Response('ok', { status: 202 }))

        const result = await mediaRevalidationService.triggerMediaRevalidation({
            websiteSlug: 'iffers-pictures',
            reason: 'published',
            mediaId: 123,
            mediaKey: 'events/baby-shower/baby.jpg',
            actor: 'jenn@example.com',
        })

        const [url, init] = vi.mocked(fetch).mock.calls[0]
        const body = JSON.parse(String((init as RequestInit).body))

        expect(url).toBe(webhookUrl)
        expect(init).toEqual(
            expect.objectContaining({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer secret-value',
                },
            })
        )
        expect(body).toEqual(
            expect.objectContaining({
                website_slug: 'iffers-pictures',
                reason: 'published',
                media_id: 123,
                media_key: 'events/baby-shower/baby.jpg',
                actor: 'jenn@example.com',
                affected_paths: [...MEDIA_REVALIDATION_PATHS],
            })
        )
        expect(result).toEqual(
            expect.objectContaining({
                configured: true,
                triggered: true,
                skipped: false,
                status: 202,
            })
        )
    })

    it('throws a media error when the webhook responds with a failure', async () => {
        process.env.MEDIA_REVALIDATION_WEBHOOK_URL = webhookUrl
        mockWebhookResponse(new Response('invalid token', { status: 401 }))

        await expect(
            mediaRevalidationService.triggerMediaRevalidation({
                websiteSlug: 'iffers-pictures',
                reason: 'manual',
            })
        ).rejects.toMatchObject({
            status: 502,
            code: 'media.revalidation_failed',
            details: {
                status: 401,
                response: 'invalid token',
            },
        })
    })

    it('builds public catalog cache headers from safe env overrides', () => {
        process.env.MEDIA_PUBLIC_CATALOG_MAX_AGE_SECONDS = '120'
        process.env.MEDIA_PUBLIC_CATALOG_STALE_WHILE_REVALIDATE_SECONDS = '900'

        expect(mediaRevalidationService.publicCatalogCacheControl()).toBe(
            'public, max-age=120, stale-while-revalidate=900'
        )
    })

    it('uses default cache headers when env overrides are blank', () => {
        process.env.MEDIA_PUBLIC_CATALOG_MAX_AGE_SECONDS = '   '
        process.env.MEDIA_PUBLIC_CATALOG_STALE_WHILE_REVALIDATE_SECONDS = ''

        expect(mediaRevalidationService.publicCatalogCacheControl()).toBe(
            'public, max-age=60, stale-while-revalidate=300'
        )
    })
})
