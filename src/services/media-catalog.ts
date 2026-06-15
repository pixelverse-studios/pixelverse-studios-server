import { COLUMNS, db, Tables } from '../lib/db'
import {
    assertSafeFilename,
    assertSafeMediaKey,
    assertValidLibrary,
    assertValidAspectRatio,
    assertValidServiceSubCategory,
    assertValidSiteCategory,
    assertValidStatus,
    filenameFromKey,
    MEDIA_CATALOG_VERSION,
    MediaAspectRatio,
    MediaLibrary,
    MediaService,
    MediaSiteCategory,
    MediaStatus,
} from '../lib/media-catalog'
import { joinPublicUrl, MediaValidationError } from '../lib/media-r2'
import mediaAuditService, { MediaAuditAction } from './media-audit'
import {
    MediaRevalidationReason,
    tryTriggerMediaRevalidation,
} from './media-revalidation'

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

export interface MediaCatalogRecord {
    id: number
    website_id: string
    client_id: string
    key: string
    filename: string
    src: string
    alt: string
    library: MediaLibrary
    site_category: MediaSiteCategory | null
    service: MediaService | null
    sub_category: string | null
    aspect_ratio: MediaAspectRatio | null
    status: MediaStatus
    sort_order: number
    created_at: string
    updated_at: string
    archived_at: string | null
    archived_by: string | null
    archived_from_status: Exclude<MediaStatus, 'archived'> | null
}

type ArchivableMediaCatalogRecord = MediaCatalogRecord & {
    status: Exclude<MediaStatus, 'archived'>
}

export interface CatalogItemResponse {
    id: number
    key: string
    filename: string
    src: string
    alt: string
    library: MediaLibrary
    siteCategory: MediaSiteCategory | null
    service: MediaService | null
    subCategory: string | null
    aspectRatio: MediaAspectRatio | null
    status: MediaStatus
    sortOrder: number
    createdAt?: string
    updatedAt?: string
    archivedAt?: string | null
    archivedBy?: string | null
    archivedFromStatus?: Exclude<MediaStatus, 'archived'> | null
}

export interface CatalogResponse {
    version: 1
    publicBaseUrl: string
    bucket: string
    items: CatalogItemResponse[]
}

export interface CreateMediaItemInput {
    websiteSlug: string
    key: string
    filename?: string
    src?: string
    alt?: string
    library?: string | null
    siteCategory?: string | null
    service?: string | null
    subCategory?: string | null
    aspectRatio?: string | null
    sortOrder?: number
    actor?: string
}

export interface UpdateMediaItemInput {
    websiteSlug: string
    id: number
    key?: string
    filename?: string
    src?: string
    alt?: string
    library?: string | null
    siteCategory?: string | null
    service?: string | null
    subCategory?: string | null
    aspectRatio?: string | null
    sortOrder?: number
    status?: string
    actor?: string
}

export interface BatchUpdateMediaItemsInput {
    websiteSlug: string
    ids: number[]
    status: string
    actor?: string
}

interface BatchMediaItemError {
    code: string
    message: string
    status: number
    details?: Record<string, unknown>
}

export interface BatchMediaItemResult {
    id: number
    ok: boolean
    item?: CatalogItemResponse
    error?: BatchMediaItemError
}

export interface BatchUpdateMediaItemsResponse {
    items: BatchMediaItemResult[]
    summary: {
        requested: number
        succeeded: number
        failed: number
    }
}

export interface MediaCatalogDbObservation {
    operation: 'read_current_item' | 'update_item'
    durationMs: number
    ok: boolean
    latencyExceeded: boolean
    errorCode?: string
}

interface UpdateMediaItemOptions {
    triggerRevalidation?: boolean
    observeDb?: (observation: MediaCatalogDbObservation) => void
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

const toCatalogItemResponse = (
    item: MediaCatalogRecord,
    includeAdminFields: boolean
): CatalogItemResponse => ({
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
    status: item.status,
    sortOrder: item.sort_order,
    ...(includeAdminFields && {
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        archivedAt: item.archived_at,
        archivedBy: item.archived_by,
        archivedFromStatus: item.archived_from_status,
    }),
})

const buildCatalogResponse = ({
    config,
    records,
    includeAdminFields,
}: {
    config: ResolvedR2Config
    records: MediaCatalogRecord[]
    includeAdminFields: boolean
}): CatalogResponse => ({
    version: MEDIA_CATALOG_VERSION,
    publicBaseUrl: config.publicBaseUrl,
    bucket: config.bucket,
    items: records.map(item => toCatalogItemResponse(item, includeAdminFields)),
})

const listCatalog = async ({
    websiteSlug,
    includeAdminFields,
}: {
    websiteSlug: string
    includeAdminFields: boolean
}): Promise<CatalogResponse> => {
    const website = await getWebsiteOrThrow(websiteSlug)
    const config = await resolveR2Config(website)
    const query = db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .select('*')
        .eq('website_id', website.id)
        .order('service', { ascending: true, nullsFirst: false })
        .order('sub_category', { ascending: true, nullsFirst: false })
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true })

    if (!includeAdminFields) {
        query.eq('status', 'published')
        query.eq('library', 'portfolio')
    }

    const { data, error } = await query
    if (error) throw error

    return buildCatalogResponse({
        config,
        records: (data || []) as MediaCatalogRecord[],
        includeAdminFields,
    })
}

const assertNoDuplicateKey = async ({
    websiteId,
    key,
    excludeId,
}: {
    websiteId: string
    key: string
    excludeId?: number
}): Promise<void> => {
    let query = db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .select('id')
        .eq('website_id', websiteId)
        .eq('key', key)

    if (excludeId) {
        query = query.neq('id', excludeId)
    }

    const { data, error } = await query.maybeSingle()
    if (error) throw error

    if (data) throwDuplicateKeyError(key)
}

const isUniqueViolation = (error: unknown): boolean =>
    typeof (error as { code?: unknown })?.code === 'string' &&
    (error as { code: string }).code === '23505'

const throwDuplicateKeyError = (key: string): never => {
    throw new MediaValidationError(
        409,
        'media.duplicate_key',
        'A media catalog item already exists for this key.',
        { field: 'key', key }
    )
}

const assertPublishReady = ({
    alt,
    library,
    siteCategory,
    service,
    subCategory,
    aspectRatio,
}: {
    alt?: string | null
    library: MediaLibrary
    siteCategory?: string | null
    service?: string | null
    subCategory?: string | null
    aspectRatio?: string | null
}): void => {
    if (!alt?.trim()) {
        throw new MediaValidationError(
            400,
            'media.missing_alt_text',
            'Alt text is required before publishing media.',
            { field: 'alt' }
        )
    }

    if (library === 'site' && !siteCategory) {
        throw new MediaValidationError(
            400,
            'media.missing_site_category',
            'Site category is required before publishing site media.',
            { field: 'siteCategory' }
        )
    }

    if (library === 'portfolio' && !service) {
        throw new MediaValidationError(
            400,
            'media.missing_service',
            'Service is required before publishing media.',
            { field: 'service' }
        )
    }

    if (library === 'portfolio' && !subCategory) {
        throw new MediaValidationError(
            400,
            'media.missing_sub_category',
            'Sub-category is required before publishing media.',
            { field: 'subCategory' }
        )
    }

    if (!aspectRatio) {
        throw new MediaValidationError(
            400,
            'media.missing_aspect_ratio',
            'Aspect ratio is required before publishing media.',
            { field: 'aspectRatio' }
        )
    }
}

const buildValidatedDraftPayload = async ({
    website,
    config,
    input,
}: {
    website: WebsiteRecord
    config: ResolvedR2Config
    input: CreateMediaItemInput
}): Promise<Record<string, unknown>> => {
    assertSafeMediaKey(input.key)
    assertValidLibrary(input.library)

    const filename = input.filename || filenameFromKey(input.key)
    const library = (input.library || 'portfolio') as MediaLibrary
    const service = library === 'site' ? null : input.service
    const subCategory = library === 'site' ? null : input.subCategory
    const siteCategory = library === 'site' ? input.siteCategory : null

    assertSafeFilename(filename)
    assertValidSiteCategory(siteCategory)
    assertValidServiceSubCategory({
        service,
        subCategory,
    })
    assertValidAspectRatio(input.aspectRatio)
    await assertNoDuplicateKey({ websiteId: website.id, key: input.key })

    return {
        website_id: website.id,
        client_id: website.client_id,
        key: input.key,
        filename,
        src: input.src || joinPublicUrl(config.publicBaseUrl, input.key),
        alt: input.alt || '',
        library,
        site_category: siteCategory || null,
        service: service || null,
        sub_category: subCategory || null,
        aspect_ratio: input.aspectRatio || null,
        status: 'draft',
        sort_order: input.sortOrder ?? 0,
    }
}

const auditValuesForRecord = (
    item: MediaCatalogRecord
): Record<string, unknown> => ({
    key: item.key,
    filename: item.filename,
    src: item.src,
    alt: item.alt,
    library: item.library || 'portfolio',
    siteCategory: item.site_category,
    service: item.service,
    subCategory: item.sub_category,
    aspectRatio: item.aspect_ratio,
    status: item.status,
    sortOrder: item.sort_order,
    archivedAt: item.archived_at,
    archivedBy: item.archived_by,
    archivedFromStatus: item.archived_from_status,
})

const changedValues = ({
    oldValues,
    newValues,
}: {
    oldValues: Record<string, unknown>
    newValues: Record<string, unknown>
}): {
    oldChangedValues: Record<string, unknown>
    newChangedValues: Record<string, unknown>
} => {
    const oldChangedValues: Record<string, unknown> = {}
    const newChangedValues: Record<string, unknown> = {}

    Object.entries(newValues).forEach(([key, value]) => {
        if (oldValues[key] !== value) {
            oldChangedValues[key] = oldValues[key]
            newChangedValues[key] = value
        }
    })

    return { oldChangedValues, newChangedValues }
}

const changedValuesForFields = ({
    oldValues,
    newValues,
    fields,
}: {
    oldValues: Record<string, unknown>
    newValues: Record<string, unknown>
    fields: string[]
}): {
    oldChangedValues: Record<string, unknown>
    newChangedValues: Record<string, unknown>
} => {
    const oldChangedValues: Record<string, unknown> = {}
    const newChangedValues: Record<string, unknown> = {}

    fields.forEach(field => {
        if (oldValues[field] !== newValues[field]) {
            oldChangedValues[field] = oldValues[field]
            newChangedValues[field] = newValues[field]
        }
    })

    return { oldChangedValues, newChangedValues }
}

const hasChangedValues = (values: Record<string, unknown>): boolean =>
    Object.keys(values).length > 0

const mediaDbLatencyWarnMs = (): number => {
    const parsed = Number(process.env.MEDIA_DB_LATENCY_WARN_MS)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000
}

const supabaseErrorCode = (error: unknown): string | undefined => {
    const code = (error as { code?: unknown })?.code
    return typeof code === 'string' ? code : undefined
}

const buildAuditChange = ({
    action,
    oldValues,
    newValues,
    fields,
}: {
    action: MediaAuditAction
    oldValues: Record<string, unknown>
    newValues: Record<string, unknown>
    fields: string[]
}): {
    action: MediaAuditAction
    oldValues: Record<string, unknown>
    newValues: Record<string, unknown>
} | null => {
    const { oldChangedValues, newChangedValues } = changedValuesForFields({
        oldValues,
        newValues,
        fields,
    })

    if (!hasChangedValues(newChangedValues)) return null

    return {
        action,
        oldValues: oldChangedValues,
        newValues: newChangedValues,
    }
}

const determineUpdateAuditChanges = ({
    current,
    updated,
    oldValues,
    newValues,
}: {
    current: MediaCatalogRecord
    updated: MediaCatalogRecord
    oldValues: Record<string, unknown>
    newValues: Record<string, unknown>
}): Array<{
    action: MediaAuditAction
    oldValues: Record<string, unknown>
    newValues: Record<string, unknown>
}> => {
    const changes: Array<{
        action: MediaAuditAction
        oldValues: Record<string, unknown>
        newValues: Record<string, unknown>
    }> = []

    const locationChange = buildAuditChange({
        action: 'renamed_moved',
        oldValues,
        newValues,
        fields: ['key', 'filename', 'src'],
    })
    if (locationChange) changes.push(locationChange)

    if (current.status === 'archived' && updated.status !== 'archived') {
        const restoreChange = buildAuditChange({
            action: 'restored',
            oldValues,
            newValues,
            fields: ['status', 'archivedAt', 'archivedBy', 'archivedFromStatus'],
        })
        if (restoreChange) changes.push(restoreChange)
    }

    if (updated.status === 'archived' && current.status !== 'archived') {
        const archiveChange = buildAuditChange({
            action: 'archived',
            oldValues,
            newValues,
            fields: ['status', 'archivedAt', 'archivedBy', 'archivedFromStatus'],
        })
        if (archiveChange) changes.push(archiveChange)
    }

    if (updated.status === 'published' && current.status !== 'published') {
        const publishChange = buildAuditChange({
            action: 'published',
            oldValues,
            newValues,
            fields: ['status'],
        })
        if (publishChange) changes.push(publishChange)
    }

    const metadataChange = buildAuditChange({
        action: 'metadata_edited',
        oldValues,
        newValues,
        fields: [
            'alt',
            'library',
            'siteCategory',
            'service',
            'subCategory',
            'aspectRatio',
        ],
    })
    if (metadataChange) changes.push(metadataChange)

    const reorderChange = buildAuditChange({
        action: 'reorder_changed',
        oldValues,
        newValues,
        fields: ['sortOrder'],
    })
    if (reorderChange) changes.push(reorderChange)

    if (current.status === 'draft' && updated.status === 'draft') {
        const { oldChangedValues, newChangedValues } = changedValues({
            oldValues,
            newValues,
        })
        if (hasChangedValues(newChangedValues)) {
            changes.push({
                action: 'draft_saved',
                oldValues: oldChangedValues,
                newValues: newChangedValues,
            })
        }
    }

    return changes
}

const shouldRevalidatePublicCatalog = ({
    current,
    updated,
}: {
    current: MediaCatalogRecord
    updated: MediaCatalogRecord
}): boolean => current.status === 'published' || updated.status === 'published'

const revalidationReasonForChanges = (
    changes: Array<{ action: MediaAuditAction }>
): MediaRevalidationReason | null => {
    const publicReasonPriority: MediaRevalidationReason[] = [
        'restored',
        'published',
        'archived',
        'renamed_moved',
        'metadata_edited',
        'reorder_changed',
    ]

    return (
        publicReasonPriority.find(reason =>
            changes.some(change => change.action === reason)
        ) || null
    )
}

const queueAuditLog = (
    input: Parameters<typeof mediaAuditService.tryCreateLog>[0]
): void => {
    void mediaAuditService.tryCreateLog(input)
}

const createItem = async (
    input: CreateMediaItemInput
): Promise<CatalogItemResponse> => {
    const website = await getWebsiteOrThrow(input.websiteSlug)
    const config = await resolveR2Config(website)
    const payload = await buildValidatedDraftPayload({ website, config, input })

    const { data, error } = await db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .insert(payload)
        .select('*')
        .single()

    if (error) {
        if (isUniqueViolation(error)) throwDuplicateKeyError(input.key)
        throw error
    }

    const record = data as MediaCatalogRecord
    queueAuditLog({
        websiteId: website.id,
        clientId: website.client_id,
        mediaId: record.id,
        mediaKey: record.key,
        action: 'upload_created',
        actor: input.actor,
        oldValues: null,
        newValues: auditValuesForRecord(record),
    })

    return toCatalogItemResponse(record, true)
}

const getItemForWebsite = async ({
    websiteId,
    id,
    observeDb,
}: {
    websiteId: string
    id: number
    observeDb?: UpdateMediaItemOptions['observeDb']
}): Promise<MediaCatalogRecord | null> => {
    const startedAt = Date.now()
    const { data, error } = await db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .select('*')
        .eq('website_id', websiteId)
        .eq('id', id)
        .maybeSingle()
    const durationMs = Date.now() - startedAt

    observeDb?.({
        operation: 'read_current_item',
        durationMs,
        ok: !error,
        latencyExceeded: durationMs >= mediaDbLatencyWarnMs(),
        errorCode: supabaseErrorCode(error),
    })

    if (error) throw error
    return data as MediaCatalogRecord | null
}

const getItemsForWebsite = async ({
    websiteId,
    ids,
}: {
    websiteId: string
    ids: number[]
}): Promise<MediaCatalogRecord[]> => {
    const { data, error } = await db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .select('*')
        .eq('website_id', websiteId)
        .in('id', ids)

    if (error) throw error
    return (data || []) as MediaCatalogRecord[]
}

export interface UpdateMediaItemResult {
    item: CatalogItemResponse
    previousStatus: MediaStatus
    requestedStatus: MediaStatus | null
    revalidationReason: MediaRevalidationReason | null
}

const updateItemWithResult = async (
    input: UpdateMediaItemInput,
    options: UpdateMediaItemOptions = {}
): Promise<UpdateMediaItemResult> => {
    const shouldTriggerRevalidation = options.triggerRevalidation ?? true
    const website = await getWebsiteOrThrow(input.websiteSlug)
    const config = await resolveR2Config(website)
    const current = await getItemForWebsite({
        websiteId: website.id,
        id: input.id,
        observeDb: options.observeDb,
    })

    if (!current) {
        const err = new Error('Media catalog item not found') as Error & {
            status?: number
        }
        err.status = 404
        throw err
    }

    if (
        current.status === 'published' &&
        ((input.key !== undefined && input.key !== current.key) ||
            (input.src !== undefined && input.src !== current.src) ||
            (input.filename !== undefined && input.filename !== current.filename))
    ) {
        throw new MediaValidationError(
            409,
            'media.published_location_locked',
            'Published media object locations and filenames cannot be changed by metadata patch.',
            { fields: ['key', 'src', 'filename'], status: current.status }
        )
    }

    assertValidStatus(input.status)
    assertValidLibrary(input.library)

    const requestedStatus = input.status as MediaStatus | undefined
    const isArchivedRestore =
        current.status === 'archived' &&
        requestedStatus !== undefined &&
        requestedStatus !== 'archived'
    const includesMetadataEdit =
        input.key !== undefined ||
        input.filename !== undefined ||
        input.src !== undefined ||
        input.alt !== undefined ||
        input.library !== undefined ||
        input.siteCategory !== undefined ||
        input.service !== undefined ||
        input.subCategory !== undefined ||
        input.aspectRatio !== undefined ||
        input.sortOrder !== undefined

    if (current.status === 'archived' && !isArchivedRestore) {
        throw new MediaValidationError(
            409,
            'media.archived_locked',
            'Archived media cannot be edited until restored.',
            { status: current.status }
        )
    }

    if (isArchivedRestore && includesMetadataEdit) {
        throw new MediaValidationError(
            409,
            'media.archived_locked',
            'Restore archived media before editing metadata.',
            { status: current.status }
        )
    }

    const nextKey = input.key ?? current.key
    const nextFilename =
        input.filename ?? (input.key ? filenameFromKey(input.key) : current.filename)
    const nextLibrary = (input.library === undefined || input.library === null
        ? current.library || 'portfolio'
        : input.library) as MediaLibrary
    const rawNextService =
        input.service === undefined ? current.service : input.service
    const rawNextSubCategory =
        input.subCategory === undefined ? current.sub_category : input.subCategory
    const rawNextSiteCategory =
        input.siteCategory === undefined
            ? current.site_category
            : input.siteCategory
    const nextService = nextLibrary === 'site' ? null : rawNextService
    const nextSubCategory = nextLibrary === 'site' ? null : rawNextSubCategory
    const nextSiteCategory =
        nextLibrary === 'site' ? rawNextSiteCategory : null
    const nextAspectRatio =
        input.aspectRatio === undefined
            ? current.aspect_ratio
            : input.aspectRatio
    const nextStatus =
        isArchivedRestore && current.archived_from_status
            ? current.archived_from_status
            : ((input.status ?? current.status) as MediaStatus)

    assertSafeMediaKey(nextKey)
    assertSafeFilename(nextFilename)
    assertValidSiteCategory(nextSiteCategory)
    assertValidServiceSubCategory({
        service: nextService,
        subCategory: nextSubCategory,
    })
    assertValidAspectRatio(nextAspectRatio)

    if (nextKey !== current.key) {
        await assertNoDuplicateKey({
            websiteId: website.id,
            key: nextKey,
            excludeId: input.id,
        })
    }

    const patch: Record<string, unknown> = {
        key: nextKey,
        filename: nextFilename,
        src:
            input.src ??
            (nextKey !== current.key
                ? joinPublicUrl(config.publicBaseUrl, nextKey)
                : current.src),
        alt: input.alt ?? current.alt,
        library: nextLibrary,
        site_category: nextSiteCategory || null,
        service: nextService || null,
        sub_category: nextSubCategory || null,
        aspect_ratio: nextAspectRatio || null,
        sort_order: input.sortOrder ?? current.sort_order,
    }

    if (nextStatus === 'published') {
        assertPublishReady({
            alt: patch.alt as string | null,
            library: nextLibrary,
            siteCategory: patch.site_category as string | null,
            service: patch.service as string | null,
            subCategory: patch.sub_category as string | null,
            aspectRatio: patch.aspect_ratio as string | null,
        })
    }

    if (nextStatus === 'archived') {
        if (current.status === 'archived') {
            throw new MediaValidationError(
                409,
                'media.invalid_status_transition',
                'Media is already archived.',
                { from: current.status, to: nextStatus }
            )
        }

        patch.status = 'archived'
        patch.archived_at = new Date().toISOString()
        patch.archived_by = input.actor || null
        patch.archived_from_status = current.status
    } else if (current.status === 'archived') {
        patch.status = nextStatus
        patch.archived_at = null
        patch.archived_by = null
        patch.archived_from_status = null
    } else if (nextStatus !== current.status) {
        patch.status = nextStatus
        patch.archived_at = null
        patch.archived_by = null
        patch.archived_from_status = null
    }

    const updateStartedAt = Date.now()
    const { data, error } = await db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .update(patch)
        .eq('website_id', website.id)
        .eq('id', input.id)
        .select('*')
        .single()
    const updateDurationMs = Date.now() - updateStartedAt

    options.observeDb?.({
        operation: 'update_item',
        durationMs: updateDurationMs,
        ok: !error,
        latencyExceeded: updateDurationMs >= mediaDbLatencyWarnMs(),
        errorCode: supabaseErrorCode(error),
    })

    if (error) {
        if (isUniqueViolation(error)) throwDuplicateKeyError(nextKey)
        throw error
    }

    const updated = data as MediaCatalogRecord
    const oldValues = auditValuesForRecord(current)
    const newValues = auditValuesForRecord(updated)
    const auditChanges = determineUpdateAuditChanges({
        current,
        updated,
        oldValues,
        newValues,
    })

    auditChanges.forEach(change => {
        queueAuditLog({
            websiteId: website.id,
            clientId: website.client_id,
            mediaId: updated.id,
            mediaKey: updated.key,
            action: change.action,
            actor: input.actor,
            oldValues: change.oldValues,
            newValues: change.newValues,
        })
    })

    const revalidationReason = revalidationReasonForChanges(auditChanges)
    if (
        revalidationReason &&
        shouldRevalidatePublicCatalog({ current, updated }) &&
        shouldTriggerRevalidation
    ) {
        tryTriggerMediaRevalidation({
            websiteSlug: input.websiteSlug,
            reason: revalidationReason,
            mediaId: updated.id,
            mediaKey: updated.key,
            actor: input.actor,
        })
    }

    return {
        item: toCatalogItemResponse(updated, true),
        previousStatus: current.status,
        requestedStatus: requestedStatus || null,
        revalidationReason:
            revalidationReason &&
            shouldRevalidatePublicCatalog({ current, updated })
                ? revalidationReason
                : null,
    }
}

const updateItem = async (
    input: UpdateMediaItemInput
): Promise<CatalogItemResponse> => {
    const result = await updateItemWithResult(input)
    return result.item
}

const batchRevalidationReason = (
    reasons: MediaRevalidationReason[]
): MediaRevalidationReason | null => {
    const publicReasonPriority: MediaRevalidationReason[] = [
        'restored',
        'published',
        'archived',
        'renamed_moved',
        'metadata_edited',
        'reorder_changed',
    ]

    return (
        publicReasonPriority.find(reason => reasons.includes(reason)) || null
    )
}

const bulkArchiveItems = async ({
    websiteId,
    records,
    actor,
    archivedAt,
}: {
    websiteId: string
    records: ArchivableMediaCatalogRecord[]
    actor?: string
    archivedAt: string
}): Promise<MediaCatalogRecord[]> => {
    const statusGroups = records.reduce(
        (groups, record) => {
            const group = groups.get(record.status) || []
            group.push(record.id)
            groups.set(record.status, group)
            return groups
        },
        new Map<Exclude<MediaStatus, 'archived'>, number[]>()
    )
    const updatedRecords: MediaCatalogRecord[] = []

    for (const [archivedFromStatus, ids] of statusGroups.entries()) {
        const { data, error } = await db
            .from(Tables.MEDIA_CATALOG_ITEMS)
            .update({
                status: 'archived',
                archived_at: archivedAt,
                archived_by: actor || null,
                archived_from_status: archivedFromStatus,
            })
            .eq('website_id', websiteId)
            .in('id', ids)
            .select('*')

        if (error) throw error
        updatedRecords.push(...((data || []) as MediaCatalogRecord[]))
    }

    return updatedRecords
}

const mediaNotFoundBatchError = (): BatchMediaItemError => ({
    status: 404,
    code: 'media.not_found',
    message: 'Media catalog item not found',
})

const archivedLockedBatchError = (): BatchMediaItemError => ({
    status: 409,
    code: 'media.archived_locked',
    message: 'Archived media cannot be edited until restored.',
    details: { status: 'archived' },
})

const batchUpdateItems = async (
    input: BatchUpdateMediaItemsInput
): Promise<BatchUpdateMediaItemsResponse> => {
    if (input.status !== 'archived') {
        throw new MediaValidationError(
            400,
            'media.invalid_status',
            'Batch media updates only support archived status.',
            { status: input.status }
        )
    }

    const uniqueIds = [...new Set(input.ids)]
    const startedAt = Date.now()
    const website = await getWebsiteOrThrow(input.websiteSlug)
    const currentRecords = await getItemsForWebsite({
        websiteId: website.id,
        ids: uniqueIds,
    })
    const currentById = new Map(
        currentRecords.map(record => [record.id, record])
    )
    const eligibleRecords: ArchivableMediaCatalogRecord[] = []
    uniqueIds.forEach(id => {
        const record = currentById.get(id)
        if (record && record.status !== 'archived') {
            eligibleRecords.push(record as ArchivableMediaCatalogRecord)
        }
    })

    const archivedAt = new Date().toISOString()
    const updatedRecords =
        eligibleRecords.length > 0
            ? await bulkArchiveItems({
                  websiteId: website.id,
                  records: eligibleRecords,
                  actor: input.actor,
                  archivedAt,
              })
            : []
    const updatedById = new Map(
        updatedRecords.map(record => [record.id, record])
    )
    const items: BatchMediaItemResult[] = []
    const revalidationReasons: MediaRevalidationReason[] = []

    uniqueIds.forEach(id => {
        const current = currentById.get(id)
        if (!current) {
            items.push({
                id,
                ok: false,
                error: mediaNotFoundBatchError(),
            })
            return
        }

        if (current.status === 'archived') {
            items.push({
                id,
                ok: false,
                error: archivedLockedBatchError(),
            })
            return
        }

        const updated = updatedById.get(id)
        if (!updated) {
            items.push({
                id,
                ok: false,
                error: {
                    status: 500,
                    code: 'media.update_failed',
                    message: 'Media archive update did not return the updated item.',
                },
            })
            return
        }

        const oldValues = auditValuesForRecord(current)
        const newValues = auditValuesForRecord(updated)
        const auditChanges = determineUpdateAuditChanges({
            current,
            updated,
            oldValues,
            newValues,
        })

        auditChanges.forEach(change => {
            queueAuditLog({
                websiteId: website.id,
                clientId: website.client_id,
                mediaId: updated.id,
                mediaKey: updated.key,
                action: change.action,
                actor: input.actor,
                oldValues: change.oldValues,
                newValues: change.newValues,
            })
        })

        const revalidationReason = revalidationReasonForChanges(auditChanges)
        if (
            revalidationReason &&
            shouldRevalidatePublicCatalog({ current, updated })
        ) {
            revalidationReasons.push(revalidationReason)
        }

        items.push({
            id,
            ok: true,
            item: toCatalogItemResponse(updated, true),
        })
    })

    const revalidationReason = batchRevalidationReason(revalidationReasons)
    if (revalidationReason) {
        tryTriggerMediaRevalidation({
            websiteSlug: input.websiteSlug,
            reason: revalidationReason,
            actor: input.actor,
        })
    }

    const succeeded = items.filter(item => item.ok).length
    console.info('Media catalog batch archive service completed', {
        websiteSlug: input.websiteSlug,
        requested: input.ids.length,
        processed: uniqueIds.length,
        fetched: currentRecords.length,
        eligible: eligibleRecords.length,
        succeeded,
        failed: uniqueIds.length - succeeded,
        durationMs: Date.now() - startedAt,
    })

    return {
        items,
        summary: {
            requested: uniqueIds.length,
            succeeded,
            failed: uniqueIds.length - succeeded,
        },
    }
}

export default {
    listCatalog,
    createItem,
    updateItem,
    updateItemWithResult,
    batchUpdateItems,
}
