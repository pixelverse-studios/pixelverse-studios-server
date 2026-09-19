import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { domaniDb } from '../lib/domani-db'
import type { FeedbackSource } from '../lib/domani-feedback'

const tags = z.union([z.record(z.string()), z.array(z.object({ name: z.string(), value: z.string() }))]).optional()
export const deliveryEventSchema = z.object({
    type: z.string().min(1).max(100), created_at: z.string().datetime({ offset: true }),
    data: z.object({ email_id: z.string().min(1).max(250).optional(), tags }).passthrough(),
})
export async function recordDeliveryEvent(eventId: string, payload: unknown) {
    const event = deliveryEventSchema.parse(payload)
    const value = Array.isArray(event.data.tags)
        ? event.data.tags.find(tag => tag.name === 'domani_feedback_message')?.value
        : event.data.tags?.domani_feedback_message
    const parsed = z.string().uuid().safeParse(value)
    const { data, error } = await domaniDb.rpc('receive_domani_feedback_delivery', {
        p_event_id: eventId, p_provider_id: event.data.email_id || 'non-email-event',
        p_event_type: event.type, p_occurred_at: event.created_at,
        p_tagged_message_id: parsed.success ? parsed.data : null,
    })
    if (error) throw error
    if (data === 'applied' && typeof event.data.message_id === 'string' && /^<[^<>\s]{1,998}>$/.test(event.data.message_id)) {
        const { error: rfcError } = await domaniDb.rpc('record_domani_feedback_rfc_id', { p_provider_id: event.data.email_id, p_rfc_id: event.data.message_id })
        if (rfcError) throw rfcError
    }
    if (data === 'unmatched') console.warn('Domani delivery event awaiting correlation', { eventId })
    return data
}

// This is a GET to the provider, never a send. The DB rate-limits each message.
export async function reconcileDelivery(source: FeedbackSource, id: string, key: string) {
    if (!process.env.RESEND_API_KEY) return
    const { data: job, error } = await domaniDb.rpc('claim_domani_feedback_delivery_check', {
        p_source: source, p_id: id, p_key: key,
    })
    if (error) throw error
    if (!job) return
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(job.provider_id)}`, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('Delivery check unavailable')
    const email = z.object({ id: z.string(), last_event: z.string() }).parse(await response.json())
    if (email.id !== job.provider_id) throw new Error('Delivery check mismatch')
    // Open/click evidence does not imply delivery beyond the provider's delivery event.
    const supported = ['sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed']
    if (!supported.includes(email.last_event)) return
    await recordDeliveryEvent(`reconcile-${randomUUID()}`, {
        type: `email.${email.last_event}`, created_at: new Date().toISOString(), data: { email_id: email.id },
    })
}
export async function replayDeliveryEvents() {
    const { error } = await domaniDb.rpc('replay_domani_feedback_delivery')
    if (error) throw error
}
export function startFeedbackDeliveryReplay(): NodeJS.Timeout | null {
    if (!process.env.DOMANI_FEEDBACK_WEBHOOK_SECRET) return null
    let running = false
    const run = async () => {
        if (running) return
        running = true
        try { await replayDeliveryEvents() }
        catch { console.error('Domani delivery replay requires attention') }
        finally { running = false }
    }
    void run()
    const timer = setInterval(() => { void run() }, 30_000)
    timer.unref()
    return timer
}
