import { Request, Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import leadsController from '../src/controllers/leads'
import auditController from '../src/controllers/audit'
import calendlyWebhookController from '../src/controllers/calendly-webhook'
import { sendSlackNotification } from '../src/lib/slack-notifier'
import { upsertProspect } from '../src/services/prospects'
import leadSubmissionsService from '../src/services/lead-submissions'
import auditRequestsService from '../src/services/audit-requests'
import calendlyBookingsService from '../src/services/calendly-bookings'

vi.mock('../src/lib/slack-notifier', () => ({
    sendSlackNotification: vi.fn(),
}))

vi.mock('../src/services/prospects', () => ({
    upsertProspect: vi.fn(),
}))

vi.mock('../src/services/lead-submissions', () => ({
    default: {
        createLeadSubmission: vi.fn(),
    },
}))

vi.mock('../src/services/audit-requests', () => ({
    default: {
        createAuditRequest: vi.fn(),
    },
}))

vi.mock('../src/services/calendly-bookings', () => ({
    default: {
        findBookingByEventUri: vi.fn(),
        createBooking: vi.fn(),
    },
}))

const prospectId = 'prospect-internal-123'
const attribution = {
    source: 'internal-attribution-source',
    conversion: { raw: 'raw-reporting-metadata' },
}

const createResponse = () => {
    const res = {
        status: vi.fn(),
        json: vi.fn(),
    }
    res.status.mockReturnValue(res)
    res.json.mockReturnValue(res)
    return res as unknown as Response & {
        status: ReturnType<typeof vi.fn>
        json: ReturnType<typeof vi.fn>
    }
}

const createRequest = (body: unknown): Request => ({ body }) as Request

const latestSlackPayload = () => vi.mocked(sendSlackNotification).mock.calls.at(-1)?.[0]

const calendlyResponse = (resource: unknown): Response =>
    ({
        ok: true,
        status: 200,
        json: async () => ({ resource }),
    }) as Response

const expectNoInternalData = (payload: unknown): void => {
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain(prospectId)
    expect(serialized).not.toContain('record-internal-')
    expect(serialized).not.toContain('internal-attribution-source')
    expect(serialized).not.toContain('raw-reporting-metadata')
    expect(serialized).not.toContain('attribution')
}

const expectSuccessfulResponse = (
    res: ReturnType<typeof createResponse>,
    statusCode: number,
    body: Record<string, string>
): void => {
    expect(res.status).toHaveBeenCalledWith(statusCode)
    expect(res.json).toHaveBeenCalledWith(body)
}

const expectCalledBefore = (
    first: ReturnType<typeof vi.fn>,
    second: ReturnType<typeof vi.fn>
): void => {
    expect(first.mock.invocationCallOrder[0]).toBeLessThan(
        second.mock.invocationCallOrder[0]
    )
}

const eventUuid = '11111111-1111-1111-1111-111111111111'
const inviteeUuid = '22222222-2222-2222-2222-222222222222'
const eventUri = `https://api.calendly.com/scheduled_events/${eventUuid}`
const inviteeUri = `${eventUri}/invitees/${inviteeUuid}`

describe('controller Slack notifications', () => {
    beforeEach(() => {
        process.env.CALENDLY_API_TOKEN = 'calendly-test-token'
        vi.mocked(upsertProspect).mockResolvedValue(prospectId)
        vi.mocked(sendSlackNotification).mockResolvedValue(undefined)
        vi.spyOn(console, 'log').mockImplementation(() => undefined)
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    it('sends a customer-facing Slack alert after lead persistence succeeds', async () => {
        vi.mocked(leadSubmissionsService.createLeadSubmission).mockResolvedValue({
            id: 'record-internal-lead',
            prospect_id: prospectId,
            company_name: 'PVS Test Co',
            phone: '555-0100',
            budget: '3-6k',
            timeline: 'ASAP',
            current_website: 'https://example.com',
            improvements: ['Speed', 'SEO'],
            interested_in: ['web-design', 'seo'],
            brief_summary: 'Needs a sharper website.',
            promo_code: 'PVS',
            attribution: attribution as any,
            created_at: '2026-05-19T18:00:00.000Z',
        })
        const res = createResponse()

        await leadsController.createLead(
            createRequest({
                name: 'Ada Lovelace',
                email: 'ada@example.com',
                companyName: 'PVS Test Co',
                phone: '555-0100',
                budget: '3-6k',
                timeline: 'ASAP',
                interestedIn: ['web-design', 'seo'],
                currentWebsite: 'https://example.com',
                improvements: ['Speed', 'SEO'],
                briefSummary: 'Needs a sharper website.',
                promoCode: 'PVS',
                attribution,
            }),
            res
        )

        expectSuccessfulResponse(res, 201, { message: 'Message received.' })
        expect(leadSubmissionsService.createLeadSubmission).toHaveBeenCalledWith(
            expect.objectContaining({ prospectId, attribution })
        )
        expectCalledBefore(
            vi.mocked(leadSubmissionsService.createLeadSubmission),
            vi.mocked(sendSlackNotification)
        )
        expect(sendSlackNotification).toHaveBeenCalledWith({
            title: 'New Lead Submission',
            category: 'Details Form',
            description: 'A prospective client submitted the project details form.',
            fields: [
                { label: 'Name', value: 'Ada Lovelace' },
                { label: 'Email', value: 'ada@example.com' },
                { label: 'Company', value: 'PVS Test Co' },
                { label: 'Phone', value: '555-0100' },
                { label: 'Budget', value: '3-6k' },
                { label: 'Timeline', value: 'ASAP' },
                { label: 'Website', value: 'https://example.com' },
                { label: 'Services', value: 'web-design, seo' },
                { label: 'Needs', value: 'Speed, SEO' },
                { label: 'Notes', value: 'Needs a sharper website.' },
                { label: 'Promo', value: 'PVS' },
            ],
        })
        expectNoInternalData(latestSlackPayload())
    })

    it('keeps lead responses successful when Slack notification rejects', async () => {
        vi.mocked(leadSubmissionsService.createLeadSubmission).mockResolvedValue(
            {} as any
        )
        vi.mocked(sendSlackNotification).mockRejectedValue(new Error('Slack down'))
        const res = createResponse()

        await leadsController.createLead(
            createRequest({
                name: 'Ada Lovelace',
                email: 'ada@example.com',
                companyName: 'PVS Test Co',
                budget: '1-3k',
                timeline: 'ASAP',
                improvements: ['SEO'],
                attribution,
            }),
            res
        )

        expectSuccessfulResponse(res, 201, { message: 'Message received.' })
        expect(sendSlackNotification).toHaveBeenCalledOnce()
        expect(latestSlackPayload()?.fields).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ label: 'Promo' }),
            ])
        )
    })

    it('does not persist or notify Slack for lead honeypot submissions', async () => {
        const res = createResponse()

        await leadsController.createLead(
            createRequest({
                name: 'Bot Lead',
                email: 'bot@example.com',
                companyName: 'Bot Co',
                budget: '1-3k',
                timeline: 'ASAP',
                improvements: ['SEO'],
                honeypot: 'filled',
            }),
            res
        )

        expectSuccessfulResponse(res, 200, { message: 'Message received.' })
        expect(upsertProspect).not.toHaveBeenCalled()
        expect(leadSubmissionsService.createLeadSubmission).not.toHaveBeenCalled()
        expect(sendSlackNotification).not.toHaveBeenCalled()
    })

    it('sends a customer-facing Slack alert after audit persistence succeeds', async () => {
        vi.mocked(auditRequestsService.createAuditRequest).mockResolvedValue({
            id: 'record-internal-audit',
            name: 'Grace Hopper',
            email: 'grace@example.com',
            website_url: 'https://example.com',
            phone_number: '555-0111',
            specifics: 'technical seo, accessibility',
            other_detail: 'Please review checkout.',
            status: 'pending',
            prospect_id: prospectId,
            promo_code: 'AUDIT',
            attribution: attribution as any,
            created_at: '2026-05-19T18:15:00.000Z',
            updated_at: '2026-05-19T18:15:00.000Z',
        })
        const res = createResponse()

        await auditController.createAuditRequest(
            createRequest({
                name: 'Grace Hopper',
                email: 'grace@example.com',
                websiteUrl: 'https://example.com',
                phoneNumber: '555-0111',
                specifics: ['technical seo', 'accessibility'],
                otherDetail: 'Please review checkout.',
                promoCode: 'AUDIT',
                attribution,
            }),
            res
        )

        expectSuccessfulResponse(res, 201, { message: 'Audit request received.' })
        expect(auditRequestsService.createAuditRequest).toHaveBeenCalledWith(
            expect.objectContaining({ prospectId, attribution })
        )
        expectCalledBefore(
            vi.mocked(auditRequestsService.createAuditRequest),
            vi.mocked(sendSlackNotification)
        )
        expect(sendSlackNotification).toHaveBeenCalledWith({
            title: 'New Website Audit Request',
            category: 'Website Audit',
            description: 'A prospective client requested a free website audit.',
            timestamp: '2026-05-19T18:15:00.000Z',
            fields: [
                { label: 'Name', value: 'Grace Hopper' },
                { label: 'Email', value: 'grace@example.com' },
                { label: 'Website', value: 'https://example.com' },
                { label: 'Phone', value: '555-0111' },
                { label: 'Focus Areas', value: 'technical seo, accessibility' },
                { label: 'Other Details', value: 'Please review checkout.' },
                { label: 'Promo', value: 'AUDIT' },
            ],
        })
        expectNoInternalData(latestSlackPayload())
    })

    it('omits absent audit optional fields and skips audit honeypot notifications', async () => {
        vi.mocked(auditRequestsService.createAuditRequest).mockResolvedValue({
            id: 'record-internal-audit',
            name: 'Grace Hopper',
            email: 'grace@example.com',
            website_url: 'https://example.com',
            phone_number: null,
            specifics: null,
            other_detail: null,
            status: 'pending',
            prospect_id: prospectId,
            promo_code: null,
            attribution: null,
            created_at: '2026-05-19T18:15:00.000Z',
            updated_at: '2026-05-19T18:15:00.000Z',
        })
        const res = createResponse()

        await auditController.createAuditRequest(
            createRequest({
                name: 'Grace Hopper',
                email: 'grace@example.com',
                websiteUrl: 'https://example.com',
            }),
            res
        )

        expectSuccessfulResponse(res, 201, { message: 'Audit request received.' })
        expect(latestSlackPayload()?.fields).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ label: 'Other Details' }),
                expect.objectContaining({ label: 'Promo' }),
            ])
        )

        vi.clearAllMocks()
        const honeypotRes = createResponse()
        await auditController.createAuditRequest(
            createRequest({
                name: 'Bot Audit',
                email: 'bot@example.com',
                websiteUrl: 'https://example.com',
                honeypot: 'filled',
            }),
            honeypotRes
        )

        expectSuccessfulResponse(honeypotRes, 200, {
            message: 'Audit request received.',
        })
        expect(upsertProspect).not.toHaveBeenCalled()
        expect(auditRequestsService.createAuditRequest).not.toHaveBeenCalled()
        expect(sendSlackNotification).not.toHaveBeenCalled()
    })

    it('keeps audit responses successful when Slack notification rejects', async () => {
        vi.mocked(auditRequestsService.createAuditRequest).mockResolvedValue({
            id: 'record-internal-audit',
            name: 'Grace Hopper',
            email: 'grace@example.com',
            website_url: 'https://example.com',
            phone_number: null,
            specifics: null,
            other_detail: null,
            status: 'pending',
            prospect_id: prospectId,
            promo_code: null,
            attribution: null,
            created_at: '2026-05-19T18:15:00.000Z',
            updated_at: '2026-05-19T18:15:00.000Z',
        })
        vi.mocked(sendSlackNotification).mockRejectedValue(new Error('Slack down'))
        const res = createResponse()

        await auditController.createAuditRequest(
            createRequest({
                name: 'Grace Hopper',
                email: 'grace@example.com',
                websiteUrl: 'https://example.com',
            }),
            res
        )

        expectSuccessfulResponse(res, 201, { message: 'Audit request received.' })
        expect(sendSlackNotification).toHaveBeenCalledOnce()
    })

    it('sends a customer-facing Slack alert after Calendly booking persistence succeeds', async () => {
        vi.mocked(calendlyBookingsService.findBookingByEventUri).mockResolvedValue(null)
        vi.mocked(calendlyBookingsService.createBooking).mockResolvedValue({} as any)
        vi.mocked(fetch)
            .mockResolvedValueOnce(
                calendlyResponse({
                    name: 'Discovery Call',
                    start_time: '2026-05-20T15:00:00.000Z',
                    end_time: '2026-05-20T15:30:00.000Z',
                })
            )
            .mockResolvedValueOnce(
                calendlyResponse({
                    name: 'Alan Turing',
                    email: 'alan@example.com',
                    cancel_url: 'https://calendly.com/cancellations/test',
                    reschedule_url: 'https://calendly.com/reschedulings/test',
                })
            )
        const res = createResponse()

        await calendlyWebhookController.handleWebhook(
            createRequest({ event_uri: eventUri, invitee_uri: inviteeUri, attribution }),
            res
        )

        expectSuccessfulResponse(res, 200, { message: 'Booking recorded.' })
        expect(calendlyBookingsService.createBooking).toHaveBeenCalledWith(
            expect.objectContaining({
                prospectId,
                calendlyEventUri: eventUri,
                calendlyInviteeUri: inviteeUri,
                eventTypeName: 'Discovery Call',
                attribution,
            })
        )
        expectCalledBefore(
            vi.mocked(calendlyBookingsService.createBooking),
            vi.mocked(sendSlackNotification)
        )
        expect(sendSlackNotification).toHaveBeenCalledWith({
            title: 'New Calendly Booking',
            category: 'Calendar',
            description: 'A prospective client booked a Calendly call.',
            fields: [
                { label: 'Name', value: 'Alan Turing' },
                { label: 'Email', value: 'alan@example.com' },
                { label: 'Event', value: 'Discovery Call' },
                {
                    label: 'Scheduled',
                    value: expect.stringContaining('May 20, 2026'),
                },
                {
                    label: 'Cancel Link',
                    value: 'https://calendly.com/cancellations/test',
                },
            ],
        })
        expectNoInternalData(latestSlackPayload())
    })

    it('omits absent Calendly cancel link and keeps success when Slack rejects', async () => {
        vi.mocked(calendlyBookingsService.findBookingByEventUri).mockResolvedValue(null)
        vi.mocked(calendlyBookingsService.createBooking).mockResolvedValue({} as any)
        vi.mocked(sendSlackNotification).mockRejectedValue(new Error('Slack down'))
        vi.mocked(fetch)
            .mockResolvedValueOnce(
                calendlyResponse({
                    name: 'Discovery Call',
                    start_time: '2026-05-20T15:00:00.000Z',
                    end_time: '2026-05-20T15:30:00.000Z',
                })
            )
            .mockResolvedValueOnce(
                calendlyResponse({
                    name: 'Alan Turing',
                    email: 'alan@example.com',
                    cancel_url: null,
                    reschedule_url: null,
                })
            )
        const res = createResponse()

        await calendlyWebhookController.handleWebhook(
            createRequest({ event_uri: eventUri, invitee_uri: inviteeUri }),
            res
        )

        expectSuccessfulResponse(res, 200, { message: 'Booking recorded.' })
        expect(latestSlackPayload()?.fields).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ label: 'Cancel Link' }),
            ])
        )
    })
})
