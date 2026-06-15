import crypto from 'crypto'

export const ALLOWED_UPLOAD_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
] as const

export type AllowedUploadContentType =
    (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number]

export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const DEFAULT_PRESIGN_EXPIRES_SECONDS = 15 * 60
export const DEFAULT_R2_CONNECTION_TIMEOUT_MS = 2_000
export const DEFAULT_R2_REQUEST_TIMEOUT_MS = 8_000
export const DEFAULT_MEDIA_UPLOAD_BATCH_MAX_ITEMS = 10

const CONTENT_TYPE_EXTENSIONS: Record<AllowedUploadContentType, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}

export class MediaValidationError extends Error {
    status: number
    code: string
    details?: Record<string, unknown>

    constructor(
        status: number,
        code: string,
        message: string,
        details?: Record<string, unknown>
    ) {
        super(message)
        this.status = status
        this.code = code
        this.details = details
    }
}

export class MediaOperationError extends Error {
    status: number
    code: string
    retryable: boolean
    details?: Record<string, unknown>

    constructor({
        status,
        code,
        message,
        retryable,
        details,
    }: {
        status: number
        code: string
        message: string
        retryable: boolean
        details?: Record<string, unknown>
    }) {
        super(message)
        this.status = status
        this.code = code
        this.retryable = retryable
        this.details = details
    }
}

export const maxUploadBytes = (): number => {
    const parsed = Number(process.env.MEDIA_MAX_UPLOAD_BYTES)
    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_MAX_UPLOAD_BYTES
}

export const mediaUploadBatchMaxItems = (): number => {
    const parsed = Number(process.env.MEDIA_UPLOAD_BATCH_MAX_ITEMS)
    return Number.isFinite(parsed) && parsed > 0
        ? Math.floor(parsed)
        : DEFAULT_MEDIA_UPLOAD_BATCH_MAX_ITEMS
}

export const presignExpiresSeconds = (): number => {
    const parsed = Number(process.env.R2_PRESIGN_EXPIRES_SECONDS)
    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_PRESIGN_EXPIRES_SECONDS
}

export const r2ConnectionTimeoutMs = (): number => {
    const parsed = Number(process.env.R2_CONNECTION_TIMEOUT_MS)
    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_R2_CONNECTION_TIMEOUT_MS
}

export const r2RequestTimeoutMs = (): number => {
    const parsed = Number(process.env.R2_REQUEST_TIMEOUT_MS)
    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_R2_REQUEST_TIMEOUT_MS
}

export const isAllowedUploadContentType = (
    contentType: string
): contentType is AllowedUploadContentType =>
    ALLOWED_UPLOAD_CONTENT_TYPES.includes(
        contentType as AllowedUploadContentType
    )

const kebabCase = (value: string): string =>
    value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-')

const normalizeFolder = (folder?: string): string => {
    if (!folder) return ''

    return folder
        .split('/')
        .map(segment => kebabCase(segment))
        .filter(Boolean)
        .join('/')
}

const normalizeKeyPrefix = (keyPrefix?: string): string => {
    if (!keyPrefix) return ''
    return normalizeFolder(keyPrefix)
}

export const normalizeFilename = (
    filename: string,
    contentType: AllowedUploadContentType
): string => {
    const fallbackExtension = CONTENT_TYPE_EXTENSIONS[contentType]
    const lastSegment = filename.split(/[\\/]/).filter(Boolean).pop() || ''
    const withoutQuery = lastSegment.split('?')[0].split('#')[0]
    const extensionMatch = withoutQuery.match(/\.([a-z0-9]+)$/i)
    const extension = fallbackExtension
    const baseName = extensionMatch
        ? withoutQuery.slice(0, -extensionMatch[0].length)
        : withoutQuery
    const safeBase = kebabCase(baseName) || 'upload'

    return `${safeBase}.${extension || fallbackExtension}`
}

export const buildR2ObjectKey = ({
    filename,
    contentType,
    folder,
    keyPrefix,
    now = Date.now(),
    uniqueSuffix = crypto.randomBytes(6).toString('hex'),
}: {
    filename: string
    contentType: AllowedUploadContentType
    folder?: string
    keyPrefix?: string
    now?: number
    uniqueSuffix?: string
}): string => {
    const safeFilename = normalizeFilename(filename, contentType)
    const safeFolder = normalizeFolder(folder)
    const safePrefix = normalizeKeyPrefix(keyPrefix)
    const filenameWithCollisionGuard = `${now}-${uniqueSuffix}-${safeFilename}`

    return [safePrefix, safeFolder, filenameWithCollisionGuard]
        .filter(Boolean)
        .join('/')
}

export const joinPublicUrl = (publicBaseUrl: string, key: string): string =>
    `${publicBaseUrl.replace(/\/+$/g, '')}/${key}`

export const validateUploadInput = ({
    contentType,
    size,
}: {
    contentType: string
    size: number
}): AllowedUploadContentType => {
    if (!isAllowedUploadContentType(contentType)) {
        throw new MediaValidationError(
            400,
            'media.invalid_content_type',
            'Unsupported upload content type.',
            {
                field: 'content_type',
                allowed: ALLOWED_UPLOAD_CONTENT_TYPES,
            }
        )
    }

    const maxBytes = maxUploadBytes()
    if (!Number.isFinite(size) || size <= 0) {
        throw new MediaValidationError(
            400,
            'media.invalid_upload_size',
            'Upload size must be a positive number.',
            { field: 'size' }
        )
    }

    if (size > maxBytes) {
        throw new MediaValidationError(
            413,
            'media.file_too_large',
            'Upload exceeds the configured maximum size.',
            { field: 'size', size, max_size: maxBytes }
        )
    }

    return contentType
}
