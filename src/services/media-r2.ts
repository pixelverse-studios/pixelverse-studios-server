import {
    CopyObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { COLUMNS, db, Tables } from '../lib/db'
import {
    assertSafeFilename,
    assertSafeMediaKey,
    filenameFromKey,
} from '../lib/media-catalog'
import {
    buildR2ObjectKey,
    joinPublicUrl,
    presignExpiresSeconds,
    validateUploadInput,
    MediaValidationError,
} from '../lib/media-r2'
import mediaCatalogService, {
    CatalogItemResponse,
    MediaCatalogRecord,
} from './media-catalog'

export interface PresignUploadInput {
    websiteSlug: string
    filename: string
    contentType: string
    folder?: string
    size: number
}

export interface PresignUploadResult {
    presigned_url: string
    public_url: string
    r2_key: string
    expires_at: string
}

export interface R2ObjectSummary {
    key: string
    public_url: string
    size: number
    last_modified?: string
    etag?: string
}

export interface ListObjectsInput {
    websiteSlug: string
    prefix?: string
}

export interface ListObjectsResult {
    bucket: string
    prefix: string
    objects: R2ObjectSummary[]
}

export interface CheckDestinationInput {
    websiteSlug: string
    destinationKey: string
    excludeMediaId?: number
}

export interface CheckDestinationResult {
    destination_key: string
    catalog_exists: boolean
    r2_exists: boolean
    available: boolean
}

export interface MoveCatalogItemInput {
    websiteSlug: string
    id: number
    destinationKey: string
}

export interface MoveCatalogItemResult {
    item: CatalogItemResponse
    source_key: string
    destination_key: string
    source_deleted: boolean
}

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
    keyPrefix: string
}

interface CatalogKeyRecord {
    id: number
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
    const keyPrefix = persistedConfig?.key_prefix || ''

    if (!bucket || !publicBaseUrl) {
        const err = new Error('R2 media configuration is not available') as Error & {
            status?: number
        }
        err.status = 503
        throw err
    }

    return { bucket, publicBaseUrl, keyPrefix }
}

const createR2Client = (): S3Client => {
    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
    const accountId = process.env.R2_ACCOUNT_ID

    if (!accessKeyId || !secretAccessKey || !accountId) {
        const err = new Error('R2 credentials are not configured') as Error & {
            status?: number
        }
        err.status = 503
        throw err
    }

    return new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    })
}

const normalizePrefix = (prefix?: string): string => {
    if (!prefix) return ''
    const normalized = prefix.trim().replace(/^\/+|\/+$/g, '')
    if (!normalized) return ''

    assertSafeMediaKey(normalized)
    return normalized
}

const assertDestinationKey = (key: string): void => {
    assertSafeMediaKey(key)
    assertSafeFilename(filenameFromKey(key))
}

const catalogKeyExists = async ({
    websiteId,
    key,
    excludeMediaId,
}: {
    websiteId: string
    key: string
    excludeMediaId?: number
}): Promise<boolean> => {
    let query = db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .select('id')
        .eq('website_id', websiteId)
        .eq('key', key)

    if (excludeMediaId) {
        query = query.neq('id', excludeMediaId)
    }

    const { data, error } = await query.maybeSingle()
    if (error) throw error

    return Boolean(data as CatalogKeyRecord | null)
}

const getCatalogItem = async ({
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

const objectExists = async ({
    client,
    bucket,
    key,
}: {
    client: S3Client
    bucket: string
    key: string
}): Promise<boolean> => {
    try {
        await client.send(
            new HeadObjectCommand({
                Bucket: bucket,
                Key: key,
            })
        )
        return true
    } catch (err) {
        const statusCode = (err as { $metadata?: { httpStatusCode?: number } })
            ?.$metadata?.httpStatusCode
        const name = (err as { name?: string })?.name

        if (statusCode === 404 || name === 'NotFound' || name === 'NoSuchKey') {
            return false
        }

        throw err
    }
}

const assertDestinationAvailable = async ({
    websiteId,
    client,
    config,
    destinationKey,
    excludeMediaId,
}: {
    websiteId: string
    client: S3Client
    config: ResolvedR2Config
    destinationKey: string
    excludeMediaId?: number
}): Promise<CheckDestinationResult> => {
    const catalogExists = await catalogKeyExists({
        websiteId,
        key: destinationKey,
        excludeMediaId,
    })
    const r2Exists = await objectExists({
        client,
        bucket: config.bucket,
        key: destinationKey,
    })

    const result = {
        destination_key: destinationKey,
        catalog_exists: catalogExists,
        r2_exists: r2Exists,
        available: !catalogExists && !r2Exists,
    }

    if (!result.available) {
        throw new MediaValidationError(
            409,
            'media.destination_collision',
            'An image already exists at that destination.',
            {
                field: 'destination_key',
                key: destinationKey,
                catalog_exists: catalogExists,
                r2_exists: r2Exists,
            }
        )
    }

    return result
}

const createPresignedUpload = async ({
    websiteSlug,
    filename,
    contentType,
    folder,
    size,
}: PresignUploadInput): Promise<PresignUploadResult> => {
    const website = await getWebsiteBySlug(websiteSlug)
    if (!website) {
        const err = new Error('Website not found') as Error & { status?: number }
        err.status = 404
        throw err
    }

    const allowedContentType = validateUploadInput({ contentType, size })
    const config = await resolveR2Config(website)
    const expiresIn = presignExpiresSeconds()
    const expiresAt = new Date(Date.now() + expiresIn * 1000)
    const key = buildR2ObjectKey({
        filename,
        contentType: allowedContentType,
        folder,
        keyPrefix: config.keyPrefix,
    })

    const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: allowedContentType,
        ContentLength: size,
    })

    const presignedUrl = await getSignedUrl(createR2Client(), command, {
        expiresIn,
        signableHeaders: new Set(['content-type', 'content-length']),
    })

    return {
        presigned_url: presignedUrl,
        public_url: joinPublicUrl(config.publicBaseUrl, key),
        r2_key: key,
        expires_at: expiresAt.toISOString(),
    }
}

const listObjects = async ({
    websiteSlug,
    prefix,
}: ListObjectsInput): Promise<ListObjectsResult> => {
    const website = await getWebsiteBySlug(websiteSlug)
    if (!website) {
        const err = new Error('Website not found') as Error & { status?: number }
        err.status = 404
        throw err
    }

    const config = await resolveR2Config(website)
    const normalizedPrefix = normalizePrefix(prefix)
    const client = createR2Client()
    const { Contents, IsTruncated } = await client.send(
        new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: normalizedPrefix || undefined,
            MaxKeys: 1000,
        })
    )

    if (IsTruncated) {
        console.warn(
            `R2 object listing truncated for ${websiteSlug} prefix "${normalizedPrefix}"`
        )
    }

    return {
        bucket: config.bucket,
        prefix: normalizedPrefix,
        objects: (Contents || [])
            .filter(object => Boolean(object.Key))
            .map(object => ({
                key: object.Key as string,
                public_url: joinPublicUrl(config.publicBaseUrl, object.Key as string),
                size: object.Size || 0,
                last_modified: object.LastModified?.toISOString(),
                etag: object.ETag?.replace(/^"|"$/g, ''),
            })),
    }
}

const checkDestination = async ({
    websiteSlug,
    destinationKey,
    excludeMediaId,
}: CheckDestinationInput): Promise<CheckDestinationResult> => {
    const website = await getWebsiteBySlug(websiteSlug)
    if (!website) {
        const err = new Error('Website not found') as Error & { status?: number }
        err.status = 404
        throw err
    }

    assertDestinationKey(destinationKey)
    const config = await resolveR2Config(website)
    const client = createR2Client()
    const catalogExists = await catalogKeyExists({
        websiteId: website.id,
        key: destinationKey,
        excludeMediaId,
    })
    const r2Exists = await objectExists({
        client,
        bucket: config.bucket,
        key: destinationKey,
    })

    return {
        destination_key: destinationKey,
        catalog_exists: catalogExists,
        r2_exists: r2Exists,
        available: !catalogExists && !r2Exists,
    }
}

const moveCatalogItemObject = async ({
    websiteSlug,
    id,
    destinationKey,
}: MoveCatalogItemInput): Promise<MoveCatalogItemResult> => {
    const website = await getWebsiteBySlug(websiteSlug)
    if (!website) {
        const err = new Error('Website not found') as Error & { status?: number }
        err.status = 404
        throw err
    }

    assertDestinationKey(destinationKey)
    const config = await resolveR2Config(website)
    const item = await getCatalogItem({ websiteId: website.id, id })

    if (!item) {
        const err = new Error('Media catalog item not found') as Error & {
            status?: number
        }
        err.status = 404
        throw err
    }

    if (item.status === 'published') {
        throw new MediaValidationError(
            409,
            'media.published_location_locked',
            'Published media cannot be moved without an explicit safe flow.',
            { status: item.status }
        )
    }

    if (item.status === 'archived') {
        throw new MediaValidationError(
            409,
            'media.archived_locked',
            'Archived media cannot be moved until restored.',
            { status: item.status }
        )
    }

    if (item.key === destinationKey) {
        throw new MediaValidationError(
            400,
            'media.invalid_destination',
            'Destination key must be different from the current key.',
            { field: 'destination_key', key: destinationKey }
        )
    }

    const client = createR2Client()
    const sourceExists = await objectExists({
        client,
        bucket: config.bucket,
        key: item.key,
    })

    if (!sourceExists) {
        throw new MediaValidationError(
            404,
            'media.source_not_found',
            'The source R2 object does not exist.',
            { key: item.key }
        )
    }

    await assertDestinationAvailable({
        websiteId: website.id,
        client,
        config,
        destinationKey,
        excludeMediaId: id,
    })

    await client.send(
        new CopyObjectCommand({
            Bucket: config.bucket,
            Key: destinationKey,
            CopySource: `${config.bucket}/${encodeURIComponent(item.key).replace(
                /%2F/g,
                '/'
            )}`,
        })
    )

    const updatedItem = await mediaCatalogService.updateItem({
        websiteSlug,
        id,
        key: destinationKey,
        filename: filenameFromKey(destinationKey),
        src: joinPublicUrl(config.publicBaseUrl, destinationKey),
    })

    await client.send(
        new DeleteObjectCommand({
            Bucket: config.bucket,
            Key: item.key,
        })
    )

    return {
        item: updatedItem,
        source_key: item.key,
        destination_key: destinationKey,
        source_deleted: true,
    }
}

export default {
    createPresignedUpload,
    listObjects,
    checkDestination,
    moveCatalogItemObject,
}
