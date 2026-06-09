import { Request, Response, NextFunction, RequestHandler } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import mediaRouter from '../src/routes/media'
import {
    requireMediaAdminSession,
    validateRequest,
} from '../src/routes/middleware'
import mediaCatalogService from '../src/services/media-catalog'
import mediaPlacementsService from '../src/services/media-placements'
import mediaRevalidationService from '../src/services/media-revalidation'
import { MediaValidationError } from '../src/lib/media-r2'

vi.mock('../src/services/media-admin-auth', () => ({
    default: {
        findSessionByHash: vi.fn(),
        touchSession: vi.fn(),
    },
}))

vi.mock('../src/services/media-r2', () => ({
    default: {
        createPresignedUpload: vi.fn(),
        listObjects: vi.fn(),
        checkDestination: vi.fn(),
        moveCatalogItemObject: vi.fn(),
    },
}))

vi.mock('../src/services/media-catalog', () => ({
    default: {
        listCatalog: vi.fn(),
        createItem: vi.fn(),
        updateItem: vi.fn(),
        batchUpdateItems: vi.fn(),
    },
}))

vi.mock('../src/services/media-placements', () => ({
    default: {
        listPublicPlacements: vi.fn(),
        listAdminPlacements: vi.fn(),
        assignPlacement: vi.fn(),
        clearPlacement: vi.fn(),
    },
}))

vi.mock('../src/services/media-revalidation', () => ({
    default: {
        publicCatalogCacheControl: vi.fn(),
        triggerMediaRevalidation: vi.fn(),
    },
}))

type RouteLayer = {
    route?: {
        path: string
        methods: Record<string, boolean>
        stack: Array<{ handle: RequestHandler }>
    }
}

const routeHandlers = ({
    path,
    method,
}: {
    path: string
    method: string
}): RequestHandler[] => {
    const layer = (mediaRouter as unknown as { stack: RouteLayer[] }).stack.find(
        item => item.route?.path === path && item.route.methods[method]
    )

    if (!layer?.route) {
        throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
    }

    return layer.route.stack.map(item => item.handle)
}

const routeIndex = ({
    path,
    method,
}: {
    path: string
    method: string
}): number =>
    (mediaRouter as unknown as { stack: RouteLayer[] }).stack.findIndex(
        item => item.route?.path === path && item.route.methods[method]
    )

const createResponse = () => {
    const headers: Record<string, string> = {}
    const res = {
        headers,
        statusCode: 200,
        payload: undefined as unknown,
        set: vi.fn((name: string, value: string) => {
            headers[name.toLowerCase()] = value
            return res
        }),
        status: vi.fn((statusCode: number) => {
            res.statusCode = statusCode
            return res
        }),
        json: vi.fn((payload: unknown) => {
            res.payload = payload
            return res
        }),
    }

    return res as unknown as Response & typeof res
}

const createRequest = ({
    params = { websiteSlug: 'iffers-pictures' },
    body = {},
}: {
    params?: Record<string, string>
    body?: unknown
}): Request =>
    ({
        params,
        body,
        query: {},
        headers: {},
        get: vi.fn(),
    }) as unknown as Request

const runHandler = async (
    handler: RequestHandler,
    req: Request,
    res: Response
): Promise<boolean> => {
    let nextCalled = false
    let nextError: unknown
    const next: NextFunction = (err?: unknown) => {
        nextCalled = true
        nextError = err
    }

    const result = handler(req, res, next)
    if (result && typeof (result as Promise<unknown>).then === 'function') {
        await result
    }
    if (nextError) throw nextError

    return nextCalled
}

const runHandlers = async (
    handlers: RequestHandler[],
    req: Request,
    res: Response
): Promise<void> => {
    for (const handler of handlers) {
        const shouldContinue = await runHandler(handler, req, res)
        if (!shouldContinue) return
    }
}

describe('media placement route coverage', () => {
    beforeEach(() => {
        vi.mocked(mediaCatalogService.batchUpdateItems).mockReset()
        vi.mocked(mediaPlacementsService.listPublicPlacements).mockReset()
        vi.mocked(mediaPlacementsService.assignPlacement).mockReset()
        vi.mocked(mediaRevalidationService.publicCatalogCacheControl).mockReset()
        vi.mocked(mediaRevalidationService.triggerMediaRevalidation).mockReset()
        vi.mocked(mediaRevalidationService.publicCatalogCacheControl).mockReturnValue(
            'public, max-age=60, stale-while-revalidate=300'
        )
    })

    it('protects admin placement routes with media admin session middleware', () => {
        expect(
            routeHandlers({
                method: 'get',
                path: '/api/media/:websiteSlug/admin/placements',
            })[0]
        ).toBe(requireMediaAdminSession)
        expect(
            routeHandlers({
                method: 'put',
                path: '/api/media/:websiteSlug/admin/placements/:slotKey',
            })[0]
        ).toBe(requireMediaAdminSession)
        expect(
            routeHandlers({
                method: 'delete',
                path: '/api/media/:websiteSlug/admin/placements/:slotKey',
            })[0]
        ).toBe(requireMediaAdminSession)
    })

    it('registers protected batch media item route before item id patch route', () => {
        expect(
            routeHandlers({
                method: 'patch',
                path: '/api/media/:websiteSlug/admin/items/batch',
            })[0]
        ).toBe(requireMediaAdminSession)
        expect(
            routeIndex({
                method: 'patch',
                path: '/api/media/:websiteSlug/admin/items/batch',
            })
        ).toBeLessThan(
            routeIndex({
                method: 'patch',
                path: '/api/media/:websiteSlug/admin/items/:id',
            })
        )
    })

    it('passes authenticated admin actor context to batch media archive controller', async () => {
        vi.mocked(mediaCatalogService.batchUpdateItems).mockResolvedValue({
            items: [
                {
                    id: 1,
                    ok: true,
                    item: {
                        id: 1,
                        key: 'events/baby-shower/baby.jpg',
                        filename: 'baby.jpg',
                        src: 'https://media.ifferspictures.com/events/baby-shower/baby.jpg',
                        alt: 'Baby shower detail',
                        service: 'Events',
                        subCategory: 'Baby Shower',
                        aspectRatio: 'portrait',
                        status: 'archived',
                        sortOrder: 0,
                    },
                },
            ],
            summary: {
                requested: 1,
                succeeded: 1,
                failed: 0,
            },
        })
        const req = createRequest({
            body: {
                ids: [1],
                status: 'archived',
            },
        })
        req.mediaAdmin = {
            email: 'jenn@example.com',
            sessionId: 'session-1',
            expiresAt: '2099-01-01T00:00:00.000Z',
        }
        const res = createResponse()
        const handlers = routeHandlers({
            method: 'patch',
            path: '/api/media/:websiteSlug/admin/items/batch',
        })

        await runHandlers(handlers.slice(1), req, res)

        expect(res.statusCode).toBe(200)
        expect(mediaCatalogService.batchUpdateItems).toHaveBeenCalledWith({
            websiteSlug: 'iffers-pictures',
            ids: [1],
            status: 'archived',
            actor: 'jenn@example.com',
        })
    })

    it('rejects invalid batch media archive payloads before controller execution', async () => {
        const req = createRequest({
            body: {
                ids: [],
                status: 'archived',
            },
        })
        const res = createResponse()
        const handlers = routeHandlers({
            method: 'patch',
            path: '/api/media/:websiteSlug/admin/items/batch',
        })
        const validatorsThroughValidateRequest = handlers.slice(
            1,
            handlers.indexOf(validateRequest) + 1
        )

        await runHandlers(validatorsThroughValidateRequest, req, res)

        expect(res.statusCode).toBe(400)
        expect(mediaCatalogService.batchUpdateItems).not.toHaveBeenCalled()
    })

    it('rejects batch media archive requests with more than 50 ids', async () => {
        const req = createRequest({
            body: {
                ids: Array.from({ length: 51 }, (_, index) => index + 1),
                status: 'archived',
            },
        })
        const res = createResponse()
        const handlers = routeHandlers({
            method: 'patch',
            path: '/api/media/:websiteSlug/admin/items/batch',
        })
        const validatorsThroughValidateRequest = handlers.slice(
            1,
            handlers.indexOf(validateRequest) + 1
        )

        await runHandlers(validatorsThroughValidateRequest, req, res)

        expect(res.statusCode).toBe(400)
        expect(mediaCatalogService.batchUpdateItems).not.toHaveBeenCalled()
    })

    it('rejects unsupported batch media statuses before controller execution', async () => {
        const req = createRequest({
            body: {
                ids: [1],
                status: 'published',
            },
        })
        const res = createResponse()
        const handlers = routeHandlers({
            method: 'patch',
            path: '/api/media/:websiteSlug/admin/items/batch',
        })
        const validatorsThroughValidateRequest = handlers.slice(
            1,
            handlers.indexOf(validateRequest) + 1
        )

        await runHandlers(validatorsThroughValidateRequest, req, res)

        expect(res.statusCode).toBe(400)
        expect(mediaCatalogService.batchUpdateItems).not.toHaveBeenCalled()
    })

    it('applies public catalog cache headers to public placements controller output', async () => {
        vi.mocked(mediaPlacementsService.listPublicPlacements).mockResolvedValue({
            version: 1,
            publicBaseUrl: 'https://media.ifferspictures.com',
            placements: [
                {
                    slotKey: 'home.hero',
                    media: {
                        id: 1,
                        key: 'events/baby-shower/baby.jpg',
                        filename: 'baby.jpg',
                        src: 'https://media.ifferspictures.com/events/baby-shower/baby.jpg',
                        alt: 'Baby shower detail',
                        service: 'Events',
                        subCategory: 'Baby Shower',
                        aspectRatio: 'portrait',
                        status: 'published',
                    },
                },
            ],
        })
        const req = createRequest({})
        const res = createResponse()

        await runHandlers(
            routeHandlers({
                method: 'get',
                path: '/api/media/:websiteSlug/placements',
            }),
            req,
            res
        )

        expect(res.statusCode).toBe(200)
        expect(res.headers['cache-control']).toBe(
            'public, max-age=60, stale-while-revalidate=300'
        )
        expect(res.payload).toEqual(
            expect.objectContaining({
                placements: [
                    expect.objectContaining({
                        slotKey: 'home.hero',
                        media: expect.objectContaining({
                            id: 1,
                            subCategory: 'Baby Shower',
                            aspectRatio: 'portrait',
                            status: 'published',
                        }),
                    }),
                ],
            })
        )
    })

    it('passes authenticated admin actor context to placement assignment controller', async () => {
        vi.mocked(mediaPlacementsService.assignPlacement).mockResolvedValue({
            slotKey: 'home.hero',
            pageLabel: 'Home',
            sectionLabel: 'Hero',
            description: 'Primary homepage hero image.',
            affectedPaths: ['/'],
            assignment: {
                id: 10,
                updatedBy: 'jenn@example.com',
                createdAt: '2026-06-07T12:00:00.000Z',
                updatedAt: '2026-06-07T12:00:00.000Z',
                media: {
                    id: 1,
                    key: 'events/baby-shower/baby.jpg',
                    filename: 'baby.jpg',
                    src: 'https://media.ifferspictures.com/events/baby-shower/baby.jpg',
                    alt: 'Baby shower detail',
                    service: 'Events',
                    subCategory: 'Baby Shower',
                    aspectRatio: 'portrait',
                    status: 'published',
                },
            },
        })
        const req = createRequest({
            params: {
                websiteSlug: 'iffers-pictures',
                slotKey: 'home.hero',
            },
            body: { media_id: 1 },
        })
        req.mediaAdmin = {
            email: 'jenn@example.com',
            sessionId: 'session-1',
            expiresAt: '2099-01-01T00:00:00.000Z',
        }
        const res = createResponse()
        const handlers = routeHandlers({
            method: 'put',
            path: '/api/media/:websiteSlug/admin/placements/:slotKey',
        })

        await runHandlers(handlers.slice(1), req, res)

        expect(res.statusCode).toBe(200)
        expect(mediaPlacementsService.assignPlacement).toHaveBeenCalledWith({
            websiteSlug: 'iffers-pictures',
            slotKey: 'home.hero',
            mediaId: 1,
            actor: 'jenn@example.com',
        })
    })

    it('returns structured media errors for unknown placement slots', async () => {
        vi.mocked(mediaPlacementsService.assignPlacement).mockRejectedValue(
            new MediaValidationError(
                400,
                'media.invalid_placement_slot',
                'Invalid media placement slot.',
                { slotKey: 'home.unknown' }
            )
        )
        const req = createRequest({
            params: {
                websiteSlug: 'iffers-pictures',
                slotKey: 'home.unknown',
            },
            body: { media_id: 1 },
        })
        const res = createResponse()
        const handlers = routeHandlers({
            method: 'put',
            path: '/api/media/:websiteSlug/admin/placements/:slotKey',
        })

        await runHandlers(handlers.slice(1), req, res)

        expect(res.statusCode).toBe(400)
        expect(res.payload).toEqual({
            error: {
                code: 'media.invalid_placement_slot',
                message: 'Invalid media placement slot.',
                details: { slotKey: 'home.unknown' },
            },
        })
    })

    it('accepts placement-specific manual revalidation reasons at route validation', async () => {
        vi.mocked(mediaRevalidationService.triggerMediaRevalidation).mockResolvedValue({
            configured: true,
            triggered: true,
            skipped: false,
            reason: 'placement_replaced',
            website_slug: 'iffers-pictures',
            affected_paths: ['/'],
            triggered_at: '2026-06-07T12:00:00.000Z',
            status: 202,
        })
        const req = createRequest({
            body: {
                reason: 'placement_replaced',
                media_id: 1,
                media_key: 'events/baby-shower/baby.jpg',
            },
        })
        req.mediaAdmin = {
            email: 'jenn@example.com',
            sessionId: 'session-1',
            expiresAt: '2099-01-01T00:00:00.000Z',
        }
        const res = createResponse()
        const handlers = routeHandlers({
            method: 'post',
            path: '/api/media/:websiteSlug/admin/revalidate',
        })

        await runHandlers(handlers.slice(1), req, res)

        expect(res.statusCode).toBe(200)
        expect(mediaRevalidationService.triggerMediaRevalidation).toHaveBeenCalledWith({
            websiteSlug: 'iffers-pictures',
            reason: 'placement_replaced',
            mediaId: 1,
            mediaKey: 'events/baby-shower/baby.jpg',
            actor: 'jenn@example.com',
        })
    })

    it('rejects unknown manual revalidation reasons before controller execution', async () => {
        const req = createRequest({
            body: {
                reason: 'not_a_reason',
            },
        })
        const res = createResponse()
        const handlers = routeHandlers({
            method: 'post',
            path: '/api/media/:websiteSlug/admin/revalidate',
        })
        const validatorsThroughValidateRequest = handlers.slice(
            1,
            handlers.indexOf(validateRequest) + 1
        )

        await runHandlers(validatorsThroughValidateRequest, req, res)

        expect(res.statusCode).toBe(400)
        expect(mediaRevalidationService.triggerMediaRevalidation).not.toHaveBeenCalled()
    })
})
