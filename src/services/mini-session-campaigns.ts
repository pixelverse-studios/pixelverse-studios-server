import { db, COLUMNS, Tables } from '../lib/db'
import {
    assertCampaignReadyForPublication,
    assertCampaignTransition,
    mapAdminCampaign,
    mapPublicCampaign,
    MiniSessionAdminCampaign,
    MiniSessionBookingOptionInput,
    MiniSessionBookingOptionRow,
    MiniSessionCampaignInput,
    MiniSessionCampaignRow,
    MiniSessionCampaignStatus,
    MiniSessionDomainError,
    MiniSessionHeroMediaRow,
    MiniSessionPublicCampaign,
    parseMiniSessionCampaignInput,
} from '../lib/mini-session-campaigns'
import miniSessionCampaignAudit from './mini-session-campaign-audit'

interface WebsiteTenant {
    id: string
    client_id: string
}

interface CampaignBundle {
    campaign: MiniSessionCampaignRow
    bookingOptions: MiniSessionBookingOptionRow[]
    heroMedia: MiniSessionHeroMediaRow | null
}

interface CampaignLookup {
    websiteSlug: string
    campaignId: string
}

interface CampaignMutation extends CampaignLookup {
    expectedUpdatedAt: string
    actor: string
}

interface CreateCampaignInput {
    websiteSlug: string
    input: unknown
    actor: string
}

interface UpdateCampaignInput extends CampaignMutation {
    input: unknown
}

interface ListCampaignsInput {
    websiteSlug: string
    includeArchived?: boolean
}

const CAMPAIGN_SELECT = '*'
const BOOKING_OPTION_SELECT = '*'
const HERO_MEDIA_SELECT =
    'id, website_id, client_id, key, src, alt, aspect_ratio, crop_position, status'

const resolveTenant = async (websiteSlug: string): Promise<WebsiteTenant> => {
    const { data, error } = await db
        .from(Tables.WEBSITES)
        .select('id, client_id')
        .eq(COLUMNS.WEBSITE_SLUG, websiteSlug)
        .maybeSingle()

    if (error) throw error
    if (!data) {
        throw new MiniSessionDomainError(
            'WEBSITE_NOT_FOUND',
            `Website ${websiteSlug} was not found`
        )
    }

    return data as WebsiteTenant
}

const getCampaignRow = async (
    tenant: WebsiteTenant,
    campaignId: string
): Promise<MiniSessionCampaignRow> => {
    const { data, error } = await db
        .from(Tables.MINI_SESSION_CAMPAIGNS)
        .select(CAMPAIGN_SELECT)
        .eq('id', campaignId)
        .eq('website_id', tenant.id)
        .eq('client_id', tenant.client_id)
        .maybeSingle()

    if (error) throw error
    if (!data) {
        throw new MiniSessionDomainError(
            'CAMPAIGN_NOT_FOUND',
            'Mini Sessions campaign was not found'
        )
    }

    return data as MiniSessionCampaignRow
}

const getBookingOptions = async (
    tenant: WebsiteTenant,
    campaignId: string
): Promise<MiniSessionBookingOptionRow[]> => {
    const { data, error } = await db
        .from(Tables.MINI_SESSION_BOOKING_OPTIONS)
        .select(BOOKING_OPTION_SELECT)
        .eq('campaign_id', campaignId)
        .eq('website_id', tenant.id)
        .eq('client_id', tenant.client_id)
        .order('sort_order', { ascending: true })

    if (error) throw error
    return (data || []) as MiniSessionBookingOptionRow[]
}

const getHeroMedia = async (
    tenant: WebsiteTenant,
    heroMediaId: number | null
): Promise<MiniSessionHeroMediaRow | null> => {
    if (heroMediaId === null) return null

    const { data, error } = await db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .select(HERO_MEDIA_SELECT)
        .eq('id', heroMediaId)
        .eq('website_id', tenant.id)
        .eq('client_id', tenant.client_id)
        .maybeSingle()

    if (error) throw error
    return (data as MiniSessionHeroMediaRow | null) || null
}

const assertHeroMediaTenant = async (
    tenant: WebsiteTenant,
    heroMediaId: number | null
): Promise<void> => {
    if (heroMediaId === null) return

    const media = await getHeroMedia(tenant, heroMediaId)
    if (!media) {
        throw new MiniSessionDomainError(
            'HERO_MEDIA_INVALID',
            'Hero media must belong to the same website and client'
        )
    }
}

const getCampaignBundle = async (
    tenant: WebsiteTenant,
    campaignId: string
): Promise<CampaignBundle> => {
    const campaign = await getCampaignRow(tenant, campaignId)
    const [bookingOptions, heroMedia] = await Promise.all([
        getBookingOptions(tenant, campaign.id),
        getHeroMedia(tenant, campaign.hero_media_id),
    ])

    return { campaign, bookingOptions, heroMedia }
}

const toCampaignPayload = (
    input: MiniSessionCampaignInput,
    actor: string
): Omit<Record<string, unknown>, 'bookingOptions'> => ({
    internal_name: input.internalName,
    public_label: input.publicLabel,
    headline: input.headline,
    summary: input.summary,
    description: input.description,
    experience_headline: input.experienceHeadline,
    vibe_headline: input.vibeHeadline,
    vibe_content: input.vibeContent,
    duration_minutes: input.durationMinutes,
    total_price_cents: input.totalPriceCents,
    deposit_cents: input.depositCents,
    balance_due_text: input.balanceDueText,
    date_summary: input.dateSummary,
    location_summary: input.locationSummary,
    inclusions: input.inclusions,
    cancellation_policy: input.cancellationPolicy,
    weather_policy: input.weatherPolicy,
    lateness_policy: input.latenessPolicy,
    terms_note: input.termsNote,
    hero_media_id: input.heroMediaId,
    cta_label: input.ctaLabel,
    homepage_featured: input.homepageFeatured,
    promo_label: input.promoLabel,
    promo_headline: input.promoHeadline,
    promo_copy: input.promoCopy,
    promo_cta_label: input.promoCtaLabel,
    homepage_hero_cta_label: input.homepageHeroCtaLabel,
    faqs: input.faqs,
    meta_title: input.metaTitle,
    meta_description: input.metaDescription,
    updated_by: actor,
})

const toBookingOptionRows = (
    options: MiniSessionBookingOptionInput[],
    campaign: Pick<MiniSessionCampaignRow, 'id' | 'website_id' | 'client_id'>
): Record<string, unknown>[] =>
    options.map(option => ({
        ...(option.id ? { id: option.id } : {}),
        campaign_id: campaign.id,
        website_id: campaign.website_id,
        client_id: campaign.client_id,
        label: option.label,
        description: option.description,
        date_time_label: option.dateTimeLabel,
        location_label: option.locationLabel,
        cal_booking_url: option.calBookingUrl,
        status: option.status,
        sort_order: option.sortOrder,
    }))

const mapRpcError = (error: { message?: string; code?: string }): never => {
    const message = error.message || 'Mini Sessions database operation failed'
    if (message.includes('MINI_SESSION_STALE_WRITE') || error.code === '40001') {
        throw new MiniSessionDomainError(
            'STALE_WRITE',
            'This campaign changed after it was loaded. Refresh before saving.'
        )
    }
    if (message.includes('MINI_SESSION_CAMPAIGN_NOT_FOUND')) {
        throw new MiniSessionDomainError(
            'CAMPAIGN_NOT_FOUND',
            'Mini Sessions campaign was not found'
        )
    }
    if (message.includes('MINI_SESSION_HERO_MEDIA_INVALID')) {
        throw new MiniSessionDomainError(
            'HERO_MEDIA_INVALID',
            'Select published hero media from this website before publishing'
        )
    }
    if (message.includes('MINI_SESSION_OPEN_OPTION_REQUIRED')) {
        throw new MiniSessionDomainError(
            'OPEN_OPTION_REQUIRED',
            'At least one open booking option is required before publishing'
        )
    }
    if (message.includes('MINI_SESSION_CAMPAIGN_NOT_READY')) {
        throw new MiniSessionDomainError(
            'CAMPAIGN_NOT_READY',
            'Complete the required campaign fields before publishing'
        )
    }
    if (message.includes('MINI_SESSION_INVALID_TRANSITION')) {
        throw new MiniSessionDomainError(
            'INVALID_TRANSITION',
            'The requested campaign state change is not allowed'
        )
    }
    throw error
}

const listCampaigns = async ({
    websiteSlug,
    includeArchived = false,
}: ListCampaignsInput): Promise<MiniSessionAdminCampaign[]> => {
    const tenant = await resolveTenant(websiteSlug)
    let query = db
        .from(Tables.MINI_SESSION_CAMPAIGNS)
        .select(CAMPAIGN_SELECT)
        .eq('website_id', tenant.id)
        .eq('client_id', tenant.client_id)
        .order('updated_at', { ascending: false })

    if (!includeArchived) query = query.neq('status', 'archived')

    const { data, error } = await query
    if (error) throw error

    return Promise.all(
        ((data || []) as MiniSessionCampaignRow[]).map(async campaign => {
            const [bookingOptions, heroMedia] = await Promise.all([
                getBookingOptions(tenant, campaign.id),
                getHeroMedia(tenant, campaign.hero_media_id),
            ])
            return mapAdminCampaign(campaign, bookingOptions, heroMedia)
        })
    )
}

const getCampaign = async ({
    websiteSlug,
    campaignId,
}: CampaignLookup): Promise<MiniSessionAdminCampaign> => {
    const tenant = await resolveTenant(websiteSlug)
    const bundle = await getCampaignBundle(tenant, campaignId)
    return mapAdminCampaign(
        bundle.campaign,
        bundle.bookingOptions,
        bundle.heroMedia
    )
}

const getActiveCampaign = async (
    websiteSlug: string
): Promise<MiniSessionPublicCampaign | null> => {
    const tenant = await resolveTenant(websiteSlug)
    const { data, error } = await db
        .from(Tables.MINI_SESSION_CAMPAIGNS)
        .select(CAMPAIGN_SELECT)
        .eq('website_id', tenant.id)
        .eq('client_id', tenant.client_id)
        .in('status', ['live', 'sold_out'])
        .maybeSingle()

    if (error) throw error
    if (!data) return null

    const campaign = data as MiniSessionCampaignRow
    const [bookingOptions, heroMedia] = await Promise.all([
        getBookingOptions(tenant, campaign.id),
        getHeroMedia(tenant, campaign.hero_media_id),
    ])
    return mapPublicCampaign(campaign, bookingOptions, heroMedia)
}

const createCampaign = async ({
    websiteSlug,
    input,
    actor,
}: CreateCampaignInput): Promise<MiniSessionAdminCampaign> => {
    const parsed = parseMiniSessionCampaignInput(input)
    const tenant = await resolveTenant(websiteSlug)
    await assertHeroMediaTenant(tenant, parsed.heroMediaId)

    const { data, error } = await db
        .from(Tables.MINI_SESSION_CAMPAIGNS)
        .insert({
            website_id: tenant.id,
            client_id: tenant.client_id,
            status: 'draft',
            created_by: actor,
            ...toCampaignPayload(parsed, actor),
        })
        .select(CAMPAIGN_SELECT)
        .single()

    if (error) throw error
    const campaign = data as MiniSessionCampaignRow

    if (parsed.bookingOptions.length > 0) {
        const result = await db
            .from(Tables.MINI_SESSION_BOOKING_OPTIONS)
            .insert(toBookingOptionRows(parsed.bookingOptions, campaign))
        if (result.error) {
            await db
                .from(Tables.MINI_SESSION_CAMPAIGNS)
                .delete()
                .eq('id', campaign.id)
            throw result.error
        }
    }

    await miniSessionCampaignAudit.tryCreateLog({
        campaignId: campaign.id,
        websiteId: tenant.id,
        clientId: tenant.client_id,
        action: 'created',
        actor,
        newValues: {
            status: 'draft',
            internalName: parsed.internalName,
            bookingOptionCount: parsed.bookingOptions.length,
        },
    })

    const bundle = await getCampaignBundle(tenant, campaign.id)
    return mapAdminCampaign(
        bundle.campaign,
        bundle.bookingOptions,
        bundle.heroMedia
    )
}

const updateCampaign = async ({
    websiteSlug,
    campaignId,
    expectedUpdatedAt,
    actor,
    input,
}: UpdateCampaignInput): Promise<MiniSessionAdminCampaign> => {
    const parsed = parseMiniSessionCampaignInput(input)
    const tenant = await resolveTenant(websiteSlug)
    const existing = await getCampaignBundle(tenant, campaignId)
    await assertHeroMediaTenant(tenant, parsed.heroMediaId)

    const { data, error } = await db.rpc('save_mini_session_campaign', {
        p_campaign_id: campaignId,
        p_website_id: tenant.id,
        p_client_id: tenant.client_id,
        p_expected_updated_at: expectedUpdatedAt,
        p_actor: actor,
        p_campaign: parsed,
        p_booking_options: parsed.bookingOptions,
    })

    if (error) mapRpcError(error)
    const updated = (Array.isArray(data) ? data[0] : data) as
        | MiniSessionCampaignRow
        | undefined
    if (!updated) {
        throw new MiniSessionDomainError(
            'STALE_WRITE',
            'This campaign changed after it was loaded. Refresh before saving.'
        )
    }

    await miniSessionCampaignAudit.tryCreateLog({
        campaignId,
        websiteId: tenant.id,
        clientId: tenant.client_id,
        action: 'draft_saved',
        actor,
        oldValues: {
            internalName: existing.campaign.internal_name,
            updatedAt: existing.campaign.updated_at,
        },
        newValues: {
            internalName: parsed.internalName,
            updatedAt: updated.updated_at,
        },
    })

    if (
        JSON.stringify(existing.bookingOptions.map(option => ({
            label: option.label,
            description: option.description,
            dateTimeLabel: option.date_time_label,
            locationLabel: option.location_label,
            calBookingUrl: option.cal_booking_url,
            status: option.status,
            sortOrder: option.sort_order,
        }))) !== JSON.stringify(parsed.bookingOptions.map(({ id: _id, ...option }) => option))
    ) {
        await miniSessionCampaignAudit.tryCreateLog({
            campaignId,
            websiteId: tenant.id,
            clientId: tenant.client_id,
            action: 'booking_options_changed',
            actor,
            oldValues: { count: existing.bookingOptions.length },
            newValues: { count: parsed.bookingOptions.length },
        })
    }

    const bundle = await getCampaignBundle(tenant, campaignId)
    return mapAdminCampaign(
        bundle.campaign,
        bundle.bookingOptions,
        bundle.heroMedia
    )
}

const duplicateCampaign = async ({
    websiteSlug,
    campaignId,
    expectedUpdatedAt,
    actor,
}: CampaignMutation): Promise<MiniSessionAdminCampaign> => {
    const tenant = await resolveTenant(websiteSlug)
    const { data, error } = await db.rpc('duplicate_mini_session_campaign', {
        p_campaign_id: campaignId,
        p_website_id: tenant.id,
        p_client_id: tenant.client_id,
        p_expected_updated_at: expectedUpdatedAt,
        p_actor: actor,
    })

    if (error) mapRpcError(error)
    const duplicateId = data as string | null
    if (!duplicateId) throw new Error('Campaign duplication returned no id')

    await miniSessionCampaignAudit.tryCreateLog({
        campaignId: duplicateId,
        websiteId: tenant.id,
        clientId: tenant.client_id,
        action: 'duplicated',
        actor,
        oldValues: { sourceCampaignId: campaignId },
        newValues: { status: 'draft' },
    })

    const bundle = await getCampaignBundle(tenant, duplicateId)
    return mapAdminCampaign(
        bundle.campaign,
        bundle.bookingOptions,
        bundle.heroMedia
    )
}

const publishCampaign = async ({
    websiteSlug,
    campaignId,
    expectedUpdatedAt,
    actor,
}: CampaignMutation): Promise<MiniSessionAdminCampaign> => {
    const tenant = await resolveTenant(websiteSlug)
    const existing = await getCampaignBundle(tenant, campaignId)
    assertCampaignTransition(existing.campaign.status, 'live')
    assertCampaignReadyForPublication(existing)

    const { data, error } = await db.rpc('publish_mini_session_campaign', {
        p_campaign_id: campaignId,
        p_website_id: tenant.id,
        p_client_id: tenant.client_id,
        p_expected_updated_at: expectedUpdatedAt,
        p_actor: actor,
    })

    if (error) mapRpcError(error)
    if (!data) throw new Error('Campaign publication returned no campaign')

    await miniSessionCampaignAudit.tryCreateLog({
        campaignId,
        websiteId: tenant.id,
        clientId: tenant.client_id,
        action: 'published',
        actor,
        oldValues: { status: existing.campaign.status },
        newValues: { status: 'live' },
    })

    const bundle = await getCampaignBundle(tenant, campaignId)
    return mapAdminCampaign(
        bundle.campaign,
        bundle.bookingOptions,
        bundle.heroMedia
    )
}

const transitionCampaign = async (
    mutation: CampaignMutation,
    targetStatus: Exclude<MiniSessionCampaignStatus, 'draft' | 'live'>
): Promise<MiniSessionAdminCampaign> => {
    const tenant = await resolveTenant(mutation.websiteSlug)
    const existing = await getCampaignBundle(tenant, mutation.campaignId)
    assertCampaignTransition(existing.campaign.status, targetStatus)

    const { data, error } = await db
        .from(Tables.MINI_SESSION_CAMPAIGNS)
        .update({ status: targetStatus, updated_by: mutation.actor })
        .eq('id', mutation.campaignId)
        .eq('website_id', tenant.id)
        .eq('client_id', tenant.client_id)
        .eq('updated_at', mutation.expectedUpdatedAt)
        .select(CAMPAIGN_SELECT)
        .maybeSingle()

    if (error) throw error
    if (!data) {
        throw new MiniSessionDomainError(
            'STALE_WRITE',
            'This campaign changed after it was loaded. Refresh before continuing.'
        )
    }

    const action = {
        sold_out: 'marked_sold_out',
        closed: 'closed',
        archived: 'archived',
    }[targetStatus] as 'marked_sold_out' | 'closed' | 'archived'

    await miniSessionCampaignAudit.tryCreateLog({
        campaignId: mutation.campaignId,
        websiteId: tenant.id,
        clientId: tenant.client_id,
        action,
        actor: mutation.actor,
        oldValues: { status: existing.campaign.status },
        newValues: { status: targetStatus },
    })

    const bundle = await getCampaignBundle(tenant, mutation.campaignId)
    return mapAdminCampaign(
        bundle.campaign,
        bundle.bookingOptions,
        bundle.heroMedia
    )
}

export default {
    resolveTenant,
    listCampaigns,
    getCampaign,
    getActiveCampaign,
    createCampaign,
    updateCampaign,
    duplicateCampaign,
    publishCampaign,
    markCampaignSoldOut: (mutation: CampaignMutation) =>
        transitionCampaign(mutation, 'sold_out'),
    closeCampaign: (mutation: CampaignMutation) =>
        transitionCampaign(mutation, 'closed'),
    archiveCampaign: (mutation: CampaignMutation) =>
        transitionCampaign(mutation, 'archived'),
}
