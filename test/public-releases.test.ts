import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
    from: vi.fn(),
    results: [] as Array<{ data: unknown; error: unknown }>,
    builders: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
}))

vi.mock('../src/lib/db', () => ({
    db: { from: mockState.from },
    Tables: { RELEASES: 'releases', RELEASE_NOTES: 'release_notes' },
}))

import {
    compareVersions,
    PUBLIC_RELEASE_NOTE_SELECT,
    PUBLIC_RELEASE_SELECT,
} from '../src/lib/public-releases'
import { listPublicReleases } from '../src/services/public-releases'

const builderFor = (result: { data: unknown; error: unknown }) => {
    const builder = {
        select: vi.fn(),
        eq: vi.fn(),
        is: vi.fn(),
        in: vi.fn(),
        not: vi.fn(),
        contains: vi.fn(),
        then: vi.fn(),
    }
    Object.entries(builder).forEach(([name, fn]) => {
        if (name !== 'then') fn.mockReturnValue(builder)
    })
    builder.then.mockImplementation((resolve, reject) =>
        Promise.resolve(result).then(resolve, reject)
    )
    return builder
}

const release = (overrides: Record<string, unknown> = {}) => ({
    id: 'release-1',
    version: '1.1',
    slug: 'first-release',
    title: 'First release',
    release_type: 'minor',
    lifecycle_status: 'planned',
    public_summary: 'Public summary',
    target_month: null,
    target_date: null,
    confirmed_date: null,
    released_at: null,
    internal_name: 'must not leak',
    ...overrides,
})

const note = (overrides: Record<string, unknown> = {}) => ({
    id: 'note-1',
    release_id: 'release-1',
    note_type: 'feature',
    public_title: 'A feature',
    public_body: 'Feature details',
    platforms: ['ios', 'android'],
    sort_order: 0,
    technical_notes: 'must not leak',
    ...overrides,
})

describe('public release service', () => {
    beforeEach(() => {
        process.env.DOMANI_RELEASE_CURSOR_SECRET = 'test-only-cursor-secret'
        mockState.results = []
        mockState.builders = []
        mockState.from.mockReset()
        mockState.from.mockImplementation(() => {
            const builder = builderFor(
                mockState.results.shift() || { data: [], error: null }
            )
            mockState.builders.push(builder)
            return builder
        })
    })

    it('orders two- and three-part versions semantically', () => {
        expect(compareVersions('1.10', '1.2')).toBeGreaterThan(0)
        expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0)
    })

    it('enforces coming-soon eligibility and maps only public fields', async () => {
        mockState.results = [
            {
                data: [
                    release({ confirmed_date: '2026-08-12' }),
                    release({
                        id: 'release-2',
                        version: '1.2',
                        target_month: '2026-09-01',
                    }),
                ],
                error: null,
            },
            {
                data: [
                    note({ sort_order: 2 }),
                    note({ id: 'note-0', sort_order: 1 }),
                    note({ id: 'note-2', release_id: 'release-2' }),
                ],
                error: null,
            },
        ]

        const result = await listPublicReleases({
            collection: 'coming-soon',
            platform: null,
            limit: 20,
        })

        expect(mockState.from).toHaveBeenNthCalledWith(1, 'releases')
        expect(mockState.builders[0].select).toHaveBeenCalledWith(
            PUBLIC_RELEASE_SELECT
        )
        expect(mockState.builders[0].eq).toHaveBeenCalledWith(
            'visibility',
            'public_preview'
        )
        expect(mockState.builders[0].in).toHaveBeenCalledWith(
            'lifecycle_status',
            ['planned', 'in_progress']
        )
        expect(mockState.builders[1].select).toHaveBeenCalledWith(
            PUBLIC_RELEASE_NOTE_SELECT
        )
        expect(mockState.builders[1].eq).toHaveBeenCalledWith('is_public', true)
        expect(result.releases.map(item => item.id)).toEqual([
            'release-1',
            'release-2',
        ])
        expect(result.releases[0].timeline.label).toBe(
            'Scheduled for August 12, 2026'
        )
        expect(result.releases[1].timeline.label).toBe('Targeting September 2026')
        expect(result.releases[1].timeline).toEqual({
            kind: 'target_month',
            value: '2026-09',
            label: 'Targeting September 2026',
        })
        expect(result.releases[0].notes.map(item => item.id)).toEqual([
            'note-0',
            'note-1',
        ])
        expect(result.releases[0]).not.toHaveProperty('internal_name')
        expect(result.releases[0].notes[0]).not.toHaveProperty('technical_notes')
    })

    it('filters notes by platform and omits releases with no matching notes', async () => {
        mockState.results = [
            { data: [release(), release({ id: 'release-2' })], error: null },
            { data: [note()], error: null },
        ]
        const result = await listPublicReleases({
            collection: 'coming-soon',
            platform: 'ios',
            limit: 20,
        })
        expect(mockState.builders[1].contains).toHaveBeenCalledWith('platforms', [
            'ios',
        ])
        expect(result.releases).toHaveLength(1)
    })

    it('sorts changelog newest-first and returns a filter-bound cursor', async () => {
        mockState.results = [
            {
                data: [
                    release({ released_at: '2026-07-01T00:00:00Z' }),
                    release({
                        id: 'release-2',
                        version: '1.2',
                        released_at: '2026-08-01T00:00:00Z',
                    }),
                ],
                error: null,
            },
            {
                data: [note(), note({ id: 'note-2', release_id: 'release-2' })],
                error: null,
            },
        ]
        const first = await listPublicReleases({
            collection: 'changelog',
            platform: null,
            limit: 1,
        })
        expect(first.releases[0].id).toBe('release-2')
        expect(first.nextCursor).toEqual(expect.any(String))

        mockState.results = [
            {
                data: [
                    release({ released_at: '2026-07-01T00:00:00Z' }),
                    release({
                        id: 'release-2',
                        version: '1.2',
                        released_at: '2026-08-01T00:00:00Z',
                    }),
                ],
                error: null,
            },
            {
                data: [note(), note({ id: 'note-2', release_id: 'release-2' })],
                error: null,
            },
        ]
        await expect(
            listPublicReleases({
                collection: 'changelog',
                platform: 'ios',
                limit: 1,
                cursor: first.nextCursor!,
            })
        ).rejects.toMatchObject({
            status: 400,
            code: 'VALIDATION_ERROR',
            fieldErrors: {
                cursor: ['Cursor is invalid or does not match this request'],
            },
        })
    })

    it('surfaces Supabase failures', async () => {
        mockState.results = [{ data: null, error: new Error('database unavailable') }]
        await expect(
            listPublicReleases({
                collection: 'coming-soon',
                platform: null,
                limit: 20,
            })
        ).rejects.toThrow('database unavailable')
    })
})
