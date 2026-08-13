import { execFileSync } from 'child_process'
import { Request, Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
    maybeSingle: vi.fn(),
    rpc: vi.fn()
}))

vi.mock('../src/lib/domani-db', () => {
    const query = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: mockState.maybeSingle
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    return {
        domaniDb: { from: vi.fn(() => query), rpc: mockState.rpc },
        DomaniTables: { RELEASE_PRDS: 'release_prds' }
    }
})

import { convertMarkdown } from '../src/controllers/admin-release-conversion'
import { normalizeConvertMarkdownRequest } from '../src/lib/admin-releases'
import {
    convertReleaseMarkdown,
    isSafeReleaseNoteMarkdown
} from '../src/lib/release-markdown-converter'

const releaseId = '91000000-0000-4000-8000-000000000001'
const prdId = '91000000-0000-4000-8000-000000000002'
const actorId = '91000000-0000-4000-8000-000000000003'

const request = (overrides: Partial<Request> = {}): Request => {
    const headers: Record<string, string> = { 'if-match': '"1"' }
    return {
        params: { releaseId, prdId },
        body: { rewriteMode: 'deterministic', releaseRowVersion: 2 },
        requestId: 'request-1009',
        dashboardActor: {
            userId: actorId,
            email: 'editor@example.com',
            role: 'editor'
        },
        get: vi.fn((name: string) => headers[name.toLowerCase()]),
        ...overrides
    } as unknown as Request
}

const response = () => {
    const headers: Record<string, string> = {}
    const res = {
        statusCode: 200,
        payload: undefined as any,
        setHeader: vi.fn((name: string, value: string) => {
            headers[name.toLowerCase()] = value
            return res
        }),
        getHeader: vi.fn((name: string) => headers[name.toLowerCase()]),
        status: vi.fn((status: number) => {
            res.statusCode = status
            return res
        }),
        json: vi.fn((payload: unknown) => {
            res.payload = payload
            return res
        }),
        headers
    }
    return res as unknown as Response & typeof res
}

const conversionResult = {
    source: {
        id: prdId,
        releaseId,
        rawMarkdown: '## Feature: Calm setup\n\nA guided setup.',
        originalFilename: 'release.md',
        sourceType: 'manual',
        sourceReference: 'DEV-1009',
        sourceContentSha256: 'a'.repeat(64),
        intendedSurface: 'changelog',
        conversionStatus: 'needs_review',
        latestConversionRunId: '91000000-0000-4000-8000-000000000004',
        conversionErrorCode: null,
        conversionErrorMessage: null,
        rowVersion: 2,
        createdAt: '2026-08-07T15:00:00Z',
        updatedAt: '2026-08-07T15:01:00Z'
    },
    conversionRun: {
        id: '91000000-0000-4000-8000-000000000004',
        sourceContentSha256: 'a'.repeat(64),
        converterVersion: 'domani-markdown-v1',
        provider: null,
        model: null,
        status: 'succeeded',
        createdAt: '2026-08-07T15:01:00Z',
        completedAt: '2026-08-07T15:01:01Z',
        resultingNoteIds: ['91000000-0000-4000-8000-000000000005']
    },
    notes: [],
    releaseRowVersion: 3
}

beforeEach(() => {
    mockState.maybeSingle.mockReset().mockResolvedValue({
        data: { raw_markdown: '## Feature: Calm setup\n\nA guided setup.' },
        error: null
    })
    mockState.rpc
        .mockReset()
        .mockResolvedValue({ data: conversionResult, error: null })
})

describe('DEV-1009 deterministic Markdown conversion', () => {
    it('loads its Markdown parser from the project CommonJS runtime', () => {
        expect(() =>
            execFileSync(process.execPath, ['-e', "require('marked')"], {
                cwd: process.cwd(),
                stdio: 'pipe'
            })
        ).not.toThrow()
    })

    it('parses ATX and Setext headings, maps types, and removes unsafe constructs', () => {
        const notes = convertReleaseMarkdown(
            [
                '# Release',
                '',
                'Feature: Guided setup',
                '---------------------',
                '',
                'Choose [safe help](https://example.com) and [bad help](JaVaScRiPt:alert(1)).',
                '',
                '```md',
                '## Fix: Hidden code heading',
                '```',
                '',
                '## Fix: Crash recovery',
                '',
                '- Restores the plan',
                '<img src=x onerror=alert(1)>'
            ].join('\n')
        )

        expect(notes).toHaveLength(2)
        expect(notes[0]).toMatchObject({
            noteType: 'feature',
            publicTitle: 'Guided setup',
            platforms: ['ios', 'android']
        })
        expect(notes[0].publicBody).toContain(
            '[safe help](https://example.com)'
        )
        expect(notes[0].publicBody).toContain('bad help')
        expect(notes[0].publicBody).not.toMatch(/javascript|<img|onerror/i)
        expect(notes[1]).toMatchObject({
            noteType: 'fix',
            publicTitle: 'Crash recovery'
        })
        expect(notes[1].publicBody).toBe('- Restores the plan')
    })

    it('falls back to top-level list items and rejects empty or excessive input', () => {
        expect(
            convertReleaseMarkdown('- First improvement\n- Second improvement')
        ).toHaveLength(2)
        expect(() => convertReleaseMarkdown('# Release only')).toThrowError(
            expect.objectContaining({ code: 'NO_CONVERSION_CANDIDATES' })
        )
        const excessive = Array.from(
            { length: 101 },
            (_, index) => `## Fix: Item ${index}\n\nBody`
        ).join('\n\n')
        expect(() => convertReleaseMarkdown(excessive)).toThrowError(
            expect.objectContaining({ code: 'TOO_MANY_CONVERSION_CANDIDATES' })
        )
    })

    it('preserves the safe-Markdown invariant when limiting long generated bodies', () => {
        const unsafeTag = '<img src=x onerror=alert(1)>'
        const prefix = 'a'.repeat(4000 - 1 - unsafeTag.length)
        const markdown = `## Long body\n\n${prefix}\`${unsafeTag}\``
        const [note] = convertReleaseMarkdown(markdown)

        expect(Array.from(note.publicBody)).toHaveLength(4000)
        expect(isSafeReleaseNoteMarkdown(note.publicBody)).toBe(true)
        expect(note.publicBody).not.toContain('<img')
        expect(note.publicBody).toContain('&lt;img')
    })

    it('preserves escaped block markers as literal paragraph content', () => {
        const [heading] = convertReleaseMarkdown(
            '## Feature\n\n\\# literal heading'
        )
        const [bullet] = convertReleaseMarkdown(
            '## Feature\n\n\\- literal bullet'
        )
        const [ordered] = convertReleaseMarkdown(
            '## Feature\n\n1\\. literal ordered item'
        )

        expect(heading.publicBody).toBe('\\# literal heading')
        expect(bullet.publicBody).toBe('\\- literal bullet')
        expect(ordered.publicBody).toBe('1\\. literal ordered item')
        expect(
            [heading, bullet, ordered].every(note =>
                isSafeReleaseNoteMarkdown(note.publicBody)
            )
        ).toBe(true)
    })

    it('round-trips code spans that contain backticks', () => {
        const [note] = convertReleaseMarkdown('## Feature\n\n``a`b``')

        expect(note.publicBody).toBe('``a`b``')
        expect(isSafeReleaseNoteMarkdown(note.publicBody)).toBe(true)
    })
})

describe('DEV-1009 conversion request and controller', () => {
    it('requires source and release versions and rejects unknown fields', () => {
        expect(normalizeConvertMarkdownRequest(request())).toMatchObject({
            releaseId,
            prdId,
            rewriteMode: 'deterministic',
            sourceIfMatch: 1,
            releaseRowVersion: 2
        })
        expect(() =>
            normalizeConvertMarkdownRequest(
                request({ get: vi.fn(() => undefined) })
            )
        ).toThrowError(
            expect.objectContaining({ code: 'PRECONDITION_REQUIRED' })
        )
        expect(() =>
            normalizeConvertMarkdownRequest(
                request({ body: { releaseRowVersion: 2, actorRole: 'admin' } })
            )
        ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
    })

    it('returns the locked response and sends deterministic drafts to the atomic RPC', async () => {
        const res = response()
        await convertMarkdown(request(), res)

        expect(res.statusCode).toBe(200)
        expect(res.headers.etag).toBe('"2"')
        expect(res.headers['x-release-etag']).toBe('"3"')
        expect(res.payload.data.conversionRun.status).toBe('succeeded')
        expect(mockState.rpc).toHaveBeenCalledWith(
            'convert_domani_release_markdown',
            expect.objectContaining({
                p_source_if_match: 1,
                p_release_if_match: 2,
                p_converter_version: 'domani-markdown-v1',
                p_failure_code: null,
                p_notes: [
                    expect.objectContaining({
                        noteType: 'feature',
                        publicTitle: 'Calm setup',
                        publicBody: 'A guided setup.'
                    })
                ]
            })
        )
    })

    it('records deterministic content failures atomically and returns a safe 422', async () => {
        mockState.maybeSingle.mockResolvedValueOnce({
            data: { raw_markdown: '# Empty' },
            error: null
        })
        mockState.rpc.mockResolvedValueOnce({
            data: { failed: true },
            error: null
        })
        const res = response()
        await convertMarkdown(request(), res)

        expect(res.statusCode).toBe(422)
        expect(res.payload.error.code).toBe('CONVERSION_FAILED')
        expect(mockState.rpc).toHaveBeenCalledWith(
            'convert_domani_release_markdown',
            expect.objectContaining({
                p_notes: null,
                p_failure_code: 'NO_CONVERSION_CANDIDATES'
            })
        )
    })

    it('rejects unavailable provider mode before reading or mutating source data', async () => {
        const res = response()
        await convertMarkdown(
            request({
                body: { rewriteMode: 'provider_assisted', releaseRowVersion: 2 }
            }),
            res
        )
        expect(res.statusCode).toBe(503)
        expect(mockState.maybeSingle).not.toHaveBeenCalled()
        expect(mockState.rpc).not.toHaveBeenCalled()
    })

    it('maps stale and published-boundary RPC failures without leaking database codes', async () => {
        mockState.rpc.mockResolvedValueOnce({
            data: null,
            error: { message: 'DEV1009_RELEASE_VERSION_CONFLICT' }
        })
        const stale = response()
        await convertMarkdown(request(), stale)
        expect(stale.statusCode).toBe(409)
        expect(stale.payload.error.code).toBe('VERSION_CONFLICT')
        expect(JSON.stringify(stale.payload)).not.toContain('DEV1009')

        mockState.rpc.mockResolvedValueOnce({
            data: null,
            error: { message: 'DEV1009_PUBLISHED_ADMIN_REQUIRED' }
        })
        const published = response()
        await convertMarkdown(request(), published)
        expect(published.statusCode).toBe(403)
        expect(published.payload.error.code).toBe(
            'PUBLISHED_CONTENT_ADMIN_REQUIRED'
        )
    })
})
