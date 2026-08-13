import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
    rpc: vi.fn()
}))

vi.mock('../src/lib/domani-db', () => ({
    domaniDb: { rpc: mockState.rpc }
}))

import {
    compareVersions,
    decodeReleaseCursor,
    encodeReleaseCursor,
    releaseVersionParts
} from '../src/lib/public-releases'
import { listPublicReleases } from '../src/services/public-releases'

const note = (overrides: Record<string, unknown> = {}) => ({
    id: 'note-1',
    note_type: 'feature',
    public_title: 'A feature',
    public_body: 'Feature details',
    platforms: ['ios', 'android'],
    sort_order: 0,
    technical_notes: 'must not leak',
    ...overrides
})

const release = (overrides: Record<string, unknown> = {}) => ({
    id: 'release-1',
    version: '1.1.0',
    slug: 'first-release',
    title: 'First release',
    release_type: 'minor',
    lifecycle_status: 'planned',
    public_summary: 'Public summary',
    target_month: null,
    target_date: null,
    confirmed_date: '2026-08-12',
    released_at: null,
    sort_primary: '2026-08-12',
    notes: [note()],
    internal_summary: 'must not leak',
    ...overrides
})

describe('public release service', () => {
    beforeEach(() => {
        process.env.DOMANI_RELEASE_CURSOR_SECRET = 'test-only-cursor-secret'
        mockState.rpc.mockReset()
    })

    it('orders canonical semantic versions numerically', () => {
        expect(compareVersions('1.10.0', '1.2.0')).toBeGreaterThan(0)
        expect(compareVersions('1.2.1', '1.2.0')).toBeGreaterThan(0)
        expect(releaseVersionParts('1.12.0')).toEqual([1, 12, 0])
    })

    it('requests a limit-plus-one keyset page and maps only public fields', async () => {
        mockState.rpc.mockResolvedValue({
            data: [
                release(),
                release({
                    id: 'release-2',
                    version: '1.2.0',
                    confirmed_date: null,
                    target_month: '2026-09-01',
                    sort_primary: '2026-09-01',
                    notes: [note({ id: 'note-2' })]
                })
            ],
            error: null
        })

        const result = await listPublicReleases({
            collection: 'coming-soon',
            platform: null,
            limit: 1
        })

        expect(mockState.rpc).toHaveBeenCalledWith(
            'list_public_domani_releases',
            {
                p_collection: 'coming-soon',
                p_platform: null,
                p_page_limit: 1,
                p_cursor_primary: null,
                p_cursor_version_major: null,
                p_cursor_version_minor: null,
                p_cursor_version_patch: null,
                p_cursor_id: null
            }
        )
        expect(result.releases).toHaveLength(1)
        expect(result.nextCursor).toEqual(expect.any(String))
        expect(result.releases[0].timeline).toEqual({
            kind: 'confirmed_date',
            value: '2026-08-12',
            label: 'Scheduled for August 12, 2026'
        })
        expect(result.releases[0]).not.toHaveProperty('internal_summary')
        expect(result.releases[0].notes[0]).not.toHaveProperty(
            'technical_notes'
        )
    })

    it('validates and binds a cursor before issuing the RPC', async () => {
        const cursor = encodeReleaseCursor('changelog', 'ios', {
            primary: '2026-08-01 00:00:00+00',
            version: '1.12.0',
            id: '20000000-0000-4000-8000-000000000002'
        })
        mockState.rpc.mockResolvedValue({ data: [], error: null })

        await listPublicReleases({
            collection: 'changelog',
            platform: 'ios',
            limit: 20,
            cursor
        })

        expect(mockState.rpc).toHaveBeenCalledWith(
            'list_public_domani_releases',
            expect.objectContaining({
                p_cursor_primary: '2026-08-01 00:00:00+00',
                p_cursor_version_major: 1,
                p_cursor_version_minor: 12,
                p_cursor_version_patch: 0,
                p_cursor_id: '20000000-0000-4000-8000-000000000002'
            })
        )

        await expect(
            listPublicReleases({
                collection: 'changelog',
                platform: 'android',
                limit: 20,
                cursor
            })
        ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' })
        expect(mockState.rpc).toHaveBeenCalledTimes(1)
    })

    it('rejects noncanonical base64url signatures', () => {
        const cursor = encodeReleaseCursor('coming-soon', null, {
            primary: null,
            version: '1.1.0',
            id: '20000000-0000-4000-8000-000000000001'
        })
        expect(() =>
            decodeReleaseCursor(`${cursor}!`, 'coming-soon', null)
        ).toThrowError(
            expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR' })
        )
    })

    it('returns the predictable empty state and surfaces RPC failures', async () => {
        mockState.rpc.mockResolvedValueOnce({ data: [], error: null })
        await expect(
            listPublicReleases({
                collection: 'coming-soon',
                platform: null,
                limit: 20
            })
        ).resolves.toEqual({ releases: [], nextCursor: null })

        mockState.rpc.mockResolvedValueOnce({
            data: null,
            error: new Error('database unavailable')
        })
        await expect(
            listPublicReleases({
                collection: 'coming-soon',
                platform: null,
                limit: 20
            })
        ).rejects.toThrow('database unavailable')
    })
})
