import { z } from 'zod'
import { convert } from 'html-to-text'
import sanitizeHtml from 'sanitize-html'
import { domaniDb } from '../lib/domani-db'

export function feedbackReplyDomain(): string | undefined {
    if (process.env.DOMANI_FEEDBACK_INBOUND_ENABLED !== 'true') return undefined
    const domain = process.env.DOMANI_FEEDBACK_REPLY_DOMAIN?.trim().toLowerCase()
    if (!domain || domain.length > 180 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || domain === 'domani-app.com')
        throw new Error('A dedicated receiving domain is required')
    return domain
}
const received = z.object({
    id: z.string().uuid(), from: z.string().max(1000), to: z.array(z.string().max(1000)).max(100),
    created_at: z.string().datetime({ offset: true }), subject: z.string().max(10000).nullable(),
    text: z.string().max(1_000_000).nullable(), html: z.string().max(1_000_000).nullable(),
    message_id: z.string().max(1000), headers: z.record(z.string().max(10000)).default({}),
    attachments: z.array(z.unknown()).max(1000).default([]),
})
function mailbox(value: string): string | null {
    if (/[\x00-\x1f\x7f]/.test(value)) return null
    const candidate = (value.match(/^[^<>]*<([^<>]+)>$/)?.[1] || value).trim().toLowerCase()
    return candidate.length <= 320 && /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/.test(candidate) ? candidate : null
}
export function normalizeIncoming(value: unknown, providerId: string) {
    const email = received.parse(value)
    if (email.id !== providerId) throw new Error('Provider identity mismatch')
    const headers = Object.fromEntries(Object.entries(email.headers).map(([key, val]) => [key.toLowerCase(), val]))
    let reason: string | null = null
    const from = mailbox(email.from)
    const to = email.to.map(mailbox).filter((address): address is string => !!address)
    if (!from || to.length !== email.to.length) reason = 'INVALID_PARTICIPANT'
    if ((headers['auto-submitted'] && headers['auto-submitted'].toLowerCase() !== 'no') ||
        /^(bulk|list|junk)$/i.test(headers.precedence || '') || headers['return-path']?.trim() === '<>' ||
        /multipart\/report/i.test(headers['content-type'] || '') || /^(mailer-daemon|postmaster)@/i.test(from || '')) reason = 'AUTOMATED_MAIL'
    const safeHtml = sanitizeHtml(email.html || '', { allowedTags: ['p','div','br','blockquote','pre','ul','ol','li','strong','em'], allowedAttributes: {} })
    const text = (email.text?.trim() || convert(safeHtml, { wordwrap: false })).replace(/\u0000/g, '').trim()
    if (text.length > 20000) reason = 'MESSAGE_TOO_LARGE'
    const messageId = /^<[^<>\s\x00-\x1f\x7f]+>$/.test(email.message_id) ? email.message_id : null
    if (!messageId) reason = 'INVALID_MESSAGE_ID'
    const inReplyTo = headers['in-reply-to']?.match(/<[^<>\s\x00-\x1f\x7f]+>/g) || []
    if (inReplyTo.length > 1) reason = 'AMBIGUOUS_THREAD'
    return {
        from: from || '', to, subject: (email.subject || '(No subject)').replace(/[\r\n\u0000]/g, ' ').trim().slice(0,200) || '(No subject)',
        text: text.slice(0,20000) || (email.attachments.length ? '[Message contains attachments only.]' : '[Empty message.]'),
        created_at: email.created_at, message_id: messageId,
        in_reply_to: inReplyTo[0] || null, references: (headers.references?.match(/<[^<>\s\x00-\x1f\x7f]+>/g) || []).slice(-100),
        attachment_count: email.attachments.length, quarantine_reason: reason,
    }
}
export async function recordIncomingEvent(eventId: string, payload: unknown) {
    const event = z.object({ type: z.literal('email.received'), data: z.object({ email_id: z.string().uuid() }) }).parse(payload)
    const { error } = await domaniDb.rpc('receive_domani_feedback_inbound', { p_event_id: eventId, p_provider_id: event.data.email_id })
    if (error) throw error
}
async function boundedJson(response: Response) {
    if (!response.body) throw new Error('Missing provider response')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []; let total = 0
    try {
        while (true) {
            const { value, done } = await reader.read()
            if (done) break
            total += value.length
            if (total > 1_000_000) { await reader.cancel(); throw new Error('Provider response exceeds limit') }
            chunks.push(value)
        }
    } finally { reader.releaseLock() }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export async function ingestFeedbackReply(): Promise<boolean> {
    if (!feedbackReplyDomain() || !process.env.RESEND_API_KEY) return false
    const { data: job, error } = await domaniDb.rpc('claim_domani_feedback_inbound')
    if (error) throw error
    if (!job) return false
    if (job.skipped) return true
    let payload: unknown = null; let failure: string | null = null
    try {
        const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(job.provider_id)}`, {
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) throw new Error('Provider retrieval failed')
        payload = normalizeIncoming(await boundedJson(response), job.provider_id)
    } catch { failure = 'PROVIDER_RETRIEVAL_FAILED' }
    const { error: finishError } = await domaniDb.rpc('finish_domani_feedback_inbound', {
        p_provider_id: job.provider_id, p_lease_token: job.lease_token, p_payload: payload, p_error: failure,
    })
    if (finishError) throw finishError
    return true
}
export function startFeedbackInboundWorker(): NodeJS.Timeout | null {
    if (process.env.DOMANI_FEEDBACK_INBOUND_ENABLED !== 'true') return null
    let running = false
    const run = async () => {
        if (running) return
        running = true
        try { for (let n=0;n<5 && await ingestFeedbackReply();n++) { /* bounded retrieval */ } }
        catch { console.error('Domani inbound ingestion requires attention') }
        finally { running = false }
    }
    void run()
    const timer = setInterval(() => { void run() }, 30000)
    timer.unref()
    return timer
}
