import { db, Tables } from '../lib/db'
import {
    R2Config,
    resolveR2Config,
    generatePresignedPutUrl,
    deleteObject,
    buildPublicUrl,
} from '../lib/r2'

export interface WebsiteR2Context {
    id: string
    client_id: string | null
    r2_config: R2Config | null
}

const PRESIGN_EXPIRES_IN_SECONDS = 900

/**
 * Fetches the fields needed to authorize and process an R2 upload
 * for a website. Returns null if the website doesn't exist.
 */
const fetchWebsiteForUpload = async (
    websiteId: string
): Promise<WebsiteR2Context | null> => {
    const { data, error } = await db
        .from(Tables.WEBSITES)
        .select('id, client_id, r2_config')
        .eq('id', websiteId)
        .maybeSingle()

    if (error) throw error
    return (data as WebsiteR2Context) || null
}

/**
 * Sanitizes a filename for safe use in an R2 object key.
 * Lowercases, replaces unsafe characters with hyphens, collapses
 * runs of hyphens, strips leading/trailing hyphens.
 */
const sanitizeFilename = (filename: string): string => {
    const lower = filename.toLowerCase()
    const replaced = lower.replace(/[^a-z0-9._-]/g, '-')
    const collapsed = replaced.replace(/-+/g, '-')
    const trimmed = collapsed.replace(/^-+|-+$/g, '')
    return trimmed || 'file'
}

const buildKeyPrefix = (config: R2Config): string => {
    const prefix = (config.key_prefix || '').replace(/^\/+|\/+$/g, '')
    return prefix ? `${prefix}/` : ''
}

export interface CreatePresignedUploadInput {
    website: WebsiteR2Context
    filename: string
    contentType: string
    folder: string
}

export interface PresignedUploadResult {
    presigned_url: string
    public_url: string
    r2_key: string
    expires_in: number
}

/**
 * Generates a presigned PUT URL for uploading a file directly to R2.
 * Key structure: {optional-prefix}{website_id}/{folder}/{timestamp}-{sanitized-filename}
 */
const createPresignedUpload = async (
    input: CreatePresignedUploadInput
): Promise<PresignedUploadResult> => {
    const config = resolveR2Config(input.website)
    const sanitized = sanitizeFilename(input.filename)
    const folder = input.folder.replace(/^\/+|\/+$/g, '')
    const timestamp = Date.now()
    const prefix = buildKeyPrefix(config)
    const r2Key = folder
        ? `${prefix}${input.website.id}/${folder}/${timestamp}-${sanitized}`
        : `${prefix}${input.website.id}/${timestamp}-${sanitized}`

    const presignedUrl = await generatePresignedPutUrl({
        bucket: config.bucket,
        key: r2Key,
        contentType: input.contentType,
        expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
    })

    return {
        presigned_url: presignedUrl,
        public_url: buildPublicUrl(config.public_base_url, r2Key),
        r2_key: r2Key,
        expires_in: PRESIGN_EXPIRES_IN_SECONDS,
    }
}

export interface DeleteUploadInput {
    website: WebsiteR2Context
    r2_key: string
}

/**
 * Deletes an R2 object. Verifies the r2_key is scoped to the website
 * (via the key_prefix + website_id) to prevent cross-tenant deletes.
 */
const deleteUpload = async (input: DeleteUploadInput): Promise<void> => {
    const config = resolveR2Config(input.website)
    const prefix = buildKeyPrefix(config)
    const expectedKeyPrefix = `${prefix}${input.website.id}/`

    if (!input.r2_key.startsWith(expectedKeyPrefix)) {
        throw {
            status: 403,
            message: 'r2_key does not belong to this website',
        }
    }

    await deleteObject({
        bucket: config.bucket,
        key: input.r2_key,
    })
}

export default {
    fetchWebsiteForUpload,
    createPresignedUpload,
    deleteUpload,
}
