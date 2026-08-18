import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/mini-session-campaigns', () => ({
    default: {
        getActiveCampaign: vi.fn(),
        listCampaigns: vi.fn(),
        getCampaign: vi.fn(),
        createCampaign: vi.fn(),
        updateCampaign: vi.fn(),
        duplicateCampaign: vi.fn(),
        publishCampaign: vi.fn(),
        markCampaignSoldOut: vi.fn(),
        closeCampaign: vi.fn(),
        archiveCampaign: vi.fn(),
    },
}))

vi.mock('../src/services/site-content-revalidation', async importOriginal => {
    const original = await importOriginal<
        typeof import('../src/services/site-content-revalidation')
    >()
    return {
        ...original,
        default: {
            publicCampaignCacheControl: vi.fn(
                () => 'public, max-age=60, must-revalidate'
            ),
            triggerMiniSessionRevalidation: vi.fn(),
        },
    }
})

import miniSessionCampaignController from '../src/controllers/mini-session-campaigns'
import { MiniSessionDomainError } from '../src/lib/mini-session-campaigns'
import miniSessionCampaigns from '../src/services/mini-session-campaigns'
import siteContentRevalidation, {
    SiteContentRevalidationError,
} from '../src/services/site-content-revalidation'

const campaignId = '5aa25f8e-278d-44c1-a2d5-363798e75d32'

const campaign = {
    id: campaignId,
    internalName: 'Fall Minis 2026',
    status: 'live' as const,
    headline: 'Fall Mini Sessions',
    bookingOptions: [],
    updatedAt: '2026-08-09T12:00:00.000Z',
}

const validInput = {
    internalName: 'Fall Minis 2026',
    publicLabel: 'Limited fall dates',
    headline: 'Fall Mini Sessions',
    summary: 'A short seasonal session for families.',
    description: 'Twenty relaxed minutes.',
    inclusionsHeadline: 'Session Details',
    durationMinutes: 20,
    totalPriceCents: 30000,
    depositCents: 10000,
    balanceDueText: 'The remaining balance is due separately.',
    dateSummary: 'October 17–18, 2026',
    locationSummary: 'Cliffside Park, NJ',
    inclusions: ['20-minute session'],
    cancellationPolicy: 'Deposits are non-refundable.',
    weatherPolicy: '',
    latenessPolicy: 'Late arrival reduces available time.',
    termsNote: '',
    heroMediaId: null,
    ctaLabel: 'Choose your time',
    homepageFeatured: true,
    promoLabel: 'Fall Minis',
    promoHeadline: 'A little time, a lifetime of memories',
    promoCopy: 'Limited dates are now open.',
    promoCtaLabel: 'See fall dates',
    metaTitle: '',
    metaDescription: '',
    bookingOptions: [
        {
            label: 'Saturday, October 17',
            description: '',
            dateTimeLabel: 'Saturday, October 17',
            locationLabel: 'Cliffside Park, NJ',
            calBookingUrl:
                'https://cal.com/iffers-pictures/fall-minis-oct-17',
            status: 'open' as const,
            sortOrder: 0,
        },
    ],
}

const createRequest = (overrides: Record<string, unknown> = {}): any => ({
    params: {
        websiteSlug: 'iffers-pictures',
        campaignId,
    },
    query: {},
    body: {},
    mediaAdmin: {
        email: 'jenn@example.com',
        sessionId: 'session-1',
        expiresAt: '2026-08-10T12:00:00.000Z',
    },
    ...overrides,
})

const createResponse = (): any => {
    const response: Record<string, ReturnType<typeof vi.fn>> = {
        status: vi.fn(),
        json: vi.fn(),
        set: vi.fn(),
    }
    response.status.mockReturnValue(response)
    response.json.mockReturnValue(response)
    response.set.mockReturnValue(response)
    return response
}

describe('Mini Sessions campaign controller', () => {
    beforeEach(() => {
        vi.mocked(miniSessionCampaigns.getActiveCampaign).mockReset()
        vi.mocked(miniSessionCampaigns.listCampaigns).mockReset()
        vi.mocked(miniSessionCampaigns.getCampaign).mockReset()
        vi.mocked(miniSessionCampaigns.createCampaign).mockReset()
        vi.mocked(miniSessionCampaigns.updateCampaign).mockReset()
        vi.mocked(miniSessionCampaigns.duplicateCampaign).mockReset()
        vi.mocked(miniSessionCampaigns.publishCampaign).mockReset()
        vi.mocked(miniSessionCampaigns.markCampaignSoldOut).mockReset()
        vi.mocked(miniSessionCampaigns.closeCampaign).mockReset()
        vi.mocked(miniSessionCampaigns.archiveCampaign).mockReset()
        vi.mocked(
            siteContentRevalidation.triggerMiniSessionRevalidation
        ).mockReset()
    })

    it('returns a true cache-bounded 404 when no public campaign exists', async () => {
        vi.mocked(
            miniSessionCampaigns.getActiveCampaign
        ).mockResolvedValue(null)
        const response = createResponse()

        await miniSessionCampaignController.getActive(
            createRequest(),
            response
        )

        expect(response.set).toHaveBeenCalledWith(
            'Cache-Control',
            'public, max-age=60, must-revalidate'
        )
        expect(response.status).toHaveBeenCalledWith(404)
        expect(response.json).toHaveBeenCalledWith({
            ok: false,
            error: expect.objectContaining({
                code: 'mini_sessions.not_found',
            }),
        })
    })

    it('returns only the sanitized public campaign supplied by the domain', async () => {
        const publicCampaign = {
            id: campaignId,
            status: 'live',
            headline: 'Fall Mini Sessions',
            bookingOptions: [],
        }
        vi.mocked(
            miniSessionCampaigns.getActiveCampaign
        ).mockResolvedValue(publicCampaign as any)
        const response = createResponse()

        await miniSessionCampaignController.getActive(
            createRequest(),
            response
        )

        expect(response.status).toHaveBeenCalledWith(200)
        expect(response.json).toHaveBeenCalledWith({
            campaign: publicCampaign,
        })
    })

    it('rejects generic PATCH attempts to change lifecycle status', async () => {
        const response = createResponse()
        await miniSessionCampaignController.update(
            createRequest({
                body: {
                    expectedUpdatedAt: '2026-08-09T12:00:00.000Z',
                    campaign: { ...validInput, status: 'live' },
                },
            }),
            response
        )

        expect(response.status).toHaveBeenCalledWith(400)
        expect(response.json).toHaveBeenCalledWith({
            ok: false,
            error: expect.objectContaining({
                code: 'mini_sessions.invalid_payload',
            }),
        })
        expect(miniSessionCampaigns.updateCampaign).not.toHaveBeenCalled()
    })

    it('rejects unsupported booking URLs before persistence', async () => {
        const response = createResponse()
        await miniSessionCampaignController.create(
            createRequest({
                body: {
                    campaign: {
                        ...validInput,
                        bookingOptions: [
                            {
                                ...validInput.bookingOptions[0],
                                calBookingUrl:
                                    'https://evil.example/embedded-checkout',
                            },
                        ],
                    },
                },
            }),
            response
        )

        expect(response.status).toHaveBeenCalledWith(400)
        expect(miniSessionCampaigns.createCampaign).not.toHaveBeenCalled()
    })

    it('rejects arbitrary booking embed fields instead of persisting markup', async () => {
        const response = createResponse()
        await miniSessionCampaignController.create(
            createRequest({
                body: {
                    campaign: {
                        ...validInput,
                        bookingOptions: [
                            {
                                ...validInput.bookingOptions[0],
                                embedHtml: '<script>alert(1)</script>',
                            },
                        ],
                    },
                },
            }),
            response
        )

        expect(response.status).toHaveBeenCalledWith(400)
        expect(miniSessionCampaigns.createCampaign).not.toHaveBeenCalled()
    })

    it('returns stale writes as 409 conflicts', async () => {
        vi.mocked(miniSessionCampaigns.updateCampaign).mockRejectedValue(
            new MiniSessionDomainError(
                'STALE_WRITE',
                'Refresh before saving'
            )
        )
        const response = createResponse()

        await miniSessionCampaignController.update(
            createRequest({
                body: {
                    expectedUpdatedAt: '2026-08-09T12:00:00.000Z',
                    campaign: validInput,
                },
            }),
            response
        )

        expect(response.status).toHaveBeenCalledWith(409)
        expect(response.json).toHaveBeenCalledWith({
            ok: false,
            error: expect.objectContaining({
                code: 'mini_sessions.stale_write',
                retryable: true,
            }),
        })
    })

    it('does not allow cross-website campaign access', async () => {
        vi.mocked(miniSessionCampaigns.getCampaign).mockRejectedValue(
            new MiniSessionDomainError(
                'CAMPAIGN_NOT_FOUND',
                'Campaign was not found'
            )
        )
        const response = createResponse()

        await miniSessionCampaignController.getAdmin(
            createRequest({
                params: {
                    websiteSlug: 'another-site',
                    campaignId,
                },
            }),
            response
        )

        expect(response.status).toHaveBeenCalledWith(404)
        expect(response.json).toHaveBeenCalledWith({
            ok: false,
            error: expect.objectContaining({
                code: 'mini_sessions.campaign_not_found',
            }),
        })
    })

    it('requires explicit Cal.com verification before publishing', async () => {
        const response = createResponse()

        await miniSessionCampaignController.publish(
            createRequest({
                body: {
                    expectedUpdatedAt: '2026-08-09T12:00:00.000Z',
                    calComVerified: false,
                },
            }),
            response
        )

        expect(response.status).toHaveBeenCalledWith(400)
        expect(miniSessionCampaigns.publishCampaign).not.toHaveBeenCalled()
    })

    it('reports revalidation failure separately after publication persists', async () => {
        vi.mocked(miniSessionCampaigns.publishCampaign).mockResolvedValue(
            campaign as any
        )
        vi.mocked(
            siteContentRevalidation.triggerMiniSessionRevalidation
        ).mockRejectedValue(
            new SiteContentRevalidationError('Webhook unavailable', {
                status: 503,
            })
        )
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const response = createResponse()

        await miniSessionCampaignController.publish(
            createRequest({
                body: {
                    expectedUpdatedAt: '2026-08-09T12:00:00.000Z',
                    calComVerified: true,
                },
            }),
            response
        )

        expect(response.status).toHaveBeenCalledWith(200)
        expect(response.json).toHaveBeenCalledWith({
            campaign,
            revalidation: expect.objectContaining({
                triggered: false,
                error: expect.objectContaining({
                    code: 'site_content.revalidation_failed',
                }),
            }),
        })
        expect(miniSessionCampaigns.publishCampaign).toHaveBeenCalledTimes(1)
        expect(consoleSpy).toHaveBeenCalled()
    })
})
