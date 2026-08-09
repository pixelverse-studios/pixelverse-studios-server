import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/controllers/mini-session-campaigns', () => ({
    default: {
        getActive: vi.fn(),
        listAdmin: vi.fn(),
        getAdmin: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        duplicate: vi.fn(),
        publish: vi.fn(),
        markSoldOut: vi.fn(),
        close: vi.fn(),
        archive: vi.fn(),
    },
}))

vi.mock('../src/services/media-admin-auth', () => ({
    default: {
        findSessionByHash: vi.fn(),
        touchSession: vi.fn(),
    },
}))

import miniSessionCampaignRouter from '../src/routes/mini-session-campaigns'
import { requireMediaAdminSession } from '../src/routes/middleware'

interface RouteLayer {
    route?: {
        path: string
        methods: Record<string, boolean>
        stack: Array<{ handle: unknown }>
    }
}

const routes = ((miniSessionCampaignRouter as any).stack as RouteLayer[])
    .filter(layer => layer.route)
    .map(layer => layer.route!)

describe('Mini Sessions campaign routes', () => {
    it('exposes one public active-campaign endpoint', () => {
        const route = routes.find(candidate =>
            candidate.path.endsWith('/:websiteSlug/active')
        )
        expect(route?.methods.get).toBe(true)
        expect(route?.stack.map(layer => layer.handle)).not.toContain(
            requireMediaAdminSession
        )
    })

    it('protects every administrator endpoint with the existing session middleware', () => {
        const adminRoutes = routes.filter(route => route.path.includes('/admin'))
        expect(adminRoutes).toHaveLength(9)
        adminRoutes.forEach(route => {
            expect(route.stack.map(layer => layer.handle)).toContain(
                requireMediaAdminSession
            )
        })
    })

    it('provides explicit lifecycle actions instead of a status PATCH', () => {
        const paths = routes.map(route => route.path)
        expect(paths).toEqual(
            expect.arrayContaining([
                '/api/mini-session-campaigns/:websiteSlug/admin/:campaignId/publish',
                '/api/mini-session-campaigns/:websiteSlug/admin/:campaignId/mark-sold-out',
                '/api/mini-session-campaigns/:websiteSlug/admin/:campaignId/close',
                '/api/mini-session-campaigns/:websiteSlug/admin/:campaignId/archive',
                '/api/mini-session-campaigns/:websiteSlug/admin/:campaignId/duplicate',
            ])
        )
    })
})
