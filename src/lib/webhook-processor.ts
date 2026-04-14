import { db, Tables } from './db'
import pendingWebhookEvents, {
    ErrorReason,
    ErrorReasons,
    PendingWebhookEvent,
} from '../services/pending-webhook-events'
import deploymentsService from '../services/deployments'
import { sendDeploymentEmail } from './nylas-mailer'

// How often the in-process poller wakes up to check for due retries.
// The first attempt for any event happens inline in the request handler;
// this interval only affects retry latency after a failure.
export const POLL_INTERVAL_MS = 60_000

// Buffer added to a new row's next_retry_at at insert time so the poller
// cannot claim a row while the inline handler is still processing it.
// Set comfortably above any realistic inline-handler duration.
export const INLINE_OWNERSHIP_BUFFER_MS = 2 * POLL_INTERVAL_MS

const BATCH_SIZE = 10
const INLINE_CONCURRENCY = 3
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000

export type WebhookEventType = 'deployment'

export interface DeploymentEventPayload {
    website_id: string
    changed_urls: string[]
    deploy_summary: string
    internal_notes?: string
}

/**
 * Thrown by processors when the error is permanent and no retry should be
 * attempted (e.g. the referenced website no longer exists). Causes the
 * event to be marked 'failed' immediately rather than scheduled for retry.
 * The `reason` is stored in last_error; the optional `detail` is logged
 * to console for operators but never persisted.
 */
export class NonRetryableWebhookError extends Error {
    reason: ErrorReason
    detail?: string
    constructor(reason: ErrorReason, detail?: string) {
        super(`non-retryable: ${reason}`)
        this.name = 'NonRetryableWebhookError'
        this.reason = reason
        this.detail = detail
    }
}

export interface WebsiteContext {
    id: string
    title: string
    contact_email: string | null
    client_id: string
}

export interface DeploymentRecord {
    id: string
    created_at: string
    [key: string]: unknown
}

export interface SuccessResult {
    status: 'success'
    deployment: DeploymentRecord
    attempts: number
}
export interface RetryScheduledResult {
    status: 'retry_scheduled'
    attempts: number
    reason: ErrorReason
}
export interface PermanentFailureResult {
    status: 'permanent_failure'
    attempts: number
    reason: ErrorReason
}

export type ProcessResult =
    | SuccessResult
    | RetryScheduledResult
    | PermanentFailureResult

/**
 * Process a deployment event: optionally skip the website re-fetch when the
 * caller already has it (the inline controller path), create/reuse the
 * deployment row, persist result_ref + email_sent_at for idempotency, then
 * send the notification email.
 *
 * Idempotency:
 * - result_ref set → reuse the existing deployment row; do not INSERT again.
 * - email_sent_at set → skip the email send; do not notify the client again.
 * Both flags persist before the next fallible step so a crash between any
 * two steps cannot cause duplicate DB rows or duplicate emails.
 *
 * Returns the full deployment record so callers (the controller) can
 * respond without another round-trip to Supabase.
 */
export const processDeploymentEvent = async (
    event: PendingWebhookEvent,
    prefetchedWebsite?: WebsiteContext,
): Promise<DeploymentRecord> => {
    const payload = event.payload as unknown as DeploymentEventPayload
    const { website_id, changed_urls, deploy_summary, internal_notes } = payload

    let website: WebsiteContext
    if (prefetchedWebsite && prefetchedWebsite.id === website_id) {
        website = prefetchedWebsite
    } else {
        const { data, error: websiteError } = await db
            .from(Tables.WEBSITES)
            .select('id, title, contact_email, client_id')
            .eq('id', website_id)
            .single()

        if (websiteError || !data) {
            throw new NonRetryableWebhookError(
                ErrorReasons.WEBSITE_NOT_FOUND,
                `website_id=${website_id}`,
            )
        }
        website = data as WebsiteContext
    }

    let deployment: DeploymentRecord

    if (event.result_ref) {
        const existing = await deploymentsService.getDeploymentById(
            event.result_ref,
        )
        if (existing) {
            deployment = existing as unknown as DeploymentRecord
        } else {
            console.warn(
                `⚠️  event ${event.id}: result_ref ${event.result_ref} missing; recreating deployment`,
            )
            const fresh = await deploymentsService.createDeployment({
                website_id,
                changed_urls,
                deploy_summary,
                internal_notes,
            })
            deployment = fresh as DeploymentRecord
            await pendingWebhookEvents.setResultRef(event.id, deployment.id)
        }
    } else {
        const fresh = await deploymentsService.createDeployment({
            website_id,
            changed_urls,
            deploy_summary,
            internal_notes,
        })
        deployment = fresh as DeploymentRecord
        // Persist result_ref BEFORE attempting email so a crash between
        // createDeployment and markDone cannot cause duplicate rows on
        // the next retry.
        await pendingWebhookEvents.setResultRef(event.id, deployment.id)
    }

    if (!event.email_sent_at && website.contact_email) {
        try {
            await sendDeploymentEmail({
                to: website.contact_email,
                websiteTitle: website.title,
                deploymentDate: new Date(
                    deployment.created_at,
                ).toLocaleDateString(),
                summaryMarkdown: deploy_summary,
            })
            await pendingWebhookEvents.setEmailSent(event.id)
            console.log(
                '✅ Deployment email sent:',
                website.contact_email,
                'for',
                website.title,
            )
        } catch (emailError) {
            console.error(
                '❌ Error sending deployment email (non-fatal):',
                emailError,
            )
        }
    }

    return deployment
}

const runProcessor = async (
    event: PendingWebhookEvent,
    prefetchedWebsite?: WebsiteContext,
): Promise<DeploymentRecord> => {
    switch (event.event_type as WebhookEventType) {
        case 'deployment':
            return processDeploymentEvent(event, prefetchedWebsite)
        default:
            throw new NonRetryableWebhookError(
                ErrorReasons.UNKNOWN,
                `unknown event_type: ${event.event_type}`,
            )
    }
}

const classifyError = (err: unknown): ErrorReason => {
    if (err instanceof NonRetryableWebhookError) return err.reason
    const msg = err instanceof Error ? err.message : String(err)
    // Order matters: DB-shape errors often mention 'email' as a column
    // name in leads/contact-forms tables, so check DB-failure patterns
    // first to avoid mis-classifying them as EMAIL_SEND_FAILED.
    if (/\b(insert|duplicate|constraint|relation|column|pgrst)\b/i.test(msg)) {
        return ErrorReasons.DB_INSERT_FAILED
    }
    if (/\b(nylas|smtp|sendgrid|mailer|failed to send)\b/i.test(msg)) {
        return ErrorReasons.EMAIL_SEND_FAILED
    }
    return ErrorReasons.UNKNOWN
}

/**
 * Process a single pending event. Used both by the inline path (first
 * attempt inside the request handler) and by the poller (scheduled retries).
 *
 * Returns a discriminated result so callers can distinguish success from
 * scheduled-retry from permanent-failure without additional round-trips.
 */
export const processEvent = async (
    event: PendingWebhookEvent,
    prefetchedWebsite?: WebsiteContext,
): Promise<ProcessResult> => {
    const attempts = event.attempts + 1
    try {
        const deployment = await runProcessor(event, prefetchedWebsite)
        await pendingWebhookEvents.markDone(event.id, attempts, deployment.id)
        return { status: 'success', deployment, attempts }
    } catch (err) {
        const isNonRetryable = err instanceof NonRetryableWebhookError
        const reason = classifyError(err)
        const rawMessage = err instanceof Error ? err.message : String(err)

        if (isNonRetryable) {
            console.error(
                `❌ webhook event ${event.id} non-retryable (${reason}):`,
                (err as NonRetryableWebhookError).detail ?? rawMessage,
            )
            await pendingWebhookEvents.markFailed(event.id, attempts, reason)
            return { status: 'permanent_failure', attempts, reason }
        }

        console.error(
            `⚠️  webhook event ${event.id} attempt ${attempts} failed (${reason}):`,
            rawMessage,
        )

        const { scheduled } = await pendingWebhookEvents.scheduleNextRetry(
            event.id,
            attempts,
            reason,
        )
        if (!scheduled) {
            console.error(
                `❌ webhook event ${event.id} retry budget exhausted (${reason})`,
            )
            await pendingWebhookEvents.markFailed(event.id, attempts, reason)
            return { status: 'permanent_failure', attempts, reason }
        }
        return { status: 'retry_scheduled', attempts, reason }
    }
}

let processorInterval: NodeJS.Timeout | null = null
let cleanupInterval: NodeJS.Timeout | null = null
let processorRunning = false

const runWithConcurrency = async <T>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<unknown>,
): Promise<void> => {
    const queue = [...items]
    const workers = Array.from({ length: Math.min(concurrency, queue.length) })
    await Promise.all(
        workers.map(async () => {
            while (queue.length > 0) {
                const item = queue.shift()
                if (item === undefined) return
                try {
                    await fn(item)
                } catch (err) {
                    console.error('❌ processor worker error:', err)
                }
            }
        }),
    )
}

const tick = async () => {
    if (processorRunning) return
    processorRunning = true
    try {
        const due = await pendingWebhookEvents.fetchDue(BATCH_SIZE)
        if (due.length === 0) return

        console.log(
            `🔁 webhook-processor: processing ${due.length} due event(s)`,
        )
        await runWithConcurrency(due, INLINE_CONCURRENCY, processEvent)
    } catch (err) {
        console.error('❌ webhook-processor tick failed:', err)
    } finally {
        processorRunning = false
    }
}

const cleanupTick = async () => {
    try {
        const { done, failed } = await pendingWebhookEvents.cleanupOldEvents()
        if (done + failed > 0) {
            console.log(
                `🧹 webhook-processor cleanup: removed ${done} done + ${failed} failed rows`,
            )
        }
    } catch (err) {
        console.error('❌ webhook-processor cleanup failed:', err)
    }
}

/**
 * Start the in-process poller. Gated behind WEBHOOK_PROCESSOR_ENABLED so
 * that if we scale to multiple App Platform instances, only one runs the
 * processor (avoids races on the same queue rows). Default: enabled.
 */
export const startWebhookProcessor = (): void => {
    const flag = (process.env.WEBHOOK_PROCESSOR_ENABLED || 'true')
        .trim()
        .toLowerCase()
    if (!['true', '1', 'on', 'yes'].includes(flag)) {
        console.log(
            '🚦 webhook-processor disabled via WEBHOOK_PROCESSOR_ENABLED',
        )
        return
    }
    if (processorInterval) return

    processorInterval = setInterval(tick, POLL_INTERVAL_MS)
    cleanupInterval = setInterval(cleanupTick, CLEANUP_INTERVAL_MS)
    // Run one tick shortly after boot to pick up rows that were pending
    // when the server last died, without waiting a full interval.
    setTimeout(tick, 5_000)
    console.log(
        `🚀 webhook-processor started (poll ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE}, concurrency ${INLINE_CONCURRENCY})`,
    )
}

export const stopWebhookProcessor = (): void => {
    if (processorInterval) {
        clearInterval(processorInterval)
        processorInterval = null
    }
    if (cleanupInterval) {
        clearInterval(cleanupInterval)
        cleanupInterval = null
    }
}
