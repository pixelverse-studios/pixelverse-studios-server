import crypto from 'crypto'

export const RELEASE_API_VERSION = '2026-08-05' as const
export const PUBLIC_RELEASE_CACHE_CONTROL =
    'public, s-maxage=300, stale-while-revalidate=600'

export const RELEASE_PLATFORMS = ['ios', 'android'] as const
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number]
export type ReleaseCollection = 'coming-soon' | 'changelog'
export type ReleaseType = 'major' | 'minor' | 'patch' | 'roadmap'
export type PublicReleaseLifecycle = 'planned' | 'in_progress' | 'released'
export type ReleaseNoteType = 'feature' | 'improvement' | 'fix' | 'breaking'
export type FieldErrors = Record<string, string[]>

export const PUBLIC_RELEASE_SELECT = [
    'id',
    'version',
    'slug',
    'title',
    'release_type',
    'lifecycle_status',
    'public_summary',
    'target_month',
    'target_date',
    'confirmed_date',
    'released_at',
].join(',')

export const PUBLIC_RELEASE_NOTE_SELECT = [
    'id',
    'release_id',
    'note_type',
    'public_title',
    'public_body',
    'platforms',
    'sort_order',
].join(',')

export interface RawPublicRelease {
    id: string
    version: string
    slug: string
    title: string
    release_type: string
    lifecycle_status: string
    public_summary: string
    target_month: string | null
    target_date: string | null
    confirmed_date: string | null
    released_at: string | null
}

export interface RawPublicReleaseNote {
    id: string
    release_id: string
    note_type: string
    public_title: string
    public_body: string
    platforms: string[]
    sort_order: number
}

export interface PublicReleaseNote {
    id: string
    type: ReleaseNoteType
    title: string
    body: string
    platforms: ReleasePlatform[]
    order: number
}

export type PublicReleaseTimeline =
    | { kind: 'released'; value: string; label: string }
    | { kind: 'confirmed_date'; value: string; label: string }
    | { kind: 'target_date'; value: string; label: string }
    | { kind: 'target_month'; value: string; label: string }
    | { kind: 'tbd'; value: null; label: 'Date to be announced.' }

export interface PublicRelease {
    id: string
    version: string
    slug: string
    title: string
    releaseType: ReleaseType
    lifecycleStatus: PublicReleaseLifecycle
    publicSummary: string
    timeline: PublicReleaseTimeline
    releasedAt: string | null
    notes: PublicReleaseNote[]
}

interface CursorSortKey {
    primary: string | null
    version: string
    id: string
}

interface CursorPayload {
    cursorVersion: 1
    apiVersion: typeof RELEASE_API_VERSION
    collection: ReleaseCollection
    platform: ReleasePlatform | null
    key: CursorSortKey
}

export class PublicReleaseApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly fieldErrors: FieldErrors = {}
    ) {
        super(message)
        this.name = 'PublicReleaseApiError'
    }
}

const cursorSecret = (): string => {
    const secret =
        process.env.DOMANI_RELEASE_CURSOR_SECRET ||
        process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!secret) {
        throw new Error('DOMANI_RELEASE_CURSOR_SECRET is not configured')
    }

    return secret
}

const signCursorPayload = (encodedPayload: string): string =>
    crypto
        .createHmac('sha256', cursorSecret())
        .update(encodedPayload)
        .digest('base64url')

export const encodeReleaseCursor = (
    collection: ReleaseCollection,
    platform: ReleasePlatform | null,
    key: CursorSortKey
): string => {
    const payload: CursorPayload = {
        cursorVersion: 1,
        apiVersion: RELEASE_API_VERSION,
        collection,
        platform,
        key,
    }
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
        'base64url'
    )

    return `${encodedPayload}.${signCursorPayload(encodedPayload)}`
}

const isCursorSortKey = (value: unknown): value is CursorSortKey => {
    if (!value || typeof value !== 'object') return false
    const key = value as Record<string, unknown>
    return (
        (key.primary === null || typeof key.primary === 'string') &&
        typeof key.version === 'string' &&
        typeof key.id === 'string'
    )
}

export const decodeReleaseCursor = (
    cursor: string,
    collection: ReleaseCollection,
    platform: ReleasePlatform | null
): CursorSortKey => {
    try {
        const parts = cursor.split('.')
        if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error()

        const [encodedPayload, signature] = parts
        const expected = Buffer.from(
            signCursorPayload(encodedPayload),
            'base64url'
        )
        const received = Buffer.from(signature, 'base64url')
        if (
            received.length !== expected.length ||
            !crypto.timingSafeEqual(received, expected)
        ) {
            throw new Error()
        }

        const parsed = JSON.parse(
            Buffer.from(encodedPayload, 'base64url').toString('utf8')
        ) as Partial<CursorPayload>
        if (
            parsed.cursorVersion !== 1 ||
            parsed.apiVersion !== RELEASE_API_VERSION ||
            parsed.collection !== collection ||
            parsed.platform !== platform ||
            !isCursorSortKey(parsed.key)
        ) {
            throw new Error()
        }

        return parsed.key
    } catch {
        throw new PublicReleaseApiError(400, 'VALIDATION_ERROR', 'Invalid query parameters', {
            cursor: ['Cursor is invalid or does not match this request'],
        })
    }
}

const versionParts = (version: string): number[] => {
    const match = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/)
    if (!match) return [0, 0, 0]
    return [Number(match[1]), Number(match[2]), Number(match[3] || 0)]
}

export const compareVersions = (left: string, right: string): number => {
    const leftParts = versionParts(left)
    const rightParts = versionParts(right)
    for (let index = 0; index < 3; index += 1) {
        if (leftParts[index] !== rightParts[index]) {
            return leftParts[index] - rightParts[index]
        }
    }
    return left.localeCompare(right)
}

export const releaseSortKey = (
    release: RawPublicRelease,
    collection: ReleaseCollection
): CursorSortKey => ({
    primary:
        collection === 'changelog'
            ? release.released_at
            : release.confirmed_date ||
              release.target_date ||
              release.target_month,
    version: release.version,
    id: release.id,
})

export const compareReleaseKeys = (
    left: CursorSortKey,
    right: CursorSortKey,
    collection: ReleaseCollection
): number => {
    if (left.primary === null || right.primary === null) {
        if (left.primary === null && right.primary !== null) return 1
        if (left.primary !== null && right.primary === null) return -1
    } else if (left.primary !== right.primary) {
        return collection === 'changelog'
            ? right.primary.localeCompare(left.primary)
            : left.primary.localeCompare(right.primary)
    }

    const versionComparison = compareVersions(left.version, right.version)
    if (versionComparison !== 0) {
        return collection === 'changelog'
            ? -versionComparison
            : versionComparison
    }
    return left.id.localeCompare(right.id)
}

const parseCalendarDate = (value: string): Date | null => {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) return null
    const date = new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    )
    return date.getUTCFullYear() === Number(match[1]) &&
        date.getUTCMonth() === Number(match[2]) - 1 &&
        date.getUTCDate() === Number(match[3])
        ? date
        : null
}

const formatDate = (date: Date): string =>
    new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(date)

const formatMonth = (value: string): string | null => {
    const match = value.match(/^(\d{4})-(\d{2})(?:-01)?$/)
    if (!match) return null
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
    if (date.getUTCMonth() !== Number(match[2]) - 1) return null
    return new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(date)
}

export const deriveReleaseTimeline = (
    release: RawPublicRelease
): PublicReleaseTimeline => {
    if (release.released_at) {
        const releasedAt = new Date(release.released_at)
        return {
            kind: 'released',
            label: `Released ${formatDate(releasedAt)}`,
            value: release.released_at,
        }
    }
    if (release.confirmed_date) {
        const date = parseCalendarDate(release.confirmed_date)
        return {
            kind: 'confirmed_date',
            label: date
                ? `Scheduled for ${formatDate(date)}`
                : 'Date to be announced.',
            value: release.confirmed_date,
        }
    }
    if (release.target_date) {
        const date = parseCalendarDate(release.target_date)
        return {
            kind: 'target_date',
            label: date
                ? `Targeting ${formatDate(date)}`
                : 'Date to be announced.',
            value: release.target_date,
        }
    }
    if (release.target_month) {
        const month = formatMonth(release.target_month)
        return {
            kind: 'target_month',
            label: month ? `Targeting ${month}` : 'Date to be announced.',
            value: release.target_month.slice(0, 7),
        }
    }
    return { kind: 'tbd', value: null, label: 'Date to be announced.' }
}

export const mapPublicRelease = (
    release: RawPublicRelease,
    notes: RawPublicReleaseNote[]
): PublicRelease => ({
    id: release.id,
    version: release.version,
    slug: release.slug,
    title: release.title,
    releaseType: release.release_type as ReleaseType,
    lifecycleStatus: release.lifecycle_status as PublicReleaseLifecycle,
    publicSummary: release.public_summary,
    timeline: deriveReleaseTimeline(release),
    releasedAt: release.released_at,
    notes: notes
        .sort(
            (left, right) =>
                left.sort_order - right.sort_order ||
                left.id.localeCompare(right.id)
        )
        .map(note => ({
            id: note.id,
            type: note.note_type as ReleaseNoteType,
            title: note.public_title,
            body: note.public_body,
            platforms: note.platforms as ReleasePlatform[],
            order: note.sort_order,
        })),
})
