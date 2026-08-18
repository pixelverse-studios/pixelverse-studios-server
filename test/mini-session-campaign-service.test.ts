import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
    from: vi.fn(),
    rpc: vi.fn(),
    queryResults: [] as Array<{ data: unknown; error: unknown }>,
    rpcResults: [] as Array<{ data: unknown; error: unknown }>,
    builders: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
}))

vi.mock('../src/lib/db', () => ({
    db: {
        from: mockState.from,
        rpc: mockState.rpc,
    },
    Tables: {
        WEBSITES: 'websites',
        MEDIA_CATALOG_ITEMS: 'media_catalog_items',
        MINI_SESSION_CAMPAIGNS: 'mini_session_campaigns',
        MINI_SESSION_BOOKING_OPTIONS: 'mini_session_booking_options',
        MINI_SESSION_CAMPAIGN_AUDIT_LOGS:
            'mini_session_campaign_audit_logs',
    },
    COLUMNS: {
        WEBSITE_SLUG: 'website_slug',
    },
}))

vi.mock('../src/services/mini-session-campaign-audit', () => ({
    default: {
        tryCreateLog: vi.fn(),
    },
}))

import { MiniSessionDomainError } from '../src/lib/mini-session-campaigns'
import miniSessionCampaignAudit from '../src/services/mini-session-campaign-audit'
import miniSessionCampaigns from '../src/services/mini-session-campaigns'

const makeQueryBuilder = (result: { data: unknown; error: unknown }) => {
    const builder = {
        select: vi.fn(),
        eq: vi.fn(),
        in: vi.fn(),
        neq: vi.fn(),
        order: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        maybeSingle: vi.fn(),
        single: vi.fn(),
        then: vi.fn(),
    }

    Object.values(builder).forEach(mock => mock.mockReturnValue(builder))
    builder.maybeSingle.mockResolvedValue(result)
    builder.single.mockResolvedValue(result)
    builder.then.mockImplementation((resolve, reject) =>
        Promise.resolve(result).then(resolve, reject)
    )
    return builder
}

const tenant = { id: 'website-1', client_id: 'client-1' }

const campaign = {
    id: '5aa25f8e-278d-44c1-a2d5-363798e75d32',
    website_id: tenant.id,
    client_id: tenant.client_id,
    internal_name: 'Fall Minis 2026 (Copy)',
    status: 'draft',
    public_label: 'Limited fall dates',
    headline: 'Fall Mini Sessions',
    summary: 'A short seasonal session for families.',
    description: 'Twenty relaxed minutes.',
    inclusions_headline: 'Session Details',
    duration_minutes: 20,
    total_price_cents: 30000,
    deposit_cents: 10000,
    balance_due_text: 'The remaining balance is due separately.',
    date_summary: 'October 17–18, 2026',
    location_summary: 'Cliffside Park, NJ',
    inclusions: ['20-minute session'],
    cancellation_policy: 'Deposits are non-refundable.',
    weather_policy: '',
    lateness_policy: 'Late arrival reduces available time.',
    terms_note: '',
    hero_media_id: null,
    cta_label: 'Choose your time',
    homepage_featured: true,
    promo_label: 'Fall Minis',
    promo_headline: 'A little time, a lifetime of memories',
    promo_copy: 'Limited dates are now open.',
    promo_cta_label: 'See fall dates',
    homepage_hero_cta_label: 'Mini Sessions now booking',
    faq_eyebrow: 'Good to know',
    faq_headline: 'Mini Session questions.',
    faq_intro: 'Everything you need to arrive prepared and enjoy a relaxed, beautiful session.',
    booking_eyebrow: 'Reserve your session',
    booking_headline: 'Choose your time.',
    faqs: [],
    meta_title: '',
    meta_description: '',
    published_at: null,
    published_by: null,
    created_by: 'jenn@example.com',
    updated_by: 'jenn@example.com',
    created_at: '2026-08-09T11:00:00.000Z',
    updated_at: '2026-08-09T12:00:00.000Z',
}

const option = {
    id: '437b9218-8cf4-4ac3-a633-eb4262612b5e',
    campaign_id: campaign.id,
    website_id: tenant.id,
    client_id: tenant.client_id,
    label: 'Saturday, October 17',
    description: '',
    date_time_label: 'Saturday, October 17',
    location_label: 'Cliffside Park, NJ',
    cal_booking_url: 'https://cal.com/iffers-pictures/fall-minis-oct-17',
    status: 'open',
    sort_order: 0,
    created_at: campaign.created_at,
    updated_at: campaign.updated_at,
}

const validInput = {
    internalName: 'Fall Minis 2026',
    publicLabel: 'Limited fall dates',
    headline: 'Fall Mini Sessions',
    summary: 'A short seasonal session for families.',
    description: 'Twenty relaxed minutes.',
    inclusionsHeadline: 'Session Details',
    durationMinutes: 20,
    totalPriceCents: 30000,
    depositCents: 10000,
    balanceDueText: 'The remaining balance is due separately.',
    dateSummary: 'October 17–18, 2026',
    locationSummary: 'Cliffside Park, NJ',
    inclusions: ['20-minute session'],
    cancellationPolicy: 'Deposits are non-refundable.',
    weatherPolicy: '',
    latenessPolicy: 'Late arrival reduces available time.',
    termsNote: '',
    heroMediaId: null,
    ctaLabel: 'Choose your time',
    homepageFeatured: true,
    promoLabel: 'Fall Minis',
    promoHeadline: 'A little time, a lifetime of memories',
    promoCopy: 'Limited dates are now open.',
    promoCtaLabel: 'See fall dates',
    homepageHeroCtaLabel: 'Mini Sessions now booking',
    faqEyebrow: 'Good to know',
    faqHeadline: 'Mini Session questions.',
    faqIntro: 'Everything you need to arrive prepared and enjoy a relaxed, beautiful session.',
    bookingEyebrow: 'Reserve your session',
    bookingHeadline: 'Choose your time.',
    faqs: [],
    metaTitle: '',
    metaDescription: '',
    bookingOptions: [
        {
            label: option.label,
            description: option.description,
            dateTimeLabel: option.date_time_label,
            locationLabel: option.location_label,
            calBookingUrl: option.cal_booking_url,
            status: option.status,
            sortOrder: option.sort_order,
        },
    ],
}

describe('Mini Sessions campaign service', () => {
    beforeEach(() => {
        mockState.from.mockReset()
        mockState.rpc.mockReset()
        mockState.queryResults = []
        mockState.rpcResults = []
        mockState.builders = []
        mockState.from.mockImplementation(() => {
            const builder = makeQueryBuilder(
                mockState.queryResults.shift() || {
                    data: null,
                    error: null,
                }
            )
            mockState.builders.push(builder)
            return builder
        })
        mockState.rpc.mockImplementation(() =>
            Promise.resolve(
                mockState.rpcResults.shift() || { data: null, error: null }
            )
        )
        vi.mocked(miniSessionCampaignAudit.tryCreateLog).mockReset()
    })

    it('rejects hero media that does not belong to the resolved tenant', async () => {
        mockState.queryResults = [
            { data: tenant, error: null },
            { data: null, error: null },
        ]

        await expect(
            miniSessionCampaigns.createCampaign({
                websiteSlug: 'iffers-pictures',
                input: { ...validInput, heroMediaId: 99 },
                actor: 'jenn@example.com',
            })
        ).rejects.toEqual(
            expect.objectContaining<Partial<MiniSessionDomainError>>({
                code: 'HERO_MEDIA_INVALID',
            })
        )
        expect(mockState.from).toHaveBeenCalledTimes(2)
    })

    it('duplicates through the tenant-scoped database function and returns a draft', async () => {
        const duplicateId = campaign.id
        mockState.queryResults = [
            { data: tenant, error: null },
            { data: campaign, error: null },
            { data: [option], error: null },
        ]
        mockState.rpcResults = [{ data: duplicateId, error: null }]

        const result = await miniSessionCampaigns.duplicateCampaign({
            websiteSlug: 'iffers-pictures',
            campaignId: '2ebdcb72-84b7-46ae-aa3d-4384c802798d',
            expectedUpdatedAt: '2026-08-09T12:00:00.000Z',
            actor: 'jenn@example.com',
        })

        expect(mockState.rpc).toHaveBeenCalledWith(
            'duplicate_mini_session_campaign',
            expect.objectContaining({
                p_website_id: tenant.id,
                p_client_id: tenant.client_id,
                p_expected_updated_at: '2026-08-09T12:00:00.000Z',
            })
        )
        expect(result.status).toBe('draft')
        expect(result.publishedAt).toBeNull()
        expect(result.bookingOptions).toHaveLength(1)
        expect(miniSessionCampaignAudit.tryCreateLog).toHaveBeenCalledWith(
            expect.objectContaining({
                campaignId: duplicateId,
                action: 'duplicated',
            })
        )
    })

    it('maps stale save conflicts without overwriting campaign data', async () => {
        mockState.queryResults = [
            { data: tenant, error: null },
            { data: campaign, error: null },
            { data: [option], error: null },
        ]
        mockState.rpcResults = [
            {
                data: null,
                error: {
                    code: '40001',
                    message: 'MINI_SESSION_STALE_WRITE',
                },
            },
        ]

        await expect(
            miniSessionCampaigns.updateCampaign({
                websiteSlug: 'iffers-pictures',
                campaignId: campaign.id,
                expectedUpdatedAt: '2026-08-09T11:59:00.000Z',
                actor: 'jenn@example.com',
                input: validInput,
            })
        ).rejects.toEqual(
            expect.objectContaining<Partial<MiniSessionDomainError>>({
                code: 'STALE_WRITE',
            })
        )
        expect(mockState.rpc).toHaveBeenCalledWith(
            'save_mini_session_campaign',
            expect.objectContaining({
                p_campaign: expect.objectContaining({
                    inclusionsHeadline: 'Session Details',
                    faqHeadline: 'Mini Session questions.',
                    bookingEyebrow: 'Reserve your session',
                    bookingHeadline: 'Choose your time.',
                }),
            })
        )
        expect(miniSessionCampaignAudit.tryCreateLog).not.toHaveBeenCalled()
    })
})
