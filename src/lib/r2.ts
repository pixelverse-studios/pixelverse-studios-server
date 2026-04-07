import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import 'dotenv/config'

export interface R2Config {
    bucket: string
    public_base_url: string
    key_prefix?: string | null
}

export class R2ConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'R2ConfigError'
    }
}

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
const R2_DEFAULT_BUCKET = process.env.R2_DEFAULT_BUCKET || ''
const R2_DEFAULT_PUBLIC_BASE_URL = process.env.R2_DEFAULT_PUBLIC_BASE_URL || ''

let cachedClient: S3Client | null = null

const validateKeyPrefix = (prefix: unknown): void => {
    if (prefix === null || prefix === undefined || prefix === '') return
    if (typeof prefix !== 'string') {
        throw new R2ConfigError('r2_config.key_prefix must be a string')
    }
    if (prefix.length > 200) {
        throw new R2ConfigError('r2_config.key_prefix exceeds 200 chars')
    }
    if (prefix.includes('..') || prefix.includes('//')) {
        throw new R2ConfigError(
            'r2_config.key_prefix contains invalid segments'
        )
    }
    if (!/^[a-z0-9][a-z0-9_/-]*$/.test(prefix)) {
        throw new R2ConfigError(
            'r2_config.key_prefix contains invalid characters'
        )
    }
}

const getClient = (): S3Client => {
    if (cachedClient) return cachedClient
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
        throw new R2ConfigError(
            'R2 client credentials not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)'
        )
    }
    cachedClient = new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
    })
    return cachedClient
}

/**
 * Resolves the R2 config for a website. If the website has an r2_config
 * JSONB override, returns that. Otherwise falls back to env defaults.
 * Throws R2ConfigError if no config is available.
 */
export const resolveR2Config = (
    website?: { r2_config?: R2Config | null } | null
): R2Config => {
    if (website?.r2_config) {
        const cfg = website.r2_config
        if (!cfg.bucket || !cfg.public_base_url) {
            throw new R2ConfigError(
                'Website r2_config is missing bucket or public_base_url'
            )
        }
        validateKeyPrefix(cfg.key_prefix)
        return cfg
    }
    if (!R2_DEFAULT_BUCKET || !R2_DEFAULT_PUBLIC_BASE_URL) {
        throw new R2ConfigError(
            'R2 default config not set (R2_DEFAULT_BUCKET, R2_DEFAULT_PUBLIC_BASE_URL)'
        )
    }
    const defaultConfig: R2Config = {
        bucket: R2_DEFAULT_BUCKET,
        public_base_url: R2_DEFAULT_PUBLIC_BASE_URL,
        key_prefix: null,
    }
    validateKeyPrefix(defaultConfig.key_prefix)
    return defaultConfig
}

/**
 * Generates a presigned PUT URL for uploading directly to R2.
 */
export const generatePresignedPutUrl = async (params: {
    bucket: string
    key: string
    contentType: string
    expiresIn: number
}): Promise<string> => {
    const client = getClient()
    const command = new PutObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
        ContentType: params.contentType,
    })
    return getSignedUrl(client, command, { expiresIn: params.expiresIn })
}

/**
 * Deletes an object from R2.
 */
export const deleteObject = async (params: {
    bucket: string
    key: string
}): Promise<void> => {
    const client = getClient()
    await client.send(
        new DeleteObjectCommand({
            Bucket: params.bucket,
            Key: params.key,
        })
    )
}

/**
 * Combines a public base URL with an object key to produce the
 * publicly accessible URL for the uploaded file.
 */
export const buildPublicUrl = (publicBaseUrl: string, key: string): string => {
    const base = publicBaseUrl.replace(/\/$/, '')
    const path = key.replace(/^\//, '')
    return `${base}/${path}`
}
