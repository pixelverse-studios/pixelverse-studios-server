import { describe, expect, it } from 'vitest'

import {
    assertCampaignReadyForPublication,
    assertCampaignTransition,
    mapPublicCampaign,
    MiniSessionBookingOptionRow,
    MiniSessionCampaignRow,
    MiniSessionDomainError,
    MiniSessionHeroMediaRow,
    parseMiniSessionCampaignInput,
} from '../src/lib/mini-session-campaigns'

const campaign: MiniSessionCampaignRow = {
    id: '5aa25f8e-278d-44c1-a2d5-363798e75d32',
    website_id: 'website-1',
    client_id: 'client-1',
    internal_name: 'Fall Minis 2026',
    status: 'live',
    public_label: 'Limited fall dates',
    headline: 'Fall Mini Sessions',
    summary: 'A short seasonal session for families.',
    description: 'Twenty relaxed minutes with a curated final gallery.',
    experience_headline: 'A small session with room for real connection.',
    inclusions_headline: 'Session Details',
    vibe_headline: 'Relax and enjoy the moment',
    vibe_content: '<p>Come as you are.</p>',
    duration_minutes: 20,
    total_price_cents: 30000,
    deposit_cents: 10000,
    balance_due_text: 'The remaining balance is due separately.',
    date_summary: 'October 17–18, 2026',
    location_summary: 'Cliffside Park, NJ',
    inclusions: ['20-minute session', 'Curated digital gallery'],
    cancellation_policy: 'Deposits are non-refundable.',
    weather_policy: 'Weather changes will be communicated by email.',
    lateness_policy: 'Late arrival reduces available photography time.',
    terms_note: '',
    hero_media_id: 42,
    cta_label: 'Choose your time',
    homepage_featured: true,
    promo_label: 'Fall Minis',
    promo_headline: 'A little time, a lifetime of memories',
    promo_copy: 'Limited seasonal dates are now open.',
    promo_cta_label: 'See fall dates',
    homepage_hero_cta_label: 'Mini Sessions now booking',
    faqs: [{
        id: '9ec1dd02-337f-49e9-a8a4-a38105c4de25',
        question: 'What should we expect?',
        answerHtml: '<p>A relaxed session.</p>',
        sortOrder: 0,
    }],
    meta_title: 'Fall Mini Sessions in Bergen County',
    meta_description: 'Reserve a seasonal family Mini Session.',
    published_at: '2026-08-09T12:00:00.000Z',
    published_by: 'jenn@example.com',
    created_by: 'jenn@example.com',
    updated_by: 'jenn@example.com',
    created_at: '2026-08-09T11:00:00.000Z',
    updated_at: '2026-08-09T12:00:00.000Z',
}

const openOption: MiniSessionBookingOptionRow = {
    id: '437b9218-8cf4-4ac3-a633-eb4262612b5e',
    campaign_id: campaign.id,
    website_id: campaign.website_id,
    client_id: campaign.client_id,
    label: 'Saturday, October 17',
    description: 'Morning and afternoon times.',
    date_time_label: 'Saturday, October 17',
    location_label: 'Cliffside Park, NJ',
    cal_booking_url: 'https://cal.com/iffers-pictures/fall-minis-oct-17',
    status: 'open',
    sort_order: 0,
    created_at: campaign.created_at,
    updated_at: campaign.updated_at,
}

const hiddenOption: MiniSessionBookingOptionRow = {
    ...openOption,
    id: '60454f93-3121-4daf-a046-a520670fcd7f',
    label: 'Internal test date',
    status: 'hidden',
    sort_order: 1,
}

const heroMedia: MiniSessionHeroMediaRow = {
    id: 42,
    website_id: campaign.website_id,
    client_id: campaign.client_id,
    key: 'events/fall-minis/hero.jpg',
    src: 'https://media.ifferspictures.com/events/fall-minis/hero.jpg',
    alt: 'Family enjoying a fall Mini Session',
    aspect_ratio: 'landscape',
    crop_position: 'center center',
    status: 'published',
}

const validInput = {
    internalName: 'Fall Minis 2026',
    publicLabel: 'Limited fall dates',
    headline: 'Fall Mini Sessions',
    summary: 'A short seasonal session for families.',
    description: 'Twenty relaxed minutes.',
    experienceHeadline: 'A small session with room for real connection.',
    inclusionsHeadline: 'Session Details',
    vibeHeadline: 'Relax and enjoy the moment',
    vibeContent: '<p>Come as you are.</p>',
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
    heroMediaId: 42,
    ctaLabel: 'Choose your time',
    homepageFeatured: true,
    promoLabel: 'Fall Minis',
    promoHeadline: 'A little time, a lifetime of memories',
    promoCopy: 'Limited dates are now open.',
    promoCtaLabel: 'See fall dates',
    homepageHeroCtaLabel: 'Mini Sessions now booking',
    faqs: [{
        id: '9ec1dd02-337f-49e9-a8a4-a38105c4de25',
        question: 'What should we expect?',
        answerHtml: '<p>A relaxed session.</p>',
        sortOrder: 0,
    }],
    metaTitle: '',
    metaDescription: '',
    bookingOptions: [
        {
            label: 'Saturday, October 17',
            description: '',
            dateTimeLabel: 'Saturday, October 17',
            locationLabel: 'Cliffside Park, NJ',
            calBookingUrl:
                'https://cal.com/iffers-pictures/fall-minis-oct-17',
            status: 'open' as const,
            sortOrder: 0,
        },
    ],
}

describe('Mini Sessions campaign domain', () => {
    it('accepts integer-cent pricing and supported Cal.com URLs', () => {
        expect(parseMiniSessionCampaignInput(validInput)).toMatchObject({
            totalPriceCents: 30000,
            depositCents: 10000,
            inclusionsHeadline: 'Session Details',
        })
    })

    it('defaults the inclusions heading for older clients and rejects blank headings', () => {
        const { inclusionsHeadline: _inclusionsHeadline, ...legacyInput } = validInput

        expect(parseMiniSessionCampaignInput(legacyInput).inclusionsHeadline).toBe(
            'Session Details'
        )
        expect(() =>
            parseMiniSessionCampaignInput({
                ...validInput,
                inclusionsHeadline: '   ',
            })
        ).toThrowError(
            expect.objectContaining<Partial<MiniSessionDomainError>>({
                code: 'VALIDATION_ERROR',
            })
        )
    })

    it('sanitizes campaign and FAQ rich text before persistence', () => {
        const parsed = parseMiniSessionCampaignInput({
            ...validInput,
            description: '<p>Hello <strong>families</strong></p><script>alert(1)</script>',
            vibeContent: '<p><u>Relax</u></p><img src=x onerror=alert(1)>',
            faqs: [{
                ...validInput.faqs[0],
                answerHtml: '<p>Safe <em>answer</em></p><script>alert(1)</script>',
            }],
        })

        expect(parsed.description).toBe('<p>Hello <strong>families</strong></p>')
        expect(parsed.vibeContent).toBe('<p><u>Relax</u></p>')
        expect(parsed.faqs[0].answerHtml).toBe('<p>Safe <em>answer</em></p>')
    })

    it('rejects deposits above the total price', () => {
        expect(() =>
            parseMiniSessionCampaignInput({
                ...validInput,
                depositCents: 30001,
            })
        ).toThrowError(
            expect.objectContaining<Partial<MiniSessionDomainError>>({
                code: 'VALIDATION_ERROR',
            })
        )
    })

    it.each([
        'http://cal.com/iffers-pictures/fall-minis',
        'https://example.com/iffers-pictures/fall-minis',
        'https://user:password@cal.com/iffers-pictures/fall-minis',
        '//cal.com/iffers-pictures/fall-minis',
    ])('rejects unsafe or unsupported booking URL %s', calBookingUrl => {
        expect(() =>
            parseMiniSessionCampaignInput({
                ...validInput,
                bookingOptions: [
                    { ...validInput.bookingOptions[0], calBookingUrl },
                ],
            })
        ).toThrowError(
            expect.objectContaining<Partial<MiniSessionDomainError>>({
                code: 'VALIDATION_ERROR',
            })
        )
    })

    it('rejects duplicate option ordering and more than six options', () => {
        const duplicateOrder = [
            validInput.bookingOptions[0],
            {
                ...validInput.bookingOptions[0],
                label: 'Sunday, October 18',
            },
        ]
        expect(() =>
            parseMiniSessionCampaignInput({
                ...validInput,
                bookingOptions: duplicateOrder,
            })
        ).toThrowError()

        expect(() =>
            parseMiniSessionCampaignInput({
                ...validInput,
                bookingOptions: Array.from({ length: 7 }, (_, sortOrder) => ({
                    ...validInput.bookingOptions[0],
                    label: `Option ${sortOrder + 1}`,
                    sortOrder,
                })),
            })
        ).toThrowError()
    })

    it('omits private fields and hidden options from the public projection', () => {
        const result = mapPublicCampaign(
            campaign,
            [openOption, hiddenOption],
            heroMedia
        )

        expect(result).not.toHaveProperty('internalName')
        expect(result).not.toHaveProperty('heroMediaId')
        expect(result).not.toHaveProperty('createdBy')
        expect(result.inclusionsHeadline).toBe('Session Details')
        expect(result.bookingOptions).toHaveLength(1)
        expect(result.bookingOptions[0].label).toBe('Saturday, October 17')
    })

    it('rejects non-public campaigns from the public projection', () => {
        expect(() =>
            mapPublicCampaign(
                { ...campaign, status: 'draft' },
                [openOption],
                heroMedia
            )
        ).toThrowError(
            expect.objectContaining<Partial<MiniSessionDomainError>>({
                code: 'CAMPAIGN_NOT_FOUND',
            })
        )
    })

    it('requires published, same-tenant hero media and an open option', () => {
        expect(() =>
            assertCampaignReadyForPublication({
                campaign: { ...campaign, status: 'draft' },
                bookingOptions: [openOption],
                heroMedia: { ...heroMedia, website_id: 'another-website' },
            })
        ).toThrowError(
            expect.objectContaining<Partial<MiniSessionDomainError>>({
                code: 'HERO_MEDIA_INVALID',
            })
        )

        expect(() =>
            assertCampaignReadyForPublication({
                campaign: { ...campaign, status: 'draft' },
                bookingOptions: [{ ...openOption, status: 'sold_out' }],
                heroMedia,
            })
        ).toThrowError(
            expect.objectContaining<Partial<MiniSessionDomainError>>({
                code: 'OPEN_OPTION_REQUIRED',
            })
        )
    })

    it('enforces explicit lifecycle transitions', () => {
        expect(() => assertCampaignTransition('draft', 'live')).not.toThrow()
        expect(() => assertCampaignTransition('live', 'sold_out')).not.toThrow()
        expect(() => assertCampaignTransition('sold_out', 'closed')).not.toThrow()
        expect(() => assertCampaignTransition('archived', 'live')).toThrowError(
            expect.objectContaining<Partial<MiniSessionDomainError>>({
                code: 'INVALID_TRANSITION',
            })
        )
    })
})
