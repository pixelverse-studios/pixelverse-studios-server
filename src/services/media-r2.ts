import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { COLUMNS, db, Tables } from '../lib/db'
import {
    buildR2ObjectKey,
    joinPublicUrl,
    presignExpiresSeconds,
    validateUploadInput,
} from '../lib/media-r2'

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
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    })
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
    })

    const presignedUrl = await getSignedUrl(createR2Client(), command, {
        expiresIn,
    })

    return {
        presigned_url: presignedUrl,
        public_url: joinPublicUrl(config.publicBaseUrl, key),
        r2_key: key,
        expires_at: expiresAt.toISOString(),
    }
}

export default {
    createPresignedUpload,
}
