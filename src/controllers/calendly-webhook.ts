import crypto from 'crypto'
import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import { handleGenericError } from '../utils/http'
import { upsertProspect } from '../services/prospects'
import calendlyBookingsService from '../services/calendly-bookings'

// ─── Zod schema ──────────────────────────────────────────────────────────────

const calendlyBookingSchema = z.object({
    event: z.literal('invitee.created'),
    payload: z.object({
        event_type: z.object({ name: z.string() }),
        event: z.object({
            uri: z.string(),
            start_time: z.string(),
            end_time: z.string(),
        }),
        invitee: z.object({
            name: z.string(),
            email: z.string().email(),
            uri: z.string(),
            cancel_url: z.string(),
            reschedule_url: z.string(),
        }),
    }),
})

const calendlyCancellationSchema = z.object({
    event: z.literal('invitee.canceled'),
    payload: z.object({
        event: z.object({
            uri: z.string(),
            start_time: z.string(),
        }),
        invitee: z.object({
            name: z.string(),
            email: z.string().email(),
            cancellation: z.object({ canceled_at: z.string() }),
        }),
    }),
})

const calendlyWebhookSchema = z.discriminatedUnion('event', [
    calendlyBookingSchema,
    calendlyCancellationSchema,
])

// ─── Signature verification ───────────────────────────────────────────────────

const verifyCalendlySignature = (req: Request, signingKey: string): boolean => {
    const signature = req.headers['calendly-webhook-signature'] as string | undefined
    if (!signature) return false

    const parts = signature.split(',')
    const tPart = parts.find((p) => p.startsWith('t='))
    const v1Part = parts.find((p) => p.startsWith('v1='))
    if (!tPart || !v1Part) return false

    const timestamp = tPart.slice(2)
    const receivedSig = v1Part.slice(3)

    const payload = `${timestamp}.${JSON.stringify(req.body)}`
    const expected = crypto
        .createHmac('sha256', signingKey)
        .update(payload)
        .digest('hex')

    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSig))
    } catch {
        return false
    }
}

// ─── Discord notifications ────────────────────────────────────────────────────

const DISCORD_USERNAME = 'PixelVerse Calendly Alerts'
const DISCORD_COLOR = 0x3f00e9

const resolveWebhookUrl = (): string => {
    const url = process.env.LEAD_NOTIFY_DISCORD_WEBHOOK?.trim()
    if (!url) throw new Error('LEAD_NOTIFY_DISCORD_WEBHOOK is not configured')
    return url
}

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
    cancelUrl: string
): Promise<void> => {
    const webhookUrl = resolveWebhookUrl()
    const description = [
        '────────────────────────',
        `👤 Name:      ${name}`,
        `📧 Email:     ${email}`,
        `🗓 Event:     ${eventTypeName}`,
        `📆 Scheduled: ${formatEventTime(eventStartAt)}`,
        `🔗 Cancel:    ${cancelUrl}`,
    ].join('\n')

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: DISCORD_USERNAME,
            content: '📅 Calendly Call Booked',
            embeds: [
                {
                    description,
                    color: DISCORD_COLOR,
                    timestamp: new Date().toISOString(),
                    footer: { text: 'Calendly booking notifications' },
                },
            ],
        }),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Discord webhook failed (${response.status}): ${errorText}`)
    }
}

const sendCancellationNotification = async (
    name: string,
    email: string,
    eventStartAt: string,
    canceledAt: string
): Promise<void> => {
    const webhookUrl = resolveWebhookUrl()
    const description = [
        '─────────────────────────',
        `👤 Name:      ${name}`,
        `📧 Email:     ${email}`,
        `📆 Was:       ${formatEventTime(eventStartAt)}`,
        `🕐 Canceled:  ${formatEventTime(canceledAt)}`,
    ].join('\n')

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: DISCORD_USERNAME,
            content: '❌ Calendly Call Canceled',
            embeds: [
                {
                    description,
                    color: 0xff4444,
                    timestamp: new Date().toISOString(),
                    footer: { text: 'Calendly booking notifications' },
                },
            ],
        }),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Discord webhook failed (${response.status}): ${errorText}`)
    }
}

// ─── Controller ───────────────────────────────────────────────────────────────

const handleWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
        const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY?.trim()
        if (!signingKey) {
            console.error('CALENDLY_WEBHOOK_SIGNING_KEY is not configured')
            return res.status(401).json({ error: 'Unauthorized' })
        }

        if (!verifyCalendlySignature(req, signingKey)) {
            return res.status(401).json({ error: 'Invalid signature' })
        }

        const parsed = calendlyWebhookSchema.parse(req.body)

        if (parsed.event === 'invitee.created') {
            const { payload } = parsed
            const { name, email, uri: inviteeUri, cancel_url, reschedule_url } = payload.invitee
            const { uri: eventUri, start_time, end_time } = payload.event
            const { name: eventTypeName } = payload.event_type

            // Idempotency: skip if already processed
            const existing = await calendlyBookingsService.findBookingByEventUri(eventUri)
            if (existing) {
                console.log('Calendly booking already recorded (idempotent)', { eventUri })
                return res.status(200).json({ message: 'Already processed.' })
            }

            const prospectId = await upsertProspect(email, name, 'calendly_call')

            await calendlyBookingsService.createBooking({
                prospectId,
                calendlyEventUri: eventUri,
                calendlyInviteeUri: inviteeUri,
                eventTypeName,
                eventStartAt: start_time,
                eventEndAt: end_time,
                cancelUrl: cancel_url,
                rescheduleUrl: reschedule_url,
            })

            sendBookingNotification(name, email, eventTypeName, start_time, cancel_url).catch(
                (err) => console.error('Discord notification failed (booking saved):', err)
            )

            console.log('Calendly booking created', { email, eventUri })
            return res.status(200).json({ message: 'Booking recorded.' })
        }

        if (parsed.event === 'invitee.canceled') {
            const { payload } = parsed
            const { name, email, cancellation } = payload.invitee
            const { uri: eventUri, start_time } = payload.event

            await calendlyBookingsService.cancelBooking(eventUri)

            sendCancellationNotification(
                name,
                email,
                start_time,
                cancellation.canceled_at
            ).catch((err) =>
                console.error('Discord notification failed (cancellation saved):', err)
            )

            console.log('Calendly booking canceled', { email, eventUri })
            return res.status(200).json({ message: 'Cancellation recorded.' })
        }

        return res.status(200).json({ message: 'Event ignored.' })
    } catch (err) {
        if (err instanceof ZodError) {
            return res.status(400).json({
                error: 'Invalid payload',
                details: err.flatten(),
            })
        }
        return handleGenericError(err, res)
    }
}

const calendlyWebhookController = { handleWebhook }

export default calendlyWebhookController
