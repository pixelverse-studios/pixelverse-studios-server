import express from 'express'
import { request as httpRequest } from 'http'
import { AddressInfo } from 'net'
import { beforeEach, describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }))
vi.mock('../src/lib/db', () => ({ db: { auth: { getUser: mocks.getUser } } }))
vi.mock('../src/lib/domani-db', () => ({
    domaniDb: { rpc: mocks.rpc },
    PLATFORMS: ['ios', 'android'],
    SIGNUP_COHORTS: ['general']
}))
vi.mock('../src/controllers/domani', () => ({
    default: {
        listSupportRequests: vi.fn(),
        listWaitlist: vi.fn(),
        unsubscribe: vi.fn(),
        unsubscribeUser: vi.fn()
    }
}))
import router from '../src/routes/domani'
import { userQuerySchema } from '../src/lib/domani-users'
beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
        data: { user: { id: 'staff', email: 'phil@pixelversestudios.io' } }
    })
    mocks.rpc.mockResolvedValue({
        data: {
            items: [],
            total: 0,
            stats: { total: 0, active_30d: 0 },
            data_as_of: '2026-09-20T00:00:00Z'
        },
        error: null
    })
})
describe('user queries', () => {
    it('normalizes inclusive calendar end to exclusive UTC midnight', () => {
        expect(
            userQuerySchema.parse({
                start_date: '2026-09-01',
                end_date: '2026-09-20',
                limit: '100',
                offset: '100',
                include_deleted: 'true'
            })
        ).toMatchObject({
            start_date: '2026-09-01T00:00:00.000Z',
            end_date: '2026-09-21T00:00:00.000Z',
            limit: 100,
            offset: 100,
            include_deleted: true
        })
    })
    it.each([
        { sort_by: 'password' },
        { limit: '101' },
        { offset: '-1' },
        { provider: ['apple', 'google'] },
        { start_date: '2026-02-30' },
        { start_date: '2026-09-21', end_date: '2026-09-19' },
        { surprise: 'x' }
    ])('rejects invalid query %j', v =>
        expect(userQuerySchema.safeParse(v).success).toBe(false)
    )
    it('accepts offset timestamps crossing UTC midnight', () =>
        expect(
            userQuerySchema.parse({ start_date: '2026-09-20T23:30:00-04:00' })
                .start_date
        ).toBe('2026-09-21T03:30:00.000Z'))
})
describe('users HTTP boundary', () => {
    it('protects all reads, bounds queries, preserves legacy list shape and hides failures', async () => {
        const app = express()
        app.use(router)
        const server = app.listen(0, '127.0.0.1')
        await new Promise<void>((yes, no) => {
            server.once('listening', yes)
            server.once('error', no)
        })
        const get = (path: string, token?: string) =>
            new Promise<{ status: number; body: any; cache?: string }>(
                (yes, no) => {
                    const r = httpRequest(
                        {
                            host: '127.0.0.1',
                            port: (server.address() as AddressInfo).port,
                            path,
                            headers: token
                                ? { Authorization: `Bearer ${token}` }
                                : {}
                        },
                        res => {
                            let body = ''
                            res.on('data', b => (body += b))
                            res.on('end', () =>
                                yes({
                                    status: res.statusCode!,
                                    body: JSON.parse(body),
                                    cache: res.headers['cache-control']
                                })
                            )
                        }
                    )
                    r.on('error', no)
                    r.end()
                }
            )
        try {
            for (const path of [
                '/api/domani/users',
                '/api/domani/users/stats',
                '/api/domani/users/00000000-0000-4000-8000-000000000001'
            ])
                expect((await get(path)).status).toBe(401)
            expect(mocks.rpc).not.toHaveBeenCalled()
            mocks.getUser.mockResolvedValueOnce({
                data: {
                    user: {
                        id: 'other',
                        email: 'other@example.test',
                        user_metadata: { role: 'admin' }
                    }
                }
            })
            expect((await get('/api/domani/users', 'other')).status).toBe(403)
            expect(mocks.rpc).not.toHaveBeenCalled()
            const r = await get(
                '/api/domani/users?search=user125&provider=apple&limit=10&offset=100',
                'valid'
            )
            expect(r.status).toBe(200)
            expect(r.cache).toBe('no-store')
            expect(r.body).toHaveProperty('items')
            expect(mocks.rpc).toHaveBeenCalledTimes(1)
            expect(mocks.rpc.mock.calls[0][1].p_query).toMatchObject({
                search: 'user125',
                provider: 'apple',
                limit: 10,
                offset: 100
            })
            expect(
                (await get('/api/domani/users/stats', 'valid')).body.total
            ).toBe(0)
            expect(
                (
                    await get(
                        '/api/domani/users/00000000-0000-4000-8000-000000000001',
                        'valid'
                    )
                ).status
            ).toBe(404)
            expect(
                (await get('/api/domani/users?limit=1000', 'valid')).status
            ).toBe(400)
            mocks.rpc.mockResolvedValueOnce({
                error: { code: 'PGRST202', message: 'private schema' },
                data: null
            })
            const err = await get('/api/domani/users', 'valid')
            expect(err.status).toBe(503)
            expect(JSON.stringify(err.body)).not.toContain('private schema')
        } finally {
            await new Promise<void>((yes, no) =>
                server.close(e => (e ? no(e) : yes()))
            )
        }
    })
})
