import { db, Tables } from '../lib/db'
import {
    compareReleaseKeys,
    decodeReleaseCursor,
    encodeReleaseCursor,
    mapPublicRelease,
    PUBLIC_RELEASE_NOTE_SELECT,
    PUBLIC_RELEASE_SELECT,
    PublicRelease,
    RawPublicRelease,
    RawPublicReleaseNote,
    ReleaseCollection,
    ReleasePlatform,
    releaseSortKey,
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

const loadReleases = async (
    collection: ReleaseCollection
): Promise<RawPublicRelease[]> => {
    let query = db
        .from(Tables.RELEASES)
        .select(PUBLIC_RELEASE_SELECT)
        .is('archived_at', null)

    if (collection === 'coming-soon') {
        query = query
            .eq('visibility', 'public_preview')
            .in('lifecycle_status', ['planned', 'in_progress'])
            .in('release_type', ['major', 'minor', 'roadmap'])
    } else {
        query = query
            .eq('visibility', 'published')
            .eq('lifecycle_status', 'released')
            .not('released_at', 'is', null)
    }

    const { data, error } = await query
    if (error) throw error
    return (data || []) as unknown as RawPublicRelease[]
}

const loadNotes = async (
    releaseIds: string[],
    platform: ReleasePlatform | null
): Promise<RawPublicReleaseNote[]> => {
    if (releaseIds.length === 0) return []

    let query = db
        .from(Tables.RELEASE_NOTES)
        .select(PUBLIC_RELEASE_NOTE_SELECT)
        .in('release_id', releaseIds)
        .eq('is_public', true)
        .is('archived_at', null)

    if (platform) query = query.contains('platforms', [platform])

    const { data, error } = await query
    if (error) throw error
    return (data || []) as unknown as RawPublicReleaseNote[]
}

export const listPublicReleases = async ({
    collection,
    platform,
    limit,
    cursor,
}: ListPublicReleasesInput): Promise<ListPublicReleasesResult> => {
    const releases = await loadReleases(collection)
    const notes = await loadNotes(
        releases.map(release => release.id),
        platform
    )
    const notesByRelease = new Map<string, RawPublicReleaseNote[]>()
    notes.forEach(note => {
        const releaseNotes = notesByRelease.get(note.release_id) || []
        releaseNotes.push(note)
        notesByRelease.set(note.release_id, releaseNotes)
    })

    const sorted = releases
        .filter(release => (notesByRelease.get(release.id) || []).length > 0)
        .sort((left, right) =>
            compareReleaseKeys(
                releaseSortKey(left, collection),
                releaseSortKey(right, collection),
                collection
            )
        )

    const cursorKey = cursor
        ? decodeReleaseCursor(cursor, collection, platform)
        : null
    const afterCursor = cursorKey
        ? sorted.filter(
              release =>
                  compareReleaseKeys(
                      releaseSortKey(release, collection),
                      cursorKey,
                      collection
                  ) > 0
          )
        : sorted
    const page = afterCursor.slice(0, limit)
    const hasMore = afterCursor.length > limit

    return {
        releases: page.map(release =>
            mapPublicRelease(release, notesByRelease.get(release.id) || [])
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
