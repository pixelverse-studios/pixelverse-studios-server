import { COLUMNS, db, Tables } from '../lib/db'
import {
    assertSafeFilename,
    assertSafeMediaKey,
    assertValidAspectRatio,
    assertValidServiceSubCategory,
    filenameFromKey,
    MEDIA_CATALOG_VERSION,
    MediaAspectRatio,
    MediaService,
    MediaStatus,
} from '../lib/media-catalog'
import { joinPublicUrl, MediaValidationError } from '../lib/media-r2'

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

export interface CatalogItemResponse {
    id: number
    key: string
    filename: string
    src: string
    alt: string
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
    service?: string | null
    subCategory?: string | null
    aspectRatio?: string | null
    sortOrder?: number
}

export interface UpdateMediaItemInput {
    websiteSlug: string
    id: number
    key?: string
    filename?: string
    src?: string
    alt?: string
    service?: string | null
    subCategory?: string | null
    aspectRatio?: string | null
    sortOrder?: number
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

    const filename = input.filename || filenameFromKey(input.key)
    assertSafeFilename(filename)
    assertValidServiceSubCategory({
        service: input.service,
        subCategory: input.subCategory,
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
        service: input.service || null,
        sub_category: input.subCategory || null,
        aspect_ratio: input.aspectRatio || null,
        status: 'draft',
        sort_order: input.sortOrder ?? 0,
    }
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
    return toCatalogItemResponse(data as MediaCatalogRecord, true)
}

const getItemForWebsite = async ({
    websiteId,
    id,
}: {
    websiteId: string
    id: number
}): Promise<MediaCatalogRecord | null> => {
    const { data, error } = await db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .select('*')
        .eq('website_id', websiteId)
        .eq('id', id)
        .maybeSingle()

    if (error) throw error
    return data as MediaCatalogRecord | null
}

const updateItem = async (
    input: UpdateMediaItemInput
): Promise<CatalogItemResponse> => {
    const website = await getWebsiteOrThrow(input.websiteSlug)
    const config = await resolveR2Config(website)
    const current = await getItemForWebsite({ websiteId: website.id, id: input.id })

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
            (input.src !== undefined && input.src !== current.src))
    ) {
        throw new MediaValidationError(
            409,
            'media.published_location_locked',
            'Published media object locations cannot be changed by metadata patch.',
            { fields: ['key', 'src'], status: current.status }
        )
    }

    const nextKey = input.key ?? current.key
    const nextFilename =
        input.filename ?? (input.key ? filenameFromKey(input.key) : current.filename)
    const nextService =
        input.service === undefined ? current.service : input.service
    const nextSubCategory =
        input.subCategory === undefined
            ? current.sub_category
            : input.subCategory
    const nextAspectRatio =
        input.aspectRatio === undefined
            ? current.aspect_ratio
            : input.aspectRatio

    assertSafeMediaKey(nextKey)
    assertSafeFilename(nextFilename)
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
        service: nextService || null,
        sub_category: nextSubCategory || null,
        aspect_ratio: nextAspectRatio || null,
        sort_order: input.sortOrder ?? current.sort_order,
    }

    const { data, error } = await db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .update(patch)
        .eq('website_id', website.id)
        .eq('id', input.id)
        .select('*')
        .single()

    if (error) {
        if (isUniqueViolation(error)) throwDuplicateKeyError(nextKey)
        throw error
    }
    return toCatalogItemResponse(data as MediaCatalogRecord, true)
}

export default {
    listCatalog,
    createItem,
    updateItem,
}
