import {
    MEDIA_ASPECT_RATIOS,
    MEDIA_SERVICES,
    MEDIA_SUB_CATEGORIES,
    MediaAspectRatio,
    MediaService,
    assertSafeFilename,
    assertSafeMediaKey,
    assertValidAspectRatio,
    assertValidServiceSubCategory,
    filenameFromKey,
} from '../lib/media-catalog'

export interface SourcePortfolioItem {
    id: number
    src: string
    alt: string
    service: string
    subCategory: string
    aspectRatio: string
}

export interface MediaCatalogBackfillRow {
    website_id: string
    client_id: string
    key: string
    filename: string
    src: string
    alt: string
    service: MediaService
    sub_category: string
    aspect_ratio: MediaAspectRatio
    status: 'published'
    sort_order: number
}

export const normalizePublicBaseUrl = (publicBaseUrl: string): string => {
    const trimmed = publicBaseUrl.trim()
    if (!trimmed) throw new Error('publicBaseUrl is required')

    return trimmed.replace(/\/+$/, '')
}

export const keyFromPublicUrl = ({
    src,
    sourcePublicBaseUrl,
}: {
    src: string
    sourcePublicBaseUrl: string
}): string => {
    const normalizedBase = normalizePublicBaseUrl(sourcePublicBaseUrl)
    const srcUrl = new URL(src)
    const baseUrl = new URL(normalizedBase)

    if (srcUrl.origin !== baseUrl.origin) {
        throw new Error(
            `Image URL origin does not match public base URL: ${src}`
        )
    }

    const basePath = baseUrl.pathname.replace(/\/+$/, '')
    const srcPath = srcUrl.pathname
    if (basePath && basePath !== '/' && !srcPath.startsWith(`${basePath}/`)) {
        throw new Error(
            `Image URL path is outside public base URL path: ${src}`
        )
    }

    const key = decodeURIComponent(
        srcPath.slice(basePath === '/' ? 1 : basePath.length + 1)
    )
    assertSafeMediaKey(key)
    return key
}

export const joinPublicUrl = (publicBaseUrl: string, key: string): string =>
    `${normalizePublicBaseUrl(publicBaseUrl)}/${key.replace(/^\/+/, '')}`

export function assertSourcePortfolioItem(
    item: unknown
): asserts item is SourcePortfolioItem {
    if (!item || typeof item !== 'object') {
        throw new Error('Portfolio item must be an object')
    }

    const candidate = item as Partial<SourcePortfolioItem>
    if (typeof candidate.id !== 'number') {
        throw new Error('Portfolio item id must be a number')
    }
    if (typeof candidate.src !== 'string' || !candidate.src.trim()) {
        throw new Error(`Portfolio item ${candidate.id} requires src`)
    }
    if (typeof candidate.alt !== 'string' || !candidate.alt.trim()) {
        throw new Error(`Portfolio item ${candidate.id} requires alt`)
    }
    if (
        typeof candidate.service !== 'string' ||
        !MEDIA_SERVICES.includes(candidate.service as MediaService)
    ) {
        throw new Error(
            `Portfolio item ${candidate.id} has invalid service. Allowed: ${MEDIA_SERVICES.join(', ')}`
        )
    }
    if (
        typeof candidate.aspectRatio !== 'string' ||
        !MEDIA_ASPECT_RATIOS.includes(
            candidate.aspectRatio as MediaAspectRatio
        )
    ) {
        throw new Error(
            `Portfolio item ${candidate.id} has invalid aspectRatio. Allowed: ${MEDIA_ASPECT_RATIOS.join(', ')}`
        )
    }
    if (
        typeof candidate.subCategory !== 'string' ||
        !MEDIA_SUB_CATEGORIES[candidate.service as MediaService]?.includes(
            candidate.subCategory
        )
    ) {
        throw new Error(
            `Portfolio item ${candidate.id} has invalid subCategory for ${candidate.service}`
        )
    }
}

export const buildMediaCatalogBackfillRows = ({
    items,
    sourcePublicBaseUrl,
    catalogPublicBaseUrl,
    websiteId,
    clientId,
}: {
    items: unknown[]
    sourcePublicBaseUrl: string
    catalogPublicBaseUrl: string
    websiteId: string
    clientId: string
}): MediaCatalogBackfillRow[] => {
    const seenKeys = new Set<string>()

    return items.map((item, index) => {
        assertSourcePortfolioItem(item)
        assertValidServiceSubCategory({
            service: item.service,
            subCategory: item.subCategory,
        })
        assertValidAspectRatio(item.aspectRatio)

        const key = keyFromPublicUrl({ src: item.src, sourcePublicBaseUrl })
        if (seenKeys.has(key)) {
            throw new Error(`Duplicate source media key: ${key}`)
        }
        seenKeys.add(key)

        const filename = filenameFromKey(key)
        assertSafeFilename(filename)

        return {
            website_id: websiteId,
            client_id: clientId,
            key,
            filename,
            src: joinPublicUrl(catalogPublicBaseUrl, key),
            alt: item.alt.trim(),
            service: item.service as MediaService,
            sub_category: item.subCategory,
            aspect_ratio: item.aspectRatio as MediaAspectRatio,
            status: 'published',
            sort_order: index,
        }
    })
}
