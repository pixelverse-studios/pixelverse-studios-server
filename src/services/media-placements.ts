import { COLUMNS, db, Tables } from '../lib/db'
import {
    MEDIA_PLACEMENTS_VERSION,
    MediaPlacementSlot,
    assertValidMediaPlacementSlot,
    getMediaPlacementSlotsForWebsite,
} from '../lib/media-placements'
import type {
    CatalogItemResponse,
    MediaCatalogRecord,
} from './media-catalog'
import { normalizeCropPosition } from '../lib/media-catalog'
import { MediaValidationError } from '../lib/media-r2'
import mediaAuditService from './media-audit'
import { tryTriggerMediaRevalidation } from './media-revalidation'

interface WebsiteRecord {
    id: string
    client_id: string
}

interface R2ConfigRecord {
    bucket: string
    public_base_url: string
    key_prefix: string | null
}

interface ResolvedR2Config {
    bucket: string
    publicBaseUrl: string
}

interface MediaPlacementRecord {
    id: number
    website_id: string
    client_id: string
    slot_key: string
    media_id: number
    updated_by: string | null
    created_at: string
    updated_at: string
}

type PlacementAuditAction =
    | 'placement_assigned'
    | 'placement_replaced'
    | 'placement_cleared'

export interface PlacementMediaResponse
    extends Omit<CatalogItemResponse, 'sortOrder'> {}

export interface PublicPlacementResponse {
    slotKey: string
    media: PlacementMediaResponse
}

export interface PublicPlacementsResponse {
    version: 1
    publicBaseUrl: string
    placements: PublicPlacementResponse[]
}

export interface AdminPlacementSlotResponse {
    slotKey: string
    pageLabel: string
    sectionLabel: string
    description: string
    expectedAspectRatios?: string[]
    affectedPaths: string[]
    assignment: {
        id: number
        media: PlacementMediaResponse
        updatedBy: string | null
        createdAt: string
        updatedAt: string
    } | null
}

export interface AdminPlacementsResponse {
    version: 1
    publicBaseUrl: string
    slots: AdminPlacementSlotResponse[]
}

export interface AssignPlacementInput {
    websiteSlug: string
    slotKey: string
    mediaId: number
    actor?: string
}

export interface ClearPlacementInput {
    websiteSlug: string
    slotKey: string
    actor?: string
}

const getWebsiteBySlug = async (
    websiteSlug: string
): Promise<WebsiteRecord | null> => {
    const { data, error } = await db
        .from(Tables.WEBSITES)
        .select('id, client_id')
        .eq(COLUMNS.WEBSITE_SLUG, websiteSlug)
        .maybeSingle()

    if (error) throw error
    return data as WebsiteRecord | null
}

const getWebsiteOrThrow = async (websiteSlug: string): Promise<WebsiteRecord> => {
    const website = await getWebsiteBySlug(websiteSlug)
    if (!website) {
        const err = new Error('Website not found') as Error & { status?: number }
        err.status = 404
        throw err
    }

    return website
}

const getWebsiteR2Config = async (
    website: WebsiteRecord
): Promise<R2ConfigRecord | null> => {
    const { data: websiteConfig, error: websiteError } = await db
        .from(Tables.MEDIA_R2_CONFIGS)
        .select('bucket, public_base_url, key_prefix')
        .eq('website_id', website.id)
        .maybeSingle()

    if (websiteError) throw websiteError
    if (websiteConfig) return websiteConfig as R2ConfigRecord

    const { data: clientConfig, error: clientError } = await db
        .from(Tables.MEDIA_R2_CONFIGS)
        .select('bucket, public_base_url, key_prefix')
        .eq('client_id', website.client_id)
        .is('website_id', null)
        .maybeSingle()

    if (clientError) throw clientError
    return clientConfig as R2ConfigRecord | null
}

const resolveR2Config = async (
    website: WebsiteRecord
): Promise<ResolvedR2Config> => {
    const persistedConfig = await getWebsiteR2Config(website)
    const bucket = persistedConfig?.bucket || process.env.R2_BUCKET_NAME
    const publicBaseUrl =
        persistedConfig?.public_base_url || process.env.R2_PUBLIC_BASE_URL

    if (!bucket || !publicBaseUrl) {
        const err = new Error('R2 media configuration is not available') as Error & {
            status?: number
        }
        err.status = 503
        throw err
    }

    return { bucket, publicBaseUrl }
}

const toPlacementMediaResponse = (
    item: MediaCatalogRecord
): PlacementMediaResponse => ({
    id: item.id,
    key: item.key,
    filename: item.filename,
    src: item.src,
    alt: item.alt,
    library: item.library || 'portfolio',
    siteCategory: item.site_category || null,
    service: item.service,
    subCategory: item.sub_category,
    aspectRatio: item.aspect_ratio,
    aspect_ratio: item.aspect_ratio,
    cropPosition: normalizeCropPosition(item.crop_position),
    status: item.status,
})

const listPlacementRecords = async (
    websiteId: string
): Promise<MediaPlacementRecord[]> => {
    const { data, error } = await db
        .from(Tables.MEDIA_PLACEMENTS)
        .select('*')
        .eq('website_id', websiteId)
        .order('slot_key', { ascending: true })

    if (error) throw error
    return (data || []) as MediaPlacementRecord[]
}

const getPlacementRecord = async ({
    websiteId,
    slotKey,
}: {
    websiteId: string
    slotKey: string
}): Promise<MediaPlacementRecord | null> => {
    const { data, error } = await db
        .from(Tables.MEDIA_PLACEMENTS)
        .select('*')
        .eq('website_id', websiteId)
        .eq('slot_key', slotKey)
        .maybeSingle()

    if (error) throw error
    return data as MediaPlacementRecord | null
}

const listMediaByIds = async ({
    websiteId,
    ids,
}: {
    websiteId: string
    ids: number[]
}): Promise<MediaCatalogRecord[]> => {
    if (ids.length === 0) return []

    const { data, error } = await db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .select('*')
        .eq('website_id', websiteId)
        .in('id', ids)

    if (error) throw error
    return (data || []) as MediaCatalogRecord[]
}

const getMediaForWebsite = async ({
    websiteId,
    mediaId,
}: {
    websiteId: string
    mediaId: number
}): Promise<MediaCatalogRecord | null> => {
    const { data, error } = await db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .select('*')
        .eq('website_id', websiteId)
        .eq('id', mediaId)
        .maybeSingle()

    if (error) throw error
    return data as MediaCatalogRecord | null
}

const mediaById = (
    items: MediaCatalogRecord[]
): Map<number, MediaCatalogRecord> =>
    new Map(items.map(item => [item.id, item]))

const auditValuesForPlacement = ({
    slotKey,
    placement,
    media,
}: {
    slotKey: string
    placement?: MediaPlacementRecord | null
    media?: MediaCatalogRecord | null
}): Record<string, unknown> => ({
    slotKey,
    placementId: placement?.id ?? null,
    mediaId: media?.id ?? placement?.media_id ?? null,
    mediaKey: media?.key ?? null,
    src: media?.src ?? null,
    filename: media?.filename ?? null,
    alt: media?.alt ?? null,
    library: media?.library ?? null,
    siteCategory: media?.site_category ?? null,
    service: media?.service ?? null,
    subCategory: media?.sub_category ?? null,
    aspectRatio: media?.aspect_ratio ?? null,
    cropPosition: media ? normalizeCropPosition(media.crop_position) : null,
    status: media?.status ?? null,
    updatedBy: placement?.updated_by ?? null,
})

const queueAuditLog = (
    input: Parameters<typeof mediaAuditService.tryCreateLog>[0]
): void => {
    void mediaAuditService.tryCreateLog(input)
}

const queuePlacementAuditAndRevalidation = ({
    websiteSlug,
    website,
    slot,
    action,
    actor,
    oldValues,
    newValues,
    media,
}: {
    websiteSlug: string
    website: WebsiteRecord
    slot: MediaPlacementSlot
    action: PlacementAuditAction
    actor?: string
    oldValues: Record<string, unknown> | null
    newValues: Record<string, unknown> | null
    media?: MediaCatalogRecord | null
}): void => {
    queueAuditLog({
        websiteId: website.id,
        clientId: website.client_id,
        mediaId: media?.id ?? null,
        mediaKey: media?.key ?? null,
        action,
        actor,
        oldValues,
        newValues,
    })

    tryTriggerMediaRevalidation({
        websiteSlug,
        reason: action,
        mediaId: media?.id,
        mediaKey: media?.key,
        actor,
        affectedPaths: slot.affectedPaths,
    })
}

const assignmentForSlot = ({
    slot,
    placement,
    media,
}: {
    slot: MediaPlacementSlot
    placement?: MediaPlacementRecord
    media?: MediaCatalogRecord
}): AdminPlacementSlotResponse => ({
    slotKey: slot.key,
    pageLabel: slot.pageLabel,
    sectionLabel: slot.sectionLabel,
    description: slot.description,
    ...(slot.expectedAspectRatios && {
        expectedAspectRatios: [...slot.expectedAspectRatios],
    }),
    affectedPaths: [...slot.affectedPaths],
    assignment:
        placement && media
            ? {
                  id: placement.id,
                  media: toPlacementMediaResponse(media),
                  updatedBy: placement.updated_by,
                  createdAt: placement.created_at,
                  updatedAt: placement.updated_at,
              }
            : null,
})

const listPublicPlacements = async ({
    websiteSlug,
}: {
    websiteSlug: string
}): Promise<PublicPlacementsResponse> => {
    const website = await getWebsiteOrThrow(websiteSlug)
    const config = await resolveR2Config(website)
    const allowedSlotKeys = new Set(
        getMediaPlacementSlotsForWebsite(websiteSlug).map(slot => slot.key)
    )
    const placements = (await listPlacementRecords(website.id)).filter(
        placement => allowedSlotKeys.has(placement.slot_key)
    )
    const mediaMap = mediaById(
        await listMediaByIds({
            websiteId: website.id,
            ids: placements.map(placement => placement.media_id),
        })
    )

    return {
        version: MEDIA_PLACEMENTS_VERSION,
        publicBaseUrl: config.publicBaseUrl,
        placements: placements
            .map(placement => {
                const media = mediaMap.get(placement.media_id)
                if (!media || media.status !== 'published') return null

                return {
                    slotKey: placement.slot_key,
                    media: toPlacementMediaResponse(media),
                }
            })
            .filter(
                (placement): placement is PublicPlacementResponse =>
                    placement !== null
            ),
    }
}

const listAdminPlacements = async ({
    websiteSlug,
}: {
    websiteSlug: string
}): Promise<AdminPlacementsResponse> => {
    const website = await getWebsiteOrThrow(websiteSlug)
    const config = await resolveR2Config(website)
    const slots = getMediaPlacementSlotsForWebsite(websiteSlug)
    const placements = await listPlacementRecords(website.id)
    const mediaMap = mediaById(
        await listMediaByIds({
            websiteId: website.id,
            ids: placements.map(placement => placement.media_id),
        })
    )
    const placementMap = new Map(
        placements.map(placement => [placement.slot_key, placement])
    )

    return {
        version: MEDIA_PLACEMENTS_VERSION,
        publicBaseUrl: config.publicBaseUrl,
        slots: slots.map(slot =>
            assignmentForSlot({
                slot,
                placement: placementMap.get(slot.key),
                media: placementMap.get(slot.key)
                    ? mediaMap.get(placementMap.get(slot.key)?.media_id || 0)
                    : undefined,
            })
        ),
    }
}

const assertAssignableMedia = (media: MediaCatalogRecord | null): void => {
    if (!media) {
        const err = new Error('Media catalog item not found') as Error & {
            status?: number
        }
        err.status = 404
        throw err
    }

    if (media.status === 'archived') {
        throw new MediaValidationError(
            409,
            'media.archived_assignment_forbidden',
            'Archived media cannot be assigned to a placement.',
            { mediaId: media.id, status: media.status }
        )
    }

    if (media.status !== 'published') {
        throw new MediaValidationError(
            409,
            'media.unpublished_assignment_forbidden',
            'Only published media can be assigned to placements.',
            { mediaId: media.id, status: media.status }
        )
    }
}

const upsertPlacement = async ({
    website,
    slotKey,
    mediaId,
    actor,
    current,
}: {
    website: WebsiteRecord
    slotKey: string
    mediaId: number
    actor?: string
    current: MediaPlacementRecord | null
}): Promise<MediaPlacementRecord> => {
    const payload = {
        website_id: website.id,
        client_id: website.client_id,
        slot_key: slotKey,
        media_id: mediaId,
        updated_by: actor || null,
    }

    const query = current
        ? db
              .from(Tables.MEDIA_PLACEMENTS)
              .update(payload)
              .eq('id', current.id)
        : db.from(Tables.MEDIA_PLACEMENTS).insert(payload)

    const { data, error } = await query.select('*').single()

    if (error) throw error
    return data as MediaPlacementRecord
}

const assignPlacement = async (
    input: AssignPlacementInput
): Promise<AdminPlacementSlotResponse> => {
    const slot = assertValidMediaPlacementSlot({
        websiteSlug: input.websiteSlug,
        slotKey: input.slotKey,
    })
    const website = await getWebsiteOrThrow(input.websiteSlug)
    const media = await getMediaForWebsite({
        websiteId: website.id,
        mediaId: input.mediaId,
    })
    assertAssignableMedia(media)

    const current = await getPlacementRecord({
        websiteId: website.id,
        slotKey: input.slotKey,
    })
    const previousMedia =
        current && current.media_id !== media?.id
            ? await getMediaForWebsite({
                  websiteId: website.id,
                  mediaId: current.media_id,
              })
            : null
    const placement = await upsertPlacement({
        website,
        slotKey: input.slotKey,
        mediaId: input.mediaId,
        actor: input.actor,
        current,
    })
    const placementAction: PlacementAuditAction | null = !current
        ? 'placement_assigned'
        : current.media_id !== input.mediaId
          ? 'placement_replaced'
          : null

    if (placementAction) {
        queuePlacementAuditAndRevalidation({
            websiteSlug: input.websiteSlug,
            website,
            slot,
            action: placementAction,
            actor: input.actor,
            oldValues: current
                ? auditValuesForPlacement({
                      slotKey: input.slotKey,
                      placement: current,
                      media: previousMedia,
                  })
                : null,
            newValues: auditValuesForPlacement({
                slotKey: input.slotKey,
                placement,
                media,
            }),
            media,
        })
    }

    return assignmentForSlot({
        slot,
        placement,
        media: media as MediaCatalogRecord,
    })
}

const clearPlacement = async (
    input: ClearPlacementInput
): Promise<{ cleared: boolean; slotKey: string }> => {
    const slot = assertValidMediaPlacementSlot({
        websiteSlug: input.websiteSlug,
        slotKey: input.slotKey,
    })
    const website = await getWebsiteOrThrow(input.websiteSlug)
    const current = await getPlacementRecord({
        websiteId: website.id,
        slotKey: input.slotKey,
    })

    if (!current) {
        return { cleared: false, slotKey: input.slotKey }
    }

    const previousMedia = await getMediaForWebsite({
        websiteId: website.id,
        mediaId: current.media_id,
    })

    const { error } = await db
        .from(Tables.MEDIA_PLACEMENTS)
        .delete()
        .eq('id', current.id)

    if (error) throw error
    queuePlacementAuditAndRevalidation({
        websiteSlug: input.websiteSlug,
        website,
        slot,
        action: 'placement_cleared',
        actor: input.actor,
        oldValues: auditValuesForPlacement({
            slotKey: input.slotKey,
            placement: current,
            media: previousMedia,
        }),
        newValues: null,
        media: previousMedia,
    })

    return { cleared: true, slotKey: input.slotKey }
}

export default {
    listPublicPlacements,
    listAdminPlacements,
    assignPlacement,
    clearPlacement,
}
