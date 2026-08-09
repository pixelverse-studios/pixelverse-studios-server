import { describe, expect, it, vi } from 'vitest'

import siteContentRevalidation, {
    MINI_SESSION_REVALIDATION_PATHS,
} from '../src/services/site-content-revalidation'

describe('site content revalidation', () => {
    it('skips delivery when no signed webhook is configured', async () => {
        const result =
            await siteContentRevalidation.triggerMiniSessionRevalidation({
                websiteSlug: 'iffers-pictures',
                campaignId: '5aa25f8e-278d-44c1-a2d5-363798e75d32',
                reason: 'campaign_published',
                actor: 'jenn@example.com',
            })

        expect(result).toEqual(
            expect.objectContaining({
                configured: false,
                triggered: false,
                skipped: true,
                affected_paths: [...MINI_SESSION_REVALIDATION_PATHS],
                revalidate_layout: true,
            })
        )
        expect(fetch).not.toHaveBeenCalled()
    })

    it('sends a signed campaign payload for every affected public surface', async () => {
        process.env.SITE_REVALIDATION_WEBHOOK_URL =
            'https://iffers.example.test/api/revalidate'
        process.env.SITE_REVALIDATION_SECRET = 'signed-secret'
        vi.mocked(fetch).mockResolvedValue(new Response('ok', { status: 202 }))

        const result =
            await siteContentRevalidation.triggerMiniSessionRevalidation({
                websiteSlug: 'iffers-pictures',
                campaignId: '5aa25f8e-278d-44c1-a2d5-363798e75d32',
                reason: 'campaign_closed',
                actor: 'jenn@example.com',
            })

        const [url, init] = vi.mocked(fetch).mock.calls[0]
        const body = JSON.parse(String((init as RequestInit).body))
        expect(url).toBe('https://iffers.example.test/api/revalidate')
        expect(init).toEqual(
            expect.objectContaining({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer signed-secret',
                },
            })
        )
        expect(body).toEqual(
            expect.objectContaining({
                content_type: 'mini_session_campaign',
                reason: 'campaign_closed',
                website_slug: 'iffers-pictures',
                campaign_id: '5aa25f8e-278d-44c1-a2d5-363798e75d32',
                affected_paths: ['/', '/mini-sessions', '/sitemap.xml'],
                revalidate_layout: true,
                actor: 'jenn@example.com',
            })
        )
        expect(result).toEqual(
            expect.objectContaining({ triggered: true, status: 202 })
        )
    })

    it('reports webhook failures without changing campaign persistence semantics', async () => {
        process.env.SITE_REVALIDATION_WEBHOOK_URL =
            'https://iffers.example.test/api/revalidate'
        vi.mocked(fetch).mockResolvedValue(
            new Response('invalid signature', { status: 401 })
        )

        await expect(
            siteContentRevalidation.triggerMiniSessionRevalidation({
                websiteSlug: 'iffers-pictures',
                campaignId: '5aa25f8e-278d-44c1-a2d5-363798e75d32',
                reason: 'campaign_published',
            })
        ).rejects.toMatchObject({
            code: 'site_content.revalidation_failed',
            details: { status: 401, response: 'invalid signature' },
        })
    })

    it('caps the public campaign cache at sixty seconds', () => {
        process.env.MINI_SESSION_PUBLIC_MAX_AGE_SECONDS = '600'
        expect(siteContentRevalidation.publicCampaignCacheControl()).toBe(
            'public, max-age=60, must-revalidate'
        )

        process.env.MINI_SESSION_PUBLIC_MAX_AGE_SECONDS = '30'
        expect(siteContentRevalidation.publicCampaignCacheControl()).toBe(
            'public, max-age=30, must-revalidate'
        )
    })
})
