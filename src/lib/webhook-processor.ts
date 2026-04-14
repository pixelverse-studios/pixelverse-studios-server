import { db, Tables } from './db'
import pendingWebhookEvents, {
    PendingWebhookEvent,
} from '../services/pending-webhook-events'
import deploymentsService from '../services/deployments'
import { sendDeploymentEmail } from './nylas-mailer'

// How often the in-process poller wakes up to check for due retries.
// The first attempt for any event happens inline in the request handler,
// so this interval only affects retry latency after a failure.
const POLL_INTERVAL_MS = 60_000

const BATCH_SIZE = 10

export type WebhookEventType = 'deployment'

export interface DeploymentEventPayload {
    website_id: string
    changed_urls: string[]
    deploy_summary: string
    internal_notes?: string
}

// Thrown by processors when the error is permanent and no retry should be
// attempted (e.g. the referenced website no longer exists). Causes the event
// to be marked 'failed' immediately rather than scheduled for retry.
export class NonRetryableWebhookError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'NonRetryableWebhookError'
    }
}

/**
 * Process a deployment event: verify the website, create the deployment row,
 * send the notification email. Returns the new deployment id on success.
 *
 * Email failures are swallowed (same behavior as the pre-DEV-701 controller)
 * because the deployment record itself is the thing we cannot recover — once
 * it's in the DB, the client-facing data is safe even if the email bounces.
 */
export const processDeploymentEvent = async (
    payload: DeploymentEventPayload,
): Promise<string> => {
    const { website_id, changed_urls, deploy_summary, internal_notes } = payload

    const { data: website, error: websiteError } = await db
        .from(Tables.WEBSITES)
        .select('id, title, contact_email, client_id')
        .eq('id', website_id)
        .single()

    if (websiteError || !website) {
        throw new NonRetryableWebhookError(
            `Website not found for deployment event: ${website_id}`,
        )
    }

    const deployment = await deploymentsService.createDeployment({
        website_id,
        changed_urls,
        deploy_summary,
        internal_notes,
    })

    if (website.contact_email) {
        try {
            await sendDeploymentEmail({
                to: website.contact_email,
                websiteTitle: website.title,
                deploymentDate: new Date(
                    deployment.created_at,
                ).toLocaleDateString(),
                summaryMarkdown: deploy_summary,
            })
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

    return deployment.id
}

const runProcessor = async (
    event: PendingWebhookEvent,
): Promise<string | null> => {
    switch (event.event_type as WebhookEventType) {
        case 'deployment':
            return processDeploymentEvent(
                event.payload as unknown as DeploymentEventPayload,
            )
        default:
            throw new NonRetryableWebhookError(
                `Unknown event_type: ${event.event_type}`,
            )
    }
}

/**
 * Process a single pending event. Used both by the inline path (first attempt
 * inside the request handler) and by the poller (scheduled retries).
 *
 * Returns true on success, false on failure (the row is updated accordingly).
 */
export const processEvent = async (
    event: PendingWebhookEvent,
): Promise<boolean> => {
    const attempts = event.attempts + 1
    try {
        const resultRef = await runProcessor(event)
        await pendingWebhookEvents.markDone(event.id, attempts, resultRef)
        return true
    } catch (err) {
        const isNonRetryable = err instanceof NonRetryableWebhookError
        const message = err instanceof Error ? err.message : String(err)

        if (isNonRetryable) {
            console.error(
                `❌ webhook event ${event.id} failed permanently:`,
                message,
            )
            await pendingWebhookEvents.scheduleNextRetry(
                event.id,
                Number.MAX_SAFE_INTEGER,
                `[non-retryable] ${message}`,
            )
            return false
        }

        console.error(
            `⚠️  webhook event ${event.id} attempt ${attempts} failed:`,
            message,
        )
        await pendingWebhookEvents.scheduleNextRetry(
            event.id,
            attempts,
            message,
        )
        return false
    }
}

let processorInterval: NodeJS.Timeout | null = null
let processorRunning = false

const tick = async () => {
    if (processorRunning) return
    processorRunning = true
    try {
        const due = await pendingWebhookEvents.fetchDue(BATCH_SIZE)
        if (due.length === 0) return

        console.log(`🔁 webhook-processor: processing ${due.length} due event(s)`)
        for (const event of due) {
            await processEvent(event)
        }
    } catch (err) {
        console.error('❌ webhook-processor tick failed:', err)
    } finally {
        processorRunning = false
    }
}

export const startWebhookProcessor = (): void => {
    if (processorInterval) return
    processorInterval = setInterval(tick, POLL_INTERVAL_MS)
    // Run one tick shortly after boot to pick up rows that were pending when
    // the server last died, without waiting a full interval.
    setTimeout(tick, 5_000)
    console.log(
        `🚀 webhook-processor started (interval ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE})`,
    )
}

export const stopWebhookProcessor = (): void => {
    if (processorInterval) {
        clearInterval(processorInterval)
        processorInterval = null
    }
}
