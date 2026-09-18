import express, { Request, Response } from 'express'
import { request as httpRequest } from 'http'
import { AddressInfo } from 'net'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), support: vi.fn() }))
vi.mock('../src/lib/db', () => ({ db: { auth: { getUser: mocks.getUser } } }))
vi.mock('../src/lib/domani-db', () => ({
    domaniDb: { rpc: mocks.rpc, from: mocks.from },
    DomaniTables: { DASHBOARD_FEEDBACK: 'dashboard_domani_feedback' },
    PLATFORMS: ['ios', 'android'], SIGNUP_COHORTS: ['public'],
}))
vi.mock('../src/controllers/domani', () => ({ default: {
    listSupportRequests: mocks.support, listWaitlist: vi.fn(), unsubscribe: vi.fn(), unsubscribeUser: vi.fn(), listUsers: vi.fn(),
} }))
import { feedbackIdentitySchema, feedbackQuerySchema } from '../src/lib/domani-feedback'
import * as controller from '../src/controllers/domani-feedback'
import router from '../src/routes/domani-feedback'
import legacyRouter from '../src/routes/domani'

const id = 'a1000000-0000-4000-8000-000000000001'
const actor = { userId: 'a1000000-0000-4000-8000-000000000002', email: 'staff@pvs.test', role: 'admin' as const }
const request = (overrides: Partial<Request> = {}) => ({ params: { source: 'beta_feedback', id }, query: {}, body: {}, dashboardActor: actor, ...overrides }) as Request
const response = () => {
    const res = { status: vi.fn(), json: vi.fn() }
    res.status.mockReturnValue(res)
    return res as unknown as Response
}
beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: { data: [], stats: { total: 0 } }, error: null })
    const chain = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.maybeSingle }
    mocks.from.mockReturnValue(chain)
    mocks.select.mockReturnValue(chain)
    mocks.eq.mockReturnValue(chain)
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    process.env.DOMANI_DASHBOARD_STAFF_EMAILS = actor.email
    mocks.getUser.mockResolvedValue({ data: { user: { id: actor.userId, email: actor.email } }, error: null })
})

describe('feedback input contract', () => {
    it('normalizes date bounds, whitespace and numeric query strings', () => {
        expect(feedbackQuerySchema.parse({ search: ' hello ', start_date: '2026-09-01', end_date: '2026-09-17', limit: '10', offset: '20' })).toEqual({ search: 'hello', start_date: '2026-09-01T00:00:00.000Z', end_date: '2026-09-18T00:00:00.000Z', end_date_exclusive: true, limit: 10, offset: 20, sort_by: 'created_at', sort_order: 'desc' })
    })
    it('keeps timestamp end bounds inclusive and allows times within a date-only end day', () => {
        expect(feedbackQuerySchema.parse({ end_date: '2026-09-17T12:00:00Z' })).toMatchObject({ end_date: '2026-09-17T12:00:00.000Z' })
        expect(feedbackQuerySchema.parse({ end_date: '2026-09-17T12:00:00Z' })).not.toHaveProperty('end_date_exclusive')
        expect(feedbackQuerySchema.safeParse({ start_date: '2026-09-17T12:00:00Z', end_date: '2026-09-17' }).success).toBe(true)
        expect(feedbackQuerySchema.parse({ end_date: '2026-12-31' }).end_date).toBe('2027-01-01T00:00:00.000Z')
    })
    it.each([
        { end_date_exclusive: true }, { limit: '0' }, { limit: '101' }, { limit: '1.5' }, { offset: '-1' }, { offset: '1000001' },
        { limit: ['10'] }, { offset: [] }, { source: ['beta_feedback'] }, { search: ['text'] },
        { search: 'x'.repeat(201) }, { start_date: '2026-02-30' }, { end_date: '2026-02-30' },
        { start_date: '2026-02-30T12:00:00Z' }, { start_date: '2026-09-01T12:00:00' },
        { start_date: '2026-09-18', end_date: '2026-09-17' }, { author: 'forged' }, { sort_by: 'email' },
    ])('rejects invalid query %j', input => {
        expect(feedbackQuerySchema.safeParse(input).success).toBe(false)
    })
    it.each(['beta_feedback', 'support_request'])('keeps source-qualified identity for %s', source => {
        expect(feedbackIdentitySchema.parse({ source, id })).toEqual({ source, id })
    })
    it.each([{ source: 'other', id }, { source: 'beta_feedback', id: 'bad' }, { id }])('rejects ambiguous or invalid identity %j', input => {
        expect(feedbackIdentitySchema.safeParse(input).success).toBe(false)
    })
})

describe('feedback controllers and data calls', () => {
    it('passes normalized filters to the list RPC and returns the full response', async () => {
        const res = response()
        await controller.list(request({ query: { source: 'support_request', search: ' test ', limit: '5' } }), res)
        expect(mocks.rpc).toHaveBeenCalledWith('list_dashboard_domani_feedback_with_conversations', { p_actor_id: actor.userId, p_query: { source: 'support_request', search: 'test', limit: 5, offset: 0, sort_by: 'created_at', sort_order: 'desc' } })
        expect(res.json).toHaveBeenCalledWith({ data: [], stats: { total: 0 } })
    })
    it('uses active filters for statistics independently of requested pagination', async () => {
        const res = response()
        await controller.stats(request({ query: { status: 'new', limit: '50', offset: '200' } }), res)
        expect(mocks.rpc).toHaveBeenCalledWith('list_dashboard_domani_feedback_with_conversations', { p_actor_id: actor.userId, p_query: expect.objectContaining({ status: 'new', limit: 1, offset: 0 }) })
        expect(res.json).toHaveBeenCalledWith({ total: 0 })
    })
    it('looks up details by both source and id, including legacy query-source form', async () => {
        mocks.rpc.mockResolvedValue({ data: { source: 'support_request', id }, error: null })
        const res = response()
        await controller.detail(request({ params: { id }, query: { source: 'support_request' } }), res)
        expect(mocks.rpc).toHaveBeenCalledWith('get_dashboard_domani_feedback', { p_source: 'support_request', p_id: id, p_actor_id: actor.userId })
        expect(res.json).toHaveBeenCalledWith({ source: 'support_request', id })
    })
    it('returns 404 for missing detail', async () => {
        mocks.rpc.mockResolvedValue({ data: null, error: null })
        const res = response()
        await controller.detail(request(), res)
        expect(res.status).toHaveBeenCalledWith(404)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'FEEDBACK_NOT_FOUND' }) }))
    })
    it.each([{ status: 'resolved', author: 'forged' }, { status: 'resolved', source: 'support_request' }, { status: 'invalid' }])('rejects unsafe mutation body %j', async body => {
        const res = response()
        await controller.updateStatus(request({ body }), res)
        expect(res.status).toHaveBeenCalledWith(400)
        expect(mocks.rpc).not.toHaveBeenCalled()
    })
    it.each([true, false])('maps a valid status change to authenticated actor (legacy=%s)', async legacy => {
        const res = response()
        await controller.updateStatus(request({ params: legacy ? { id } : { source: 'support_request', id }, body: { status: 'reviewed', ...(legacy ? { source: 'support_request' } : {}) } }), res)
        expect(mocks.rpc).toHaveBeenCalledWith('set_dashboard_domani_feedback_status', { p_source: 'support_request', p_id: id, p_status: 'reviewed', p_actor_id: actor.userId, p_actor_email: actor.email })
    })
    it('does not mutate without the authenticated actor', async () => {
        const res = response()
        await controller.updateStatus(request({ body: { status: 'resolved' }, dashboardActor: undefined }), res)
        expect(res.status).toHaveBeenCalledWith(401)
        expect(mocks.rpc).not.toHaveBeenCalled()
    })
    it('returns 404 when the update target disappeared', async () => {
        mocks.rpc.mockResolvedValue({ data: null, error: null })
        const res = response()
        await controller.updateStatus(request({ body: { status: 'resolved' } }), res)
        expect(res.status).toHaveBeenCalledWith(404)
    })
    it('sanitizes database errors instead of exposing service details', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private SQL and credentials' } })
        const res = response()
        await controller.list(request(), res)
        expect(res.status).toHaveBeenCalledWith(503)
        expect(JSON.stringify(vi.mocked(res.json).mock.calls)).not.toContain('private SQL')
    })
})

describe('feedback HTTP authorization boundary', () => {
    it('guards every feedback route, future prefix paths, and legacy support before database access', async () => {
        const app = express()
        app.use(router, legacyRouter)
        const server = app.listen(0, '127.0.0.1')
        await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
        const send = (method: string, path: string) => new Promise<{ status: number; cache: string | undefined }>((resolve, reject) => {
            const outgoing = httpRequest({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path, method }, incoming => {
                incoming.resume()
                incoming.on('end', () => resolve({ status: incoming.statusCode || 0, cache: incoming.headers['cache-control'] }))
            })
            outgoing.on('error', reject)
            outgoing.end()
        })
        try {
            for (const [method, path] of [
                ['GET', '/api/domani/feedback'], ['GET', '/api/domani/feedback/stats'],
                ['GET', `/api/domani/feedback/beta_feedback/${id}`], ['GET', `/api/domani/feedback/${id}`],
                ['PATCH', `/api/domani/feedback/beta_feedback/${id}/status`], ['PATCH', `/api/domani/feedback/${id}/status`],
                ['GET', `/api/domani/feedback/beta_feedback/${id}/messages`], ['PATCH', `/api/domani/feedback/beta_feedback/${id}/read`],
                ['POST', `/api/domani/feedback/beta_feedback/${id}/future-reply`], ['GET', '/api/domani/support'],
            ]) expect(await send(method, path)).toEqual({ status: 401, cache: 'no-store' })
            expect(mocks.rpc).not.toHaveBeenCalled()
            expect(mocks.from).not.toHaveBeenCalled()
            expect(mocks.support).not.toHaveBeenCalled()
        } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
    })
})

describe('feedback owns JSON parsing before the global parser', () => {
    it.each([
        { body: JSON.stringify({ status: 'resolved', padding: 'x'.repeat(8192) }), status: 413, code: 'PAYLOAD_TOO_LARGE' },
        { body: '{"status":"resolved", private malformed input', status: 400, code: 'INVALID_JSON' },
    ])('rejects invalid request bodies with $status before mutations', async scenario => {
        const app = express()
        app.use(router)
        app.use(express.json())
        const server = app.listen(0, '127.0.0.1')
        await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
        try {
            const result = await new Promise<{ status: number; cache: string | undefined; payload: any }>((resolve, reject) => {
                const outgoing = httpRequest({
                    host: '127.0.0.1', port: (server.address() as AddressInfo).port,
                    path: `/api/domani/feedback/beta_feedback/${id}/status`, method: 'PATCH',
                    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(scenario.body) },
                }, incoming => {
                    const chunks: Buffer[] = []
                    incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
                    incoming.on('end', () => resolve({ status: incoming.statusCode || 0, cache: incoming.headers['cache-control'], payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
                })
                outgoing.on('error', reject)
                outgoing.end(scenario.body)
            })
            expect(result.status).toBe(scenario.status)
            expect(result.cache).toBe('no-store')
            expect(result.payload.error.code).toBe(scenario.code)
            expect(result.payload.message).toBe(result.payload.error.message)
            expect(JSON.stringify(result.payload)).not.toContain('private malformed input')
            expect(mocks.getUser).toHaveBeenCalledWith('valid-token')
            expect(mocks.rpc).not.toHaveBeenCalled()
            expect(mocks.from).not.toHaveBeenCalled()
        } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
    })
})


describe('direct dashboard browser access', () => {
    it('allows configured preflights, verifies bearer requests, and rejects other origins', async () => {
        vi.stubEnv('PVS_DASHBOARD_ORIGINS', 'http://localhost:3000,https://dashboard.test')
        const app = express()
        app.use(router)
        const server = app.listen(0, '127.0.0.1')
        await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/domani/feedback`
        // Exercise only the loopback listener; the suite blocks global fetch.
        const fetch = (url: string, options: { method?: string; headers: Record<string, string> }) =>
            new Promise<{ status: number; headers: Headers }>((resolve, reject) => {
                const outgoing = httpRequest(url, options, incoming => {
                    const headers = new Headers()
                    for (const [key, value] of Object.entries(incoming.headers)) {
                        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value)
                    }
                    incoming.resume()
                    incoming.on('end', () => resolve({ status: incoming.statusCode || 0, headers }))
                })
                outgoing.on('error', reject)
                outgoing.end()
            })
        try {
            const preflight = await fetch(url, { method: 'OPTIONS', headers: {
                Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'PATCH',
                'Access-Control-Request-Headers': 'authorization,content-type',
            } })
            expect(preflight.status).toBe(204)
            expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
            expect(preflight.headers.get('access-control-allow-methods')).toContain('PATCH')
            expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization')
            expect(preflight.headers.get('access-control-max-age')).toBe('600')
            expect(mocks.getUser).not.toHaveBeenCalled()
            const allowed = await fetch(url, { headers: { Origin: 'https://dashboard.test', Authorization: 'Bearer browser-token' } })
            expect(allowed.status).toBe(200)
            expect(allowed.headers.get('access-control-allow-origin')).toBe('https://dashboard.test')
            expect(mocks.getUser).toHaveBeenCalledWith('browser-token')
            mocks.rpc.mockClear()
            const denied = await fetch(url, { headers: { Origin: 'https://unapproved.test', Authorization: 'Bearer browser-token' } })
            expect(denied.status).toBe(403)
            expect(denied.headers.get('access-control-allow-origin')).toBeNull()
            const anonymous = await fetch(url, { headers: { Origin: 'http://localhost:3000' } })
            expect(anonymous.status).toBe(401)
            expect(anonymous.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
            expect(mocks.rpc).not.toHaveBeenCalled()
        } finally {
            vi.unstubAllEnvs()
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        }
    })
})


describe('conversation history and read state', () => {
    it('uses the verified actor and bounded cursor for history', async () => {
        const res = response()
        await controller.history(request({ query: { limit: '20', after: id } }), res)
        expect(mocks.rpc).toHaveBeenCalledWith('list_domani_feedback_messages', {
            p_source: 'beta_feedback', p_id: id, p_actor_id: actor.userId, p_limit: 20, p_after: id,
        })
    })
    it('uses a null cursor and default page size for initial history', async () => {
        await controller.history(request(), response())
        expect(mocks.rpc).toHaveBeenCalledWith('list_domani_feedback_messages', expect.objectContaining({ p_limit: 50, p_after: null }))
    })
    it.each([{ limit: '101' }, { limit: '0' }, { limit: ['5'] }, { after: 'bad' }, { actor_id: id }, { offset: '1' }])('rejects unsafe history queries %j', async query => {
        const res = response()
        await controller.history(request({ query }), res)
        expect(res.status).toHaveBeenCalledWith(400)
        expect(mocks.rpc).not.toHaveBeenCalled()
    })
    it('advances only the authenticated staff read cursor', async () => {
        const res = response()
        await controller.markRead(request({ body: { message_id: id } }), res)
        expect(mocks.rpc).toHaveBeenCalledWith('mark_domani_feedback_read', {
            p_source: 'beta_feedback', p_id: id, p_actor_id: actor.userId, p_message_id: id,
        })
    })
    it.each([{}, { message_id: 'bad' }, { message_id: id, actor_id: id }, { message_id: id, sequence: 99 }])('rejects unsafe read body %j', async body => {
        const res = response()
        await controller.markRead(request({ body }), res)
        expect(res.status).toHaveBeenCalledWith(400)
        expect(mocks.rpc).not.toHaveBeenCalled()
    })
    it.each([controller.history, controller.markRead])('rejects missing actors before calling storage', async handler => {
        const res = response()
        await handler(request({ dashboardActor: undefined, body: { message_id: id } }), res)
        expect(res.status).toHaveBeenCalledWith(401)
        expect(mocks.rpc).not.toHaveBeenCalled()
    })
    it.each([controller.history, controller.markRead])('returns 404 when source was deleted', async handler => {
        mocks.rpc.mockResolvedValue({ data: null, error: null })
        const res = response()
        await handler(request({ body: { message_id: id } }), res)
        expect(res.status).toHaveBeenCalledWith(404)
    })
    it.each([controller.history, controller.markRead])('maps cross-conversation cursor errors without leaking SQL data', async handler => {
        mocks.rpc.mockResolvedValue({ data: null, error: { code: 'DF400', message: 'private SQL' } })
        const res = response()
        await handler(request({ body: { message_id: id } }), res)
        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'INVALID_CURSOR' }) }))
        expect(JSON.stringify(vi.mocked(res.json).mock.calls)).not.toContain('private SQL')
    })
})
