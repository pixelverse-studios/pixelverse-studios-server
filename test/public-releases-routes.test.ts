import { NextFunction, Request, RequestHandler, Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/public-releases', () => ({
    listPublicReleases: vi.fn(),
}))

import publicReleasesRouter from '../src/routes/public-releases'
import { PublicReleaseApiError } from '../src/lib/public-releases'
import { listPublicReleases } from '../src/services/public-releases'

type RouteLayer = {
    route?: {
        path: string
        methods: Record<string, boolean>
        stack: Array<{ handle: RequestHandler }>
    }
}

const handlersFor = (path: string): RequestHandler[] => {
    const layer = (
        publicReleasesRouter as unknown as { stack: RouteLayer[] }
    ).stack.find(item => item.route?.path === path && item.route.methods.get)
    if (!layer?.route) throw new Error(`Route not found: ${path}`)
    return layer.route.stack.map(item => item.handle)
}

const request = (query: Record<string, string> = {}): Request =>
    ({
        query,
        headers: {},
        requestId: 'request-123',
        get: vi.fn(),
    }) as unknown as Request

const response = () => {
    const headers: Record<string, string> = {}
    const res = {
        statusCode: 200,
        payload: undefined as unknown,
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
        headers,
    }
    return res as unknown as Response & typeof res
}

const run = async (path: string, req: Request, res: Response) => {
    for (const handler of handlersFor(path)) {
        let continued = false
        let error: unknown
        const next: NextFunction = err => {
            continued = true
            error = err
        }
        const result = handler(req, res, next)
        if (result && typeof (result as Promise<unknown>).then === 'function') {
            await result
        }
        if (error) throw error
        if (!continued) return
    }
}

describe('public release routes', () => {
    beforeEach(() => {
        vi.mocked(listPublicReleases).mockReset()
    })

    it('returns the locked success envelope and cache headers', async () => {
        vi.mocked(listPublicReleases).mockResolvedValue({
            releases: [],
            nextCursor: null,
        })
        const req = request({ platform: 'ios', limit: '10' })
        const res = response()
        await run('/api/domani/releases/coming-soon', req, res)

        expect(listPublicReleases).toHaveBeenCalledWith({
            collection: 'coming-soon',
            platform: 'ios',
            limit: 10,
            cursor: undefined,
        })
        expect(res.statusCode).toBe(200)
        expect(res.payload).toEqual({
            data: { releases: [] },
            meta: {
                apiVersion: '2026-08-05',
                requestId: 'request-123',
                nextCursor: null,
            },
        })
        expect(res.headers['cache-control']).toBe(
            'public, s-maxage=300, stale-while-revalidate=600'
        )
        expect(res.headers.vary).toBe('Accept-Encoding')
        expect(res.headers['x-request-id']).toBe('request-123')
    })

    it('returns field errors without calling the service', async () => {
        const req = request({ platform: 'web', limit: '101' })
        const res = response()
        await run('/api/domani/releases/changelog', req, res)

        expect(listPublicReleases).not.toHaveBeenCalled()
        expect(res.statusCode).toBe(400)
        expect(res.payload).toMatchObject({
            error: {
                code: 'VALIDATION_ERROR',
                fieldErrors: {
                    platform: ['Platform must be ios or android'],
                    limit: ['Limit must be an integer between 1 and 100'],
                },
                requestId: 'request-123',
            },
        })
        expect(res.headers['cache-control']).toBe('no-store')
    })

    it('preserves safe cursor errors and sanitizes internal failures', async () => {
        vi.mocked(listPublicReleases).mockRejectedValueOnce(
            new PublicReleaseApiError(400, 'VALIDATION_ERROR', 'Invalid query parameters', {
                cursor: ['Cursor is invalid or does not match this request'],
            })
        )
        const cursorRes = response()
        await run(
            '/api/domani/releases/changelog',
            request({ cursor: 'tampered' }),
            cursorRes
        )
        expect(cursorRes.payload).toMatchObject({
            error: {
                code: 'VALIDATION_ERROR',
                fieldErrors: {
                    cursor: ['Cursor is invalid or does not match this request'],
                },
                requestId: 'request-123',
            },
        })

        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.mocked(listPublicReleases).mockRejectedValueOnce(
            new Error('database credentials leaked here')
        )
        const failureRes = response()
        await run('/api/domani/releases/changelog', request(), failureRes)
        expect(failureRes.statusCode).toBe(500)
        expect(failureRes.payload).toMatchObject({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Unable to load releases',
                fieldErrors: {},
            },
        })
        expect(JSON.stringify(failureRes.payload)).not.toContain('credentials')
    })
})
