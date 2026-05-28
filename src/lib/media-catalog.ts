import { MediaValidationError } from './media-r2'

export const MEDIA_CATALOG_VERSION = 1

export const MEDIA_STATUSES = ['draft', 'published', 'archived'] as const
export type MediaStatus = (typeof MEDIA_STATUSES)[number]

export const MEDIA_ASPECT_RATIOS = [
    'portrait',
    'landscape',
    'square',
    'video',
] as const
export type MediaAspectRatio = (typeof MEDIA_ASPECT_RATIOS)[number]

export const MEDIA_SERVICES = [
    'Events',
    'Family',
    'Maternity',
    'Couples',
    'Portrait',
] as const
export type MediaService = (typeof MEDIA_SERVICES)[number]

export const MEDIA_SUB_CATEGORIES: Record<MediaService, string[]> = {
    Events: [
        'Baby Shower',
        'Bridal Shower',
        'Gender Reveal',
        'Birthday',
        'Baptism',
    ],
    Family: ['Family'],
    Maternity: ['Maternity'],
    Couples: ['Engagement', 'Proposal'],
    Portrait: ['Portrait'],
}

export const isMediaService = (value: unknown): value is MediaService =>
    typeof value === 'string' && MEDIA_SERVICES.includes(value as MediaService)

export const isMediaAspectRatio = (
    value: unknown
): value is MediaAspectRatio =>
    typeof value === 'string' &&
    MEDIA_ASPECT_RATIOS.includes(value as MediaAspectRatio)

export const assertValidServiceSubCategory = ({
    service,
    subCategory,
}: {
    service?: string | null
    subCategory?: string | null
}): void => {
    if (service && !isMediaService(service)) {
        throw new MediaValidationError(
            400,
            'media.invalid_service',
            'Invalid media service.',
            { field: 'service', allowed: MEDIA_SERVICES }
        )
    }

    if (!subCategory) return

    if (!service) {
        throw new MediaValidationError(
            400,
            'media.invalid_sub_category',
            'Sub-category requires a valid service.',
            { field: 'subCategory' }
        )
    }

    const allowed = MEDIA_SUB_CATEGORIES[service as MediaService] || []
    if (!allowed.includes(subCategory)) {
        throw new MediaValidationError(
            400,
            'media.invalid_sub_category',
            'Invalid media sub-category for service.',
            { field: 'subCategory', service, allowed }
        )
    }
}

export const assertValidAspectRatio = (
    aspectRatio?: string | null
): void => {
    if (!aspectRatio) return

    if (!isMediaAspectRatio(aspectRatio)) {
        throw new MediaValidationError(
            400,
            'media.invalid_aspect_ratio',
            'Invalid media aspect ratio.',
            { field: 'aspectRatio', allowed: MEDIA_ASPECT_RATIOS }
        )
    }
}

export const assertSafeMediaKey = (key: string): void => {
    if (
        key !== key.toLowerCase() ||
        key.startsWith('/') ||
        key.endsWith('/') ||
        key.includes('//') ||
        key.includes('..')
    ) {
        throw new MediaValidationError(
            400,
            'media.invalid_key',
            'Media key must be a safe lowercase R2 object key.',
            { field: 'key' }
        )
    }
}

export const assertSafeFilename = (filename: string): void => {
    if (
        filename !== filename.toLowerCase() ||
        filename.includes('/') ||
        filename.includes('\\') ||
        filename.includes('..')
    ) {
        throw new MediaValidationError(
            400,
            'media.invalid_filename',
            'Filename must be safe and lowercase.',
            { field: 'filename' }
        )
    }
}

export const filenameFromKey = (key: string): string =>
    key.split('/').filter(Boolean).pop() || key
