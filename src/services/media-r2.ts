import {
    CopyObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NodeHttpHandler } from '@smithy/node-http-handler'

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
    r2ConnectionTimeoutMs,
    r2RequestTimeoutMs,
    validateUploadInput,
    MediaOperationError,
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
    actor?: string
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
        requestHandler: new NodeHttpHandler({
            connectionTimeout: r2ConnectionTimeoutMs(),
            requestTimeout: r2RequestTimeoutMs(),
        }),
        requestChecksumCalculation: 'WHEN_REQUIRED',
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    })
}

const providerStatusCode = (err: unknown): number | undefined =>
    (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode

const providerErrorName = (err: unknown): string | undefined =>
    (err as { name?: string })?.name

const providerErrorCode = (err: unknown): string | undefined =>
    (err as { code?: string })?.code

const providerRetryAfter = (err: unknown): string | undefined => {
    const headers = (err as { $metadata?: { httpHeaders?: Record<string, string> } })
        ?.$metadata?.httpHeaders
    return headers?.['retry-after']
}

const isProviderTimeoutError = (err: unknown): boolean => {
    const name = providerErrorName(err)
    const code = providerErrorCode(err)
    return [
        'AbortError',
        'TimeoutError',
        'RequestTimeout',
        'RequestTimeoutException',
    ].includes(name || '') || ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code || '')
}

const isProviderBusyError = (err: unknown): boolean => {
    const statusCode = providerStatusCode(err)
    const name = providerErrorName(err)
    return (
        statusCode === 429 ||
        statusCode === 503 ||
        name === 'SlowDown' ||
        name === 'Throttling' ||
        name === 'TooManyRequestsException'
    )
}

const mapR2OperationError = ({
    err,
    operation,
    key,
}: {
    err: unknown
    operation: string
    key?: string
}): never => {
    const statusCode = providerStatusCode(err)
    const details: Record<string, unknown> = {
        provider: 'r2',
        operation,
        ...(key && { key }),
        ...(providerErrorName(err) && { provider_error: providerErrorName(err) }),
        ...(statusCode && { provider_status: statusCode }),
    }

    if (isProviderTimeoutError(err)) {
        throw new MediaOperationError({
            status: 504,
            code: 'media.upload_timeout',
            message: 'Media storage request timed out.',
            retryable: true,
            details,
        })
    }

    if (isProviderBusyError(err)) {
        throw new MediaOperationError({
            status: 503,
            code: 'media.upload_temporary_unavailable',
            message: 'Media storage is temporarily busy. Retry this upload shortly.',
            retryable: true,
            details: {
                ...details,
                ...(providerRetryAfter(err) && {
                    retry_after: providerRetryAfter(err),
                }),
            },
        })
    }

    throw new MediaOperationError({
        status: 502,
        code: 'media.upload_provider_error',
        message: 'Media storage provider request failed.',
        retryable: true,
        details,
    })
}

const sendR2Command = async <T>(
    client: S3Client,
    command: any,
    operation: string,
    key?: string
): Promise<T> => {
    try {
        return (await client.send(command as never)) as T
    } catch (err) {
        const statusCode = providerStatusCode(err)
        if (
            statusCode === 404 ||
            statusCode === 409 ||
            statusCode === 412 ||
            providerErrorName(err) === 'NotFound' ||
            providerErrorName(err) === 'NoSuchKey' ||
            providerErrorName(err) === 'ConditionalRequestConflict' ||
            providerErrorName(err) === 'PreconditionFailed'
        ) {
            throw err
        }

        mapR2OperationError({ err, operation, key })
        throw err
    }
}

const normalizePrefix = (prefix?: string): string => {
    if (!prefix) return ''
    const normalized = prefix.trim().replace(/^\/+|\/+$/g, '')
    if (!normalized) return ''

    assertSafeMediaKey(normalized)
    return normalized
}

const scopedObjectKey = ({
    key,
    config,
}: {
    key: string
    config: ResolvedR2Config
}): string => {
    const normalizedKey = normalizePrefix(key)
    const keyPrefix = normalizePrefix(config.keyPrefix)

    if (!keyPrefix) return normalizedKey
    if (normalizedKey === keyPrefix || normalizedKey.startsWith(`${keyPrefix}/`)) {
        return normalizedKey
    }

    return `${keyPrefix}/${normalizedKey}`
}

const isKeyInConfiguredPrefix = ({
    key,
    config,
}: {
    key: string
    config: ResolvedR2Config
}): boolean => {
    const keyPrefix = normalizePrefix(config.keyPrefix)
    if (!keyPrefix) return true

    return key === keyPrefix || key.startsWith(`${keyPrefix}/`)
}

const assertKeyInConfiguredPrefix = ({
    key,
    config,
}: {
    key: string
    config: ResolvedR2Config
}): void => {
    const keyPrefix = normalizePrefix(config.keyPrefix)
    if (!keyPrefix) return

    if (!isKeyInConfiguredPrefix({ key, config })) {
        throw new MediaValidationError(
            409,
            'media.key_prefix_mismatch',
            'Media object key is outside the configured R2 prefix.',
            { field: 'key', key, key_prefix: keyPrefix }
        )
    }
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
        await sendR2Command(
            client,
            new HeadObjectCommand({
                Bucket: bucket,
                Key: key,
            }),
            'head_object',
            key
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

const isConditionalWriteFailure = (err: unknown): boolean => {
    const statusCode = (err as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode
    const name = (err as { name?: string })?.name

    return (
        statusCode === 409 ||
        statusCode === 412 ||
        name === 'ConditionalRequestConflict' ||
        name === 'PreconditionFailed'
    )
}

const throwDestinationCollision = ({
    destinationKey,
    catalogExists,
    r2Exists,
}: {
    destinationKey: string
    catalogExists: boolean
    r2Exists: boolean
}): never => {
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
        throwDestinationCollision({
            destinationKey,
            catalogExists,
            r2Exists,
        })
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
    const keyPrefix = normalizePrefix(config.keyPrefix)
    const normalizedPrefix = prefix
        ? scopedObjectKey({ key: prefix, config })
        : keyPrefix
          ? `${keyPrefix}/`
          : ''
    const client = createR2Client()
    const { Contents, IsTruncated } = await sendR2Command<{
        Contents?: Array<{
            Key?: string
            Size?: number
            LastModified?: Date
            ETag?: string
        }>
        IsTruncated?: boolean
    }>(
        client,
        new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: normalizedPrefix || undefined,
            MaxKeys: 1000,
        }),
        'list_objects',
        normalizedPrefix
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
            .filter(object =>
                isKeyInConfiguredPrefix({
                    key: object.Key as string,
                    config,
                })
            )
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

    const config = await resolveR2Config(website)
    const scopedDestinationKey = scopedObjectKey({
        key: destinationKey,
        config,
    })
    assertDestinationKey(scopedDestinationKey)
    const client = createR2Client()
    const catalogExists = await catalogKeyExists({
        websiteId: website.id,
        key: scopedDestinationKey,
        excludeMediaId,
    })
    const r2Exists = await objectExists({
        client,
        bucket: config.bucket,
        key: scopedDestinationKey,
    })

    return {
        destination_key: scopedDestinationKey,
        catalog_exists: catalogExists,
        r2_exists: r2Exists,
        available: !catalogExists && !r2Exists,
    }
}

const moveCatalogItemObject = async ({
    websiteSlug,
    id,
    destinationKey,
    actor,
}: MoveCatalogItemInput): Promise<MoveCatalogItemResult> => {
    const website = await getWebsiteBySlug(websiteSlug)
    if (!website) {
        const err = new Error('Website not found') as Error & { status?: number }
        err.status = 404
        throw err
    }

    const config = await resolveR2Config(website)
    const scopedDestinationKey = scopedObjectKey({
        key: destinationKey,
        config,
    })
    assertDestinationKey(scopedDestinationKey)
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

    assertKeyInConfiguredPrefix({ key: item.key, config })

    if (item.key === scopedDestinationKey) {
        throw new MediaValidationError(
            400,
            'media.invalid_destination',
            'Destination key must be different from the current key.',
            { field: 'destination_key', key: scopedDestinationKey }
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
        destinationKey: scopedDestinationKey,
        excludeMediaId: id,
    })

    try {
        await sendR2Command(
            client,
            new CopyObjectCommand({
                Bucket: config.bucket,
                Key: scopedDestinationKey,
                CopySource: `${config.bucket}/${encodeURIComponent(
                    item.key
                ).replace(/%2F/g, '/')}`,
                IfNoneMatch: '*',
            }),
            'copy_object',
            scopedDestinationKey
        )
    } catch (err) {
        if (isConditionalWriteFailure(err)) {
            throwDestinationCollision({
                destinationKey: scopedDestinationKey,
                catalogExists: false,
                r2Exists: true,
            })
        }

        throw err
    }

    let updatedItem: CatalogItemResponse
    try {
        updatedItem = await mediaCatalogService.updateItem({
            websiteSlug,
            id,
            key: scopedDestinationKey,
            filename: filenameFromKey(scopedDestinationKey),
            src: joinPublicUrl(config.publicBaseUrl, scopedDestinationKey),
            actor,
        })
    } catch (err) {
        try {
            await sendR2Command(
                client,
                new DeleteObjectCommand({
                    Bucket: config.bucket,
                    Key: scopedDestinationKey,
                }),
                'delete_object',
                scopedDestinationKey
            )
        } catch (cleanupErr) {
            console.error(
                `Failed to clean up copied R2 object after catalog update failure: ${scopedDestinationKey}`,
                cleanupErr
            )
        }

        throw err
    }

    let sourceDeleted = true
    try {
        await sendR2Command(
            client,
            new DeleteObjectCommand({
                Bucket: config.bucket,
                Key: item.key,
            }),
            'delete_object',
            item.key
        )
    } catch (err) {
        sourceDeleted = false
        console.error(
            `Failed to delete source R2 object after catalog move: ${item.key}`,
            err
        )
    }

    return {
        item: updatedItem,
        source_key: item.key,
        destination_key: scopedDestinationKey,
        source_deleted: sourceDeleted,
    }
}

export default {
    createPresignedUpload,
    listObjects,
    checkDestination,
    moveCatalogItemObject,
}
