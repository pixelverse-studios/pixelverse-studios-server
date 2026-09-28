import { DispatchFailure, createDispatchDiagnostics } from './domani-feedback-dispatch-diagnostics'
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
    const claim = await domaniDb.rpc('claim_domani_feedback_reply').then(result => result, error => {
        throw new DispatchFailure('claim_domani_feedback_reply', error)
    })
    if (claim.error) throw new DispatchFailure('claim_domani_feedback_reply', claim.error, claim.status)
    const data = claim.data
    if (!data) return false
    const job = data as Job
    if (job.skipped) return true
    const result = await send(job).catch(error => {
        throw new DispatchFailure('send_support_reply', error)
    })
    const finish = await domaniDb.rpc('finish_domani_feedback_reply', {
        p_message_id: job.message_id, p_lease_token: job.lease_token, p_outcome: result.outcome,
        p_provider_id: result.providerId ?? null, p_error_code: result.errorCode ?? null,
    }).then(result => result, error => {
        throw new DispatchFailure('finish_domani_feedback_reply', error)
    })
    // If this write fails, the lease expires and recovery uses the same provider key.
    if (finish.error) throw new DispatchFailure('finish_domani_feedback_reply', finish.error, finish.status)
    return true
}
export function startFeedbackReplyDispatcher(): NodeJS.Timeout | null {
    if (!feedbackSendingEnabled()) return null
    let running = false
    const diagnostics = createDispatchDiagnostics()
    const run = async () => {
        if (running) return
        running = true
        try {
            for (let n = 0; n < 10 && await dispatchFeedbackReply(); n++) { /* bounded drain */ }
            diagnostics.healthy()
        }
        catch (error) { diagnostics.failure(error) }
        finally { running = false }
    }
    void run()
    const timer = setInterval(() => { void run() }, 10_000)
    timer.unref()
    return timer
}
