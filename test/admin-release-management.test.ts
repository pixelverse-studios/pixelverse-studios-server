import crypto from 'crypto'
import express, { Request, Response } from 'express'
import { request as httpRequest } from 'http'
import { AddressInfo } from 'net'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('../src/lib/db', () => {
    const roleQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: state.maybeSingle }
    roleQuery.select.mockReturnValue(roleQuery)
    roleQuery.eq.mockReturnValue(roleQuery)
    return {
        db: { rpc: state.rpc, auth: { getUser: state.getUser }, from: vi.fn(() => roleQuery) },
        Tables: { DASHBOARD_USER_ROLES: 'dashboard_user_roles' },
    }
})

import {
    approveSource,
    createNote,
    createRelease,
    listReleases,
    releaseAction,
    reorderNotes,
    updateNote,
} from '../src/controllers/admin-release-management'
import { dispatchReleaseCacheInvalidations } from '../src/services/release-cache-invalidation'
import adminReleaseManagementRouter from '../src/routes/admin-release-management'
import { nextCursor, pagination } from '../src/lib/admin-release-management'

const releaseId = 'a1000000-0000-4000-8000-000000000001'
const noteId = 'a1000000-0000-4000-8000-000000000002'
const sourceId = 'a1000000-0000-4000-8000-000000000003'

const request = (overrides: Partial<Request> = {}): Request => {
    const headers: Record<string, string> = { 'if-match': '"4"' }
    return {
        params: { releaseId, noteId, prdId: sourceId },
        query: {},
        body: {},
        requestId: 'request-1042',
        dashboardActor: { userId: 'a1000000-0000-4000-8000-000000000004', email: 'admin@example.com', role: 'admin' },
        get: vi.fn((name: string) => headers[name.toLowerCase()]),
        ...overrides,
    } as unknown as Request
}

const response = () => {
    const headers: Record<string, string> = {}
    const res = {
        statusCode: 200,
        payload: undefined as any,
        setHeader: vi.fn((name: string, value: string) => { headers[name.toLowerCase()] = value; return res }),
        getHeader: vi.fn((name: string) => headers[name.toLowerCase()]),
        status: vi.fn((status: number) => { res.statusCode = status; return res }),
        json: vi.fn((payload: unknown) => { res.payload = payload; return res }),
        headers,
    }
    return res as unknown as Response & typeof res
}

const mutation = (data: Record<string, unknown> = { release: { rowVersion: 5 } }) => ({
    data,
    releaseRowVersion: 5,
    primaryRowVersion: 5,
    cacheInvalidation: {
        jobId: 'a1000000-0000-4000-8000-000000000005',
        status: 'pending',
        targets: ['/api/domani/releases/changelog', '/changelog'],
    },
})

beforeEach(() => {
    process.env.ADMIN_RELEASE_CURSOR_SECRET = 'test-secret-at-least-long-enough'
    state.rpc.mockReset().mockResolvedValue({ data: mutation(), error: null })
    state.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'a1000000-0000-4000-8000-000000000004', email: 'admin@example.com' } }, error: null })
    state.maybeSingle.mockReset().mockResolvedValue({ data: { user_id: 'a1000000-0000-4000-8000-000000000004', role: 'admin', is_active: true }, error: null })
})

describe('DEV-1042 authenticated HTTP routes', () => {
    it('serves the list through bearer auth and blocks a viewer mutation', async () => {
        const app = express()
        app.use((req, _res, next) => { req.requestId = 'request-1042-http'; next() })
        app.use(adminReleaseManagementRouter)
        const server = app.listen(0, '127.0.0.1')
        await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
        const send = (method: string, path: string, body?: Record<string, unknown>) => new Promise<{ status: number; payload: any }>((resolve, reject) => {
            const encoded = body ? JSON.stringify(body) : ''
            const address = server.address() as AddressInfo
            const outgoing = httpRequest({ host: '127.0.0.1', port: address.port, path, method, headers: { Authorization: 'Bearer valid-token', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}) } }, incoming => {
                const chunks: Buffer[] = []
                incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
                incoming.on('end', () => resolve({ status: incoming.statusCode || 0, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
            })
            outgoing.on('error', reject)
            outgoing.end(encoded)
        })
        try {
            state.rpc.mockResolvedValueOnce({ data: { releases: [], last: null }, error: null })
            const list = await send('GET', '/api/admin/releases')
            expect(list.status).toBe(200)
            expect(list.payload.data.releases).toEqual([])
            expect(state.getUser).toHaveBeenCalledWith('valid-token')

            state.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'a1000000-0000-4000-8000-000000000004', role: 'viewer', is_active: true }, error: null })
            const create = await send('POST', '/api/admin/releases', { version: '1.2', slug: 'viewer-denied', title: 'Viewer denied', releaseType: 'minor' })
            expect(create.status).toBe(403)
            expect(create.payload.error.code).toBe('FORBIDDEN')
        } finally {
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        }
    })
})

describe('DEV-1042 release management controllers', () => {
    it('creates only allowlisted private-draft release input and emits concurrency headers', async () => {
        const res = response()
        await createRelease(request({ body: { version: '1.2', slug: 'calm-planning', title: 'Calm planning', releaseType: 'minor', actorRole: 'admin' } }), res)
        expect(res.statusCode).toBe(400)
        expect(res.payload.error.fieldErrors.actorRole).toEqual(['Field is not allowed'])
        expect(state.rpc).not.toHaveBeenCalled()

        await createRelease(request({ body: { version: '1.2', slug: 'calm-planning', title: 'Calm planning', releaseType: 'minor' } }), res)
        expect(res.statusCode).toBe(201)
        expect(res.headers.etag).toBe('"5"')
        expect(res.headers['x-release-etag']).toBe('"5"')
        expect(res.payload.meta.cacheInvalidation.status).toBe('pending')
        expect(state.rpc).toHaveBeenCalledWith('mutate_admin_domani_release', expect.objectContaining({ p_operation: 'release.create', p_primary_if_match: null }))
    })

    it('requires quoted If-Match for state changes and passes the locked version', async () => {
        const missing = response()
        await releaseAction('release.publish')(request({ get: vi.fn(() => undefined) }), missing)
        expect(missing.statusCode).toBe(428)
        expect(missing.payload.error.code).toBe('PRECONDITION_REQUIRED')

        const valid = response()
        await releaseAction('release.publish')(request(), valid)
        expect(state.rpc).toHaveBeenCalledWith('mutate_admin_domani_release', expect.objectContaining({ p_operation: 'release.publish', p_primary_if_match: 4 }))
    })

    it('rejects unsafe public Markdown before any write', async () => {
        const res = response()
        await createNote(request({ body: { noteType: 'feature', publicTitle: 'Unsafe', publicBody: '<img src=x onerror=alert(1)>', platforms: ['ios'], isPublic: true } }), res)
        expect(res.statusCode).toBe(422)
        expect(res.payload.error.code).toBe('UNSAFE_PUBLIC_MARKDOWN')
        expect(state.rpc).not.toHaveBeenCalled()
    })

    it('normalizes public Markdown line endings before create and update writes', async () => {
        await createNote(request({ body: { noteType: 'feature', publicTitle: 'Canonical', publicBody: 'First\r\nsecond\rthird', platforms: ['ios'] } }), response())
        expect(state.rpc).toHaveBeenLastCalledWith('mutate_admin_domani_release', expect.objectContaining({
            p_operation: 'note.create',
            p_payload: expect.objectContaining({ publicBody: 'First\nsecond\nthird' }),
        }))

        await updateNote(request({ body: { releaseRowVersion: 9, publicBody: 'Updated\r\nbody' } }), response())
        expect(state.rpc).toHaveBeenLastCalledWith('mutate_admin_domani_release', expect.objectContaining({
            p_operation: 'note.update',
            p_payload: expect.objectContaining({ publicBody: 'Updated\nbody' }),
        }))
    })

    it('protects note and aggregate versions independently', async () => {
        const res = response()
        await updateNote(request({ body: { releaseRowVersion: 9, publicTitle: 'Updated' } }), res)
        expect(state.rpc).toHaveBeenCalledWith('mutate_admin_domani_release', expect.objectContaining({
            p_operation: 'note.update', p_primary_if_match: 4,
            p_payload: expect.objectContaining({ noteId, releaseRowVersion: 9 }),
        }))
    })

    it('sends the complete note set and source approval versions to one atomic RPC', async () => {
        await reorderNotes(request({ body: { notes: [{ id: noteId, rowVersion: 2 }] } }), response())
        expect(state.rpc).toHaveBeenLastCalledWith('mutate_admin_domani_release', expect.objectContaining({ p_operation: 'note.reorder', p_primary_if_match: 4 }))

        await approveSource(request({ body: { releaseRowVersion: 7, noteRowVersions: [{ id: noteId, rowVersion: 2 }] } }), response())
        expect(state.rpc).toHaveBeenLastCalledWith('mutate_admin_domani_release', expect.objectContaining({
            p_operation: 'source.approve', p_primary_if_match: 4,
            p_payload: expect.objectContaining({ sourceId, releaseRowVersion: 7 }),
        }))
    })

    it('binds cursor pagination to the exact active filters', async () => {
        state.rpc.mockResolvedValueOnce({ data: { releases: [], last: null }, error: null })
        const res = response()
        await listReleases(request({ query: { lifecycle: 'planned', archived: 'false', limit: '10' } }), res)
        expect(res.statusCode).toBe(200)
        expect(res.payload.data.filters).toEqual(expect.objectContaining({ lifecycle: 'planned', archived: false }))
        expect(state.rpc).toHaveBeenCalledWith('list_admin_domani_releases', expect.objectContaining({ p_limit: 10 }))
    })

    it('versions signed cursors and rejects cursors from another API contract', () => {
        const filters = { lifecycle: 'planned', archived: false }
        const item = { orderedAt: '2026-08-09T16:00:00.000Z', id: releaseId }
        const cursor = nextCursor(filters, item)
        expect(cursor).not.toBeNull()
        const [encoded] = cursor!.split('.')
        expect(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))).toEqual(expect.objectContaining({ apiVersion: '2026-08-05' }))
        expect(pagination({ cursor }, filters).after).toEqual(item)

        const oldPayload = Buffer.from(JSON.stringify({ apiVersion: '2026-07-01', filters, ...item })).toString('base64url')
        const oldSignature = crypto.createHmac('sha256', process.env.ADMIN_RELEASE_CURSOR_SECRET!).update(oldPayload).digest('base64url')
        expect(() => pagination({ cursor: `${oldPayload}.${oldSignature}` }, filters)).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
    })

    it('maps transaction conflicts without exposing database sentinels', async () => {
        state.rpc.mockResolvedValueOnce({ data: null, error: { message: 'DEV1042_VERSION_CONFLICT' } })
        const res = response()
        await releaseAction('release.publish')(request(), res)
        expect(res.statusCode).toBe(409)
        expect(res.payload.error.code).toBe('VERSION_CONFLICT')
        expect(JSON.stringify(res.payload)).not.toContain('DEV1042')
    })
})

describe('DEV-1042 durable cache invalidation dispatcher', () => {
    const job = {
        id: 'a1000000-0000-4000-8000-000000000010',
        release_id: releaseId,
        targets: ['/api/domani/releases/changelog', '/changelog'],
        attempt_count: 1,
    }

    it('claims and completes a delivered job through an idempotent adapter', async () => {
        state.rpc.mockReset()
            .mockResolvedValueOnce({ data: [job], error: null })
            .mockResolvedValueOnce({ data: null, error: null })
        const invalidator = { invalidate: vi.fn().mockResolvedValue(undefined) }
        expect(await dispatchReleaseCacheInvalidations(invalidator)).toBe(1)
        expect(invalidator.invalidate).toHaveBeenCalledWith(job)
        expect(state.rpc).toHaveBeenNthCalledWith(2, 'complete_release_cache_invalidation_job', { p_job_id: job.id })
    })

    it('records a retryable failure without asking the caller to repeat the mutation', async () => {
        state.rpc.mockReset()
            .mockResolvedValueOnce({ data: [{ ...job, attempt_count: 3 }], error: null })
            .mockResolvedValueOnce({ data: null, error: null })
            .mockResolvedValueOnce({ data: 'request-cache-1042', error: null })
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const invalidator = { invalidate: vi.fn().mockRejectedValue(new Error('receiver unavailable')) }
        expect(await dispatchReleaseCacheInvalidations(invalidator)).toBe(1)
        expect(state.rpc).toHaveBeenNthCalledWith(2, 'fail_release_cache_invalidation_job', {
            p_job_id: job.id,
            p_error: 'receiver unavailable',
        })
        expect(state.rpc).toHaveBeenNthCalledWith(3, 'release_cache_invalidation_request_id', { p_job_id: job.id })
        expect(console.error).toHaveBeenCalledWith('Release cache invalidation requires attention:', expect.objectContaining({ requestId: 'request-cache-1042', attemptCount: 3 }))
    })
})
