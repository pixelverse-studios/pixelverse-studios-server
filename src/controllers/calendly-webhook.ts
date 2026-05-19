import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import { handleGenericError } from '../utils/http'
import { upsertProspect } from '../services/prospects'
import calendlyBookingsService from '../services/calendly-bookings'
import { sendSlackNotification } from '../lib/slack-notifier'

// ─── Zod schema ──────────────────────────────────────────────────────────────

const calendlyBookingSchema = z.object({
    event_uri: z.string().url(),
    invitee_uri: z.string().url(),
    attribution: z.unknown().optional(),
})

// ─── Calendly API client ──────────────────────────────────────────────────────

interface CalendlyEvent {
    resource: {
        name: string
        start_time: string
        end_time: string
    }
}

interface CalendlyInvitee {
    resource: {
        name: string
        email: string
        cancel_url: string | null
        reschedule_url: string | null
    }
}

const CALENDLY_ORIGIN = 'https://api.calendly.com/'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const extractUuid = (uri: string): string => {
    if (!uri.startsWith(CALENDLY_ORIGIN)) {
        throw { status: 400, message: 'Invalid URI: must originate from api.calendly.com' }
    }
    const lastSegment = uri.split('/').at(-1) ?? ''
    const uuid = lastSegment.split('?')[0]
    if (!UUID_RE.test(uuid)) {
        throw { status: 400, message: 'Invalid URI: could not extract a valid UUID' }
    }
    return uuid
}

const calendlyFetch = async <T>(path: string): Promise<T> => {
    const token = process.env.CALENDLY_API_TOKEN?.trim()
    if (!token) throw new Error('CALENDLY_API_TOKEN is not configured')

    const response = await fetch(`${CALENDLY_ORIGIN}${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    })

    if (!response.ok) {
        console.error('Calendly API error', { status: response.status, path })
        throw { status: 502, message: 'Unable to retrieve booking details from Calendly.' }
    }

    return response.json() as Promise<T>
}

// ─── Slack notifications ──────────────────────────────────────────────────────

const formatEventTime = (isoString: string): string => {
    const date = new Date(isoString)
    return date.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
        timeZone: 'America/New_York',
    })
}

const sendBookingNotification = async (
    name: string,
    email: string,
    eventTypeName: string,
    eventStartAt: string,
    cancelUrl: string | null
): Promise<void> => {
    await sendSlackNotification({
        title: 'New Calendly Booking',
        category: 'Calendar',
        description: 'A prospective client booked a Calendly call.',
        fields: [
            { label: 'Name', value: name },
            { label: 'Email', value: email },
            { label: 'Event', value: eventTypeName },
            { label: 'Scheduled', value: formatEventTime(eventStartAt) },
            ...(cancelUrl ? [{ label: 'Cancel Link', value: cancelUrl }] : []),
        ],
    })
}

// ─── Controller ───────────────────────────────────────────────────────────────

const handleWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { event_uri, invitee_uri, attribution } = calendlyBookingSchema.parse(
            req.body
        )

        // Idempotency: skip if already processed
        const existing = await calendlyBookingsService.findBookingByEventUri(event_uri)
        if (existing) {
            console.log('Calendly booking already recorded (idempotent)', { event_uri })
            return res.status(200).json({ message: 'Already processed.' })
        }

        // Fetch event + invitee details from Calendly API
        const eventUuid = extractUuid(event_uri)
        const inviteeUuid = extractUuid(invitee_uri)

        const [eventData, inviteeData] = await Promise.all([
            calendlyFetch<CalendlyEvent>(`scheduled_events/${eventUuid}`),
            calendlyFetch<CalendlyInvitee>(
                `scheduled_events/${eventUuid}/invitees/${inviteeUuid}`
            ),
        ])

        const { name: eventTypeName, start_time, end_time } = eventData.resource
        const { name, email, cancel_url, reschedule_url } = inviteeData.resource

        if (!name || !email) {
            throw { status: 422, message: 'Incomplete invitee data returned from Calendly.' }
        }

        const prospectId = await upsertProspect(email, name, 'calendly_call')

        await calendlyBookingsService.createBooking({
            prospectId,
            calendlyEventUri: event_uri,
            calendlyInviteeUri: invitee_uri,
            eventTypeName,
            eventStartAt: start_time,
            eventEndAt: end_time,
            cancelUrl: cancel_url,
            rescheduleUrl: reschedule_url,
            attribution,
        })

        sendBookingNotification(name, email, eventTypeName, start_time, cancel_url).catch(
            (err) => console.error('Slack notification failed (booking saved):', err)
        )

        console.log('Calendly booking created', { email, event_uri })
        return res.status(200).json({ message: 'Booking recorded.' })
    } catch (err) {
        if (err instanceof ZodError) {
            return res.status(400).json({
                error: 'Invalid payload',
                details: err.flatten(),
            })
        }
        // DB unique constraint — concurrent duplicate submission
        if ((err as any)?.code === '23505') {
            return res.status(200).json({ message: 'Already processed.' })
        }
        return handleGenericError(err, res)
    }
}

const calendlyWebhookController = { handleWebhook }

export default calendlyWebhookController
