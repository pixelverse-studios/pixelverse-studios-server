import { db } from '../lib/db'
import {
    decodeReleaseCursor,
    encodeReleaseCursor,
    mapPublicRelease,
    PublicRelease,
    RawPublicReleaseFeedRow,
    ReleaseCollection,
    ReleasePlatform,
    releaseSortKey,
    releaseVersionParts,
} from '../lib/public-releases'

export interface ListPublicReleasesInput {
    collection: ReleaseCollection
    platform: ReleasePlatform | null
    limit: number
    cursor?: string
}

export interface ListPublicReleasesResult {
    releases: PublicRelease[]
    nextCursor: string | null
}

export const listPublicReleases = async ({
    collection,
    platform,
    limit,
    cursor,
}: ListPublicReleasesInput): Promise<ListPublicReleasesResult> => {
    const cursorKey = cursor
        ? decodeReleaseCursor(cursor, collection, platform)
        : null
    const cursorVersion = cursorKey
        ? releaseVersionParts(cursorKey.version)
        : null
    const { data, error } = await db.rpc('list_public_domani_releases', {
        p_collection: collection,
        p_platform: platform,
        p_page_limit: limit,
        p_cursor_primary: cursorKey?.primary ?? null,
        p_cursor_version_major: cursorVersion?.[0] ?? null,
        p_cursor_version_minor: cursorVersion?.[1] ?? null,
        p_cursor_version_patch: cursorVersion?.[2] ?? null,
        p_cursor_id: cursorKey?.id ?? null,
    })
    if (error) throw error

    const rows = (data || []) as unknown as RawPublicReleaseFeedRow[]
    const page = rows.slice(0, limit)
    const hasMore = rows.length > limit

    return {
        releases: page.map(release =>
            mapPublicRelease(release, release.notes || [])
        ),
        nextCursor:
            hasMore && page.length > 0
                ? encodeReleaseCursor(
                      collection,
                      platform,
                      releaseSortKey(page[page.length - 1], collection)
                  )
                : null,
    }
}
