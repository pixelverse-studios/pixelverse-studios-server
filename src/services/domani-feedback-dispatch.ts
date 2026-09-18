import { domaniDb } from '../lib/domani-db'

export const feedbackSendingEnabled = () => process.env.DOMANI_FEEDBACK_SENDING_ENABLED === 'true' && !!process.env.RESEND_API_KEY
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
export const supportReplyHtml = (text: string) => `<div style="font-family:Arial,sans-serif;line-height:1.6;white-space:pre-wrap">${escapeHtml(text)}</div>`

type Job = { skipped?: boolean; message_id: string; lease_token: string; payload: Record<string, unknown>; idempotency_key: string; send_before: string }
type Outcome = { outcome: 'accepted' | 'retryable' | 'permanent' | 'unknown'; providerId?: string; errorCode?: string }

// The installed Resend v3 SDK cannot set HTTP Idempotency-Key. Keep a dedicated
// bounded REST adapter instead of silently dropping the key or altering campaigns.
export async function sendSupportReply(job: Job): Promise<Outcome> {
    if (!Number.isFinite(Date.parse(job.send_before)) || Date.now() >= Date.parse(job.send_before)) return { outcome: 'unknown', errorCode: 'LEASE_EXPIRED' }
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json', 'Idempotency-Key': job.idempotency_key },
            body: JSON.stringify(job.payload), signal: AbortSignal.timeout(15_000),
        })
        const body = await response.json() as { id?: string; name?: string; error?: unknown }
        if (response.ok && !body.error && typeof body.id === 'string' && body.id) return { outcome: 'accepted', providerId: body.id }
        if (body.name === 'invalid_idempotent_request') return { outcome: 'unknown', errorCode: 'RECONCILIATION_REQUIRED' }
        if (response.status === 429 || body.name === 'concurrent_idempotent_requests') return { outcome: 'retryable', errorCode: 'PROVIDER_BUSY' }
        // Server errors or malformed success may follow acceptance. Never call these definitive failures.
        if (response.status >= 500 || response.ok) return { outcome: 'unknown', errorCode: 'PROVIDER_UNCERTAIN' }
        return { outcome: 'permanent', errorCode: 'PROVIDER_REJECTED' }
    } catch { return { outcome: 'unknown', errorCode: 'PROVIDER_UNCERTAIN' } }
}

export async function dispatchFeedbackReply(send = sendSupportReply): Promise<boolean> {
    if (!feedbackSendingEnabled()) return false
    const { data, error } = await domaniDb.rpc('claim_domani_feedback_reply')
    if (error) throw error
    if (!data) return false
    const job = data as Job
    if (job.skipped) return true
    const result = await send(job)
    const { error: finishError } = await domaniDb.rpc('finish_domani_feedback_reply', {
        p_message_id: job.message_id, p_lease_token: job.lease_token, p_outcome: result.outcome,
        p_provider_id: result.providerId ?? null, p_error_code: result.errorCode ?? null,
    })
    // If this write fails, the lease expires and recovery uses the same provider key.
    if (finishError) throw finishError
    return true
}
export function startFeedbackReplyDispatcher(): NodeJS.Timeout | null {
    if (!feedbackSendingEnabled()) return null
    let running = false
    const run = async () => {
        if (running) return
        running = true
        try { for (let n = 0; n < 10 && await dispatchFeedbackReply(); n++) { /* bounded drain */ } }
        catch { console.error('Domani feedback dispatch requires attention') }
        finally { running = false }
    }
    void run()
    const timer = setInterval(() => { void run() }, 10_000)
    timer.unref()
    return timer
}
