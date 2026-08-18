import { z } from 'zod'
import { sanitizeRichText } from '../utils/html'

export const MINI_SESSION_CAMPAIGN_STATUSES = [
    'draft',
    'live',
    'sold_out',
    'closed',
    'archived',
] as const

export const MINI_SESSION_BOOKING_OPTION_STATUSES = [
    'open',
    'sold_out',
    'hidden',
] as const

export type MiniSessionCampaignStatus =
    (typeof MINI_SESSION_CAMPAIGN_STATUSES)[number]
export type MiniSessionBookingOptionStatus =
    (typeof MINI_SESSION_BOOKING_OPTION_STATUSES)[number]

const boundedText = (max: number, required = false) => {
    const schema = z.string().max(max)
    return required
        ? schema.refine(value => value.trim().length > 0, 'Required')
        : schema
}

const miniSessionFaqInputSchema = z.object({
    id: z.string().uuid(),
    question: boundedText(240, true),
    answerHtml: boundedText(10000, true),
    sortOrder: z.number().int().min(0).max(49),
}).strict()

export const miniSessionBookingOptionInputSchema = z.object({
    id: z.string().uuid().optional(),
    label: boundedText(120, true),
    description: boundedText(600).default(''),
    dateTimeLabel: boundedText(200).default(''),
    locationLabel: boundedText(200).default(''),
    calBookingUrl: z
        .string()
        .max(2048)
        .url()
        .superRefine((value, context) => {
            try {
                const url = new URL(value)
                if (
                    url.protocol !== 'https:' ||
                    url.username !== '' ||
                    url.password !== '' ||
                    !['cal.com', 'www.cal.com'].includes(
                        url.hostname.toLowerCase()
                    )
                ) {
                    context.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: 'Use an HTTPS cal.com booking URL',
                    })
                }
            } catch {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Use a valid Cal.com booking URL',
                })
            }
        }),
    status: z.enum(MINI_SESSION_BOOKING_OPTION_STATUSES).default('open'),
    sortOrder: z.number().int().min(0).max(5),
}).strict()

export const miniSessionCampaignInputSchema = z
    .object({
        internalName: boundedText(120, true),
        publicLabel: boundedText(80).default(''),
        headline: boundedText(160).default(''),
        summary: boundedText(320).default(''),
        description: boundedText(5000).default(''),
        experienceHeadline: boundedText(200).default(''),
        inclusionsHeadline: boundedText(200, true).default(
            'Session Details'
        ),
        vibeHeadline: boundedText(200).default(''),
        vibeContent: boundedText(10000).default(''),
        durationMinutes: z.number().int().min(1).max(480).default(20),
        totalPriceCents: z.number().int().min(0).max(10000000).default(0),
        depositCents: z.number().int().min(0).max(10000000).default(0),
        balanceDueText: boundedText(600).default(''),
        dateSummary: boundedText(200).default(''),
        locationSummary: boundedText(200).default(''),
        inclusions: z.array(boundedText(200, true)).max(12).default([]),
        cancellationPolicy: boundedText(2000).default(''),
        weatherPolicy: boundedText(2000).default(''),
        latenessPolicy: boundedText(2000).default(''),
        termsNote: boundedText(2000).default(''),
        heroMediaId: z.number().int().positive().nullable().default(null),
        ctaLabel: boundedText(80, true).default('Choose your time'),
        homepageFeatured: z.boolean().default(false),
        promoLabel: boundedText(80).default(''),
        promoHeadline: boundedText(160).default(''),
        promoCopy: boundedText(320).default(''),
        promoCtaLabel: boundedText(80).default(''),
        homepageHeroCtaLabel: boundedText(80).default(''),
        faqEyebrow: boundedText(80, true).default('Good to know'),
        faqHeadline: boundedText(200, true).default(
            'Mini Session questions.'
        ),
        faqIntro: boundedText(600, true).default(
            'Everything you need to arrive prepared and enjoy a relaxed, beautiful session.'
        ),
        bookingEyebrow: boundedText(80, true).default(
            'Reserve your session'
        ),
        bookingHeadline: boundedText(200, true).default(
            'Choose your time.'
        ),
        faqs: z.array(miniSessionFaqInputSchema).max(50).default([]),
        metaTitle: boundedText(120).default(''),
        metaDescription: boundedText(320).default(''),
        bookingOptions: z
            .array(miniSessionBookingOptionInputSchema)
            .max(6)
            .default([]),
    })
    .strict()
    .superRefine((value, context) => {
        if (value.depositCents > value.totalPriceCents) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['depositCents'],
                message: 'Deposit cannot exceed the total price',
            })
        }

        const orders = value.bookingOptions.map(option => option.sortOrder)
        if (new Set(orders).size !== orders.length) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['bookingOptions'],
                message: 'Booking option sort orders must be unique',
            })
        }


        const faqOrders = value.faqs.map(faq => faq.sortOrder)
        if (new Set(faqOrders).size !== faqOrders.length) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['faqs'],
                message: 'FAQ sort orders must be unique',
            })
        }
    })

export type MiniSessionCampaignInput = z.infer<
    typeof miniSessionCampaignInputSchema
>
export type MiniSessionBookingOptionInput = z.infer<
    typeof miniSessionBookingOptionInputSchema
>

export interface MiniSessionCampaignRow {
    id: string
    website_id: string
    client_id: string
    internal_name: string
    status: MiniSessionCampaignStatus
    public_label: string
    headline: string
    summary: string
    description: string
    experience_headline: string
    inclusions_headline: string
    vibe_headline: string
    vibe_content: string
    duration_minutes: number
    total_price_cents: number
    deposit_cents: number
    balance_due_text: string
    date_summary: string
    location_summary: string
    inclusions: string[]
    cancellation_policy: string
    weather_policy: string
    lateness_policy: string
    terms_note: string
    hero_media_id: number | null
    cta_label: string
    homepage_featured: boolean
    promo_label: string
    promo_headline: string
    promo_copy: string
    promo_cta_label: string
    homepage_hero_cta_label: string
    faq_eyebrow: string
    faq_headline: string
    faq_intro: string
    booking_eyebrow: string
    booking_headline: string
    faqs: MiniSessionFaq[]
    meta_title: string
    meta_description: string
    published_at: string | null
    published_by: string | null
    created_by: string | null
    updated_by: string | null
    created_at: string
    updated_at: string
}

export interface MiniSessionBookingOptionRow {
    id: string
    campaign_id: string
    website_id: string
    client_id: string
    label: string
    description: string
    date_time_label: string
    location_label: string
    cal_booking_url: string
    status: MiniSessionBookingOptionStatus
    sort_order: number
    created_at: string
    updated_at: string
}

export interface MiniSessionHeroMediaRow {
    id: number
    website_id: string
    client_id: string
    key: string
    src: string
    alt: string
    aspect_ratio: string | null
    crop_position: string | null
    status: 'draft' | 'published' | 'archived'
}

export interface MiniSessionBookingOption {
    id: string
    label: string
    description: string
    dateTimeLabel: string
    locationLabel: string
    calBookingUrl: string
    status: MiniSessionBookingOptionStatus
    sortOrder: number
    updatedAt: string
}

export interface MiniSessionFaq {
    id: string
    question: string
    answerHtml: string
    sortOrder: number
}

export interface MiniSessionHeroMedia {
    id: number
    key: string
    src: string
    alt: string
    aspectRatio: string | null
    cropPosition: string | null
}

export interface MiniSessionAdminCampaign {
    id: string
    internalName: string
    status: MiniSessionCampaignStatus
    publicLabel: string
    headline: string
    summary: string
    description: string
    experienceHeadline: string
    inclusionsHeadline: string
    vibeHeadline: string
    vibeContent: string
    durationMinutes: number
    totalPriceCents: number
    depositCents: number
    balanceDueText: string
    dateSummary: string
    locationSummary: string
    inclusions: string[]
    cancellationPolicy: string
    weatherPolicy: string
    latenessPolicy: string
    termsNote: string
    heroMediaId: number | null
    heroMedia: MiniSessionHeroMedia | null
    ctaLabel: string
    homepageFeatured: boolean
    promoLabel: string
    promoHeadline: string
    promoCopy: string
    promoCtaLabel: string
    homepageHeroCtaLabel: string
    faqEyebrow: string
    faqHeadline: string
    faqIntro: string
    bookingEyebrow: string
    bookingHeadline: string
    faqs: MiniSessionFaq[]
    metaTitle: string
    metaDescription: string
    bookingOptions: MiniSessionBookingOption[]
    publishedAt: string | null
    createdAt: string
    updatedAt: string
}

export type MiniSessionPublicCampaign = Omit<
    MiniSessionAdminCampaign,
    'internalName' | 'heroMediaId' | 'bookingOptions'
> & {
    bookingOptions: MiniSessionBookingOption[]
}

export type MiniSessionDomainErrorCode =
    | 'VALIDATION_ERROR'
    | 'WEBSITE_NOT_FOUND'
    | 'CAMPAIGN_NOT_FOUND'
    | 'STALE_WRITE'
    | 'INVALID_TRANSITION'
    | 'CAMPAIGN_NOT_READY'
    | 'HERO_MEDIA_INVALID'
    | 'OPEN_OPTION_REQUIRED'

export class MiniSessionDomainError extends Error {
    constructor(
        public readonly code: MiniSessionDomainErrorCode,
        message: string,
        public readonly details?: unknown
    ) {
        super(message)
        this.name = 'MiniSessionDomainError'
    }
}

export const parseMiniSessionCampaignInput = (
    input: unknown
): MiniSessionCampaignInput => {
    const result = miniSessionCampaignInputSchema.safeParse(input)
    if (!result.success) {
        throw new MiniSessionDomainError(
            'VALIDATION_ERROR',
            'Mini Sessions campaign data is invalid',
            result.error.flatten()
        )
    }
    return {
        ...result.data,
        description: sanitizeRichText(result.data.description),
        vibeContent: sanitizeRichText(result.data.vibeContent),
        faqs: result.data.faqs.map(faq => ({
            ...faq,
            answerHtml: sanitizeRichText(faq.answerHtml),
        })),
    }
}

export const mapBookingOption = (
    row: MiniSessionBookingOptionRow
): MiniSessionBookingOption => ({
    id: row.id,
    label: row.label,
    description: row.description,
    dateTimeLabel: row.date_time_label,
    locationLabel: row.location_label,
    calBookingUrl: row.cal_booking_url,
    status: row.status,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
})

export const mapHeroMedia = (
    row: MiniSessionHeroMediaRow | null
): MiniSessionHeroMedia | null =>
    row
        ? {
              id: row.id,
              key: row.key,
              src: row.src,
              alt: row.alt,
              aspectRatio: row.aspect_ratio,
              cropPosition: row.crop_position,
          }
        : null

export const mapAdminCampaign = (
    row: MiniSessionCampaignRow,
    options: MiniSessionBookingOptionRow[],
    heroMedia: MiniSessionHeroMediaRow | null
): MiniSessionAdminCampaign => ({
    id: row.id,
    internalName: row.internal_name,
    status: row.status,
    publicLabel: row.public_label,
    headline: row.headline,
    summary: row.summary,
    description: row.description,
    experienceHeadline:
        row.experience_headline || 'A small session with room for real connection.',
    inclusionsHeadline: row.inclusions_headline || 'Session Details',
    vibeHeadline: row.vibe_headline || 'Relax and Enjoy the Moment',
    vibeContent: row.vibe_content || '',
    durationMinutes: row.duration_minutes,
    totalPriceCents: row.total_price_cents,
    depositCents: row.deposit_cents,
    balanceDueText: row.balance_due_text,
    dateSummary: row.date_summary,
    locationSummary: row.location_summary,
    inclusions: row.inclusions,
    cancellationPolicy: row.cancellation_policy,
    weatherPolicy: row.weather_policy,
    latenessPolicy: row.lateness_policy,
    termsNote: row.terms_note,
    heroMediaId: row.hero_media_id,
    heroMedia: mapHeroMedia(heroMedia),
    ctaLabel: row.cta_label,
    homepageFeatured: row.homepage_featured,
    promoLabel: row.promo_label,
    promoHeadline: row.promo_headline,
    promoCopy: row.promo_copy,
    promoCtaLabel: row.promo_cta_label,
    homepageHeroCtaLabel:
        row.homepage_hero_cta_label || 'Mini Sessions now booking',
    faqEyebrow: row.faq_eyebrow || 'Good to know',
    faqHeadline: row.faq_headline || 'Mini Session questions.',
    faqIntro:
        row.faq_intro ||
        'Everything you need to arrive prepared and enjoy a relaxed, beautiful session.',
    bookingEyebrow: row.booking_eyebrow || 'Reserve your session',
    bookingHeadline: row.booking_headline || 'Choose your time.',
    faqs: [...(row.faqs || [])].sort((a, b) => a.sortOrder - b.sortOrder),
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    bookingOptions: options.map(mapBookingOption),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
})

export const mapPublicCampaign = (
    row: MiniSessionCampaignRow,
    options: MiniSessionBookingOptionRow[],
    heroMedia: MiniSessionHeroMediaRow | null
): MiniSessionPublicCampaign => {
    if (!['live', 'sold_out'].includes(row.status)) {
        throw new MiniSessionDomainError(
            'CAMPAIGN_NOT_FOUND',
            'No public Mini Sessions campaign is available'
        )
    }

    const { internalName: _internalName, heroMediaId: _heroMediaId, ...publicData } =
        mapAdminCampaign(
            row,
            options.filter(option => option.status !== 'hidden'),
            heroMedia?.status === 'published' ? heroMedia : null
        )

    return publicData
}

export interface PublicationReadinessInput {
    campaign: MiniSessionCampaignRow
    bookingOptions: MiniSessionBookingOptionRow[]
    heroMedia: MiniSessionHeroMediaRow | null
}

export const assertCampaignReadyForPublication = ({
    campaign,
    bookingOptions,
    heroMedia,
}: PublicationReadinessInput): void => {
    if (
        !heroMedia ||
        heroMedia.id !== campaign.hero_media_id ||
        heroMedia.website_id !== campaign.website_id ||
        heroMedia.client_id !== campaign.client_id ||
        heroMedia.status !== 'published'
    ) {
        throw new MiniSessionDomainError(
            'HERO_MEDIA_INVALID',
            'Select published hero media from this website before publishing'
        )
    }

    if (!bookingOptions.some(option => option.status === 'open')) {
        throw new MiniSessionDomainError(
            'OPEN_OPTION_REQUIRED',
            'At least one open booking option is required before publishing'
        )
    }

    const requiredText = [
        campaign.headline,
        campaign.summary,
        campaign.description,
        campaign.experience_headline,
        campaign.inclusions_headline,
        campaign.vibe_headline,
        campaign.vibe_content,
        campaign.balance_due_text,
        campaign.date_summary,
        campaign.location_summary,
        campaign.faq_eyebrow,
        campaign.faq_headline,
        campaign.faq_intro,
        campaign.booking_eyebrow,
        campaign.booking_headline,
        campaign.cancellation_policy,
        campaign.lateness_policy,
        campaign.cta_label,
    ]

    if (
        requiredText.some(value => value.trim().length === 0) ||
        campaign.inclusions.length === 0 ||
        campaign.faqs.length === 0 ||
        campaign.total_price_cents <= 0 ||
        campaign.deposit_cents <= 0
    ) {
        throw new MiniSessionDomainError(
            'CAMPAIGN_NOT_READY',
            'Complete the required offer, pricing, policy, and booking fields before publishing'
        )
    }
}

const TRANSITIONS: Record<
    MiniSessionCampaignStatus,
    MiniSessionCampaignStatus[]
> = {
    draft: ['live', 'archived'],
    live: ['sold_out', 'closed'],
    sold_out: ['live', 'closed'],
    closed: ['live', 'archived'],
    archived: [],
}

export const assertCampaignTransition = (
    from: MiniSessionCampaignStatus,
    to: MiniSessionCampaignStatus
): void => {
    if (!TRANSITIONS[from].includes(to)) {
        throw new MiniSessionDomainError(
            'INVALID_TRANSITION',
            `Cannot change a Mini Sessions campaign from ${from} to ${to}`
        )
    }
}
