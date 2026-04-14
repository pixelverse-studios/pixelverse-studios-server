import { db, Tables } from '../lib/db'

export type PendingWebhookStatus = 'pending' | 'done' | 'failed'

export interface PendingWebhookEvent {
    id: string
    event_type: string
    payload: Record<string, unknown>
    status: PendingWebhookStatus
    attempts: number
    next_retry_at: string
    last_error: string | null
    result_ref: string | null
    created_at: string
    processed_at: string | null
}

// Retry schedule for failed attempts. Index 0 is used after the first failure,
// index 1 after the second, and so on. Once attempts exceeds the array length,
// the event is marked 'failed' via markFailed() — scheduleNextRetry no longer
// encodes the "give up" decision.
const RETRY_DELAYS_SECONDS = [60, 300, 1800]

export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1

// ±25% jitter on scheduled retries to prevent thundering herd when many
// events fail at the same moment (e.g. transient DB outage) and would
// otherwise all wake up on the exact same tick.
const jitter = (seconds: number): number => {
    const factor = 0.75 + Math.random() * 0.5
    return Math.round(seconds * factor)
}

/**
 * Error taxonomy stored in last_error. Keeping this a small closed set
 * means the column never contains raw supabase/nylas error strings that
 * could leak schema hints, API response snippets, or connection details.
 * Raw errors are still console.error'd for operators.
 */
export const ErrorReasons = {
    WEBSITE_NOT_FOUND: 'website_not_found',
    DB_INSERT_FAILED: 'db_insert_failed',
    EMAIL_SEND_FAILED: 'email_send_failed',
    UNKNOWN: 'unknown',
} as const

export type ErrorReason = (typeof ErrorReasons)[keyof typeof ErrorReasons]

/**
 * Insert a fresh event row. `initialDelayMs` pushes next_retry_at into the
 * future so the background poller cannot claim the row while the inline
 * handler is still processing it (otherwise double-processing is possible
 * when the inline attempt is slow).
 */
const insertPending = async (
    eventType: string,
    payload: Record<string, unknown>,
    initialDelayMs: number,
): Promise<PendingWebhookEvent> => {
    const nextRetryAt = new Date(Date.now() + initialDelayMs).toISOString()
    const { data, error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .insert([
            {
                event_type: eventType,
                payload,
                status: 'pending',
                attempts: 0,
                next_retry_at: nextRetryAt,
            },
        ])
        .select()
        .single()

    if (error) throw error
    return data as PendingWebhookEvent
}

/**
 * Record that the downstream record was created so an idempotent retry
 * (after a crash between createDeployment and markDone) will not
 * re-create it. Called inside processDeploymentEvent immediately after
 * the website_deployments row is persisted, *before* the email send.
 */
const setResultRef = async (id: string, resultRef: string): Promise<void> => {
    const { error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .update({ result_ref: resultRef })
        .eq('id', id)

    if (error) throw error
}

const markDone = async (
    id: string,
    attempts: number,
    resultRef?: string | null,
): Promise<void> => {
    const { error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .update({
            status: 'done',
            attempts,
            processed_at: new Date().toISOString(),
            result_ref: resultRef ?? null,
            last_error: null,
        })
        .eq('id', id)

    if (error) throw error
}

/**
 * Terminal failure — no further retries will be attempted. Use this for
 * permanent errors (e.g. website deleted) and for the final attempt after
 * the retry schedule is exhausted.
 */
const markFailed = async (
    id: string,
    attempts: number,
    reason: ErrorReason,
): Promise<void> => {
    const { error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .update({
            status: 'failed',
            attempts,
            last_error: reason,
            processed_at: new Date().toISOString(),
        })
        .eq('id', id)

    if (error) throw error
}

/**
 * Schedule the next retry attempt. `attempts` is the total number of
 * attempts made so far *including the one that just failed* (so on the
 * first failure attempts=1, on the second attempts=2, etc.).
 *
 * Returns true if a retry was scheduled, false if the retry budget is
 * exhausted and the caller should invoke markFailed.
 */
const scheduleNextRetry = async (
    id: string,
    attempts: number,
    reason: ErrorReason,
): Promise<{ scheduled: boolean; nextRetryAt: string | null }> => {
    const delayIndex = attempts - 1
    const delaySeconds = RETRY_DELAYS_SECONDS[delayIndex]

    if (delaySeconds === undefined) {
        return { scheduled: false, nextRetryAt: null }
    }

    const nextRetryAt = new Date(
        Date.now() + jitter(delaySeconds) * 1000,
    ).toISOString()

    const { error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .update({
            status: 'pending',
            attempts,
            last_error: reason,
            next_retry_at: nextRetryAt,
        })
        .eq('id', id)

    if (error) throw error
    return { scheduled: true, nextRetryAt }
}

const fetchDue = async (limit: number): Promise<PendingWebhookEvent[]> => {
    const now = new Date().toISOString()
    const { data, error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .select('*')
        .eq('status', 'pending')
        .lte('next_retry_at', now)
        .order('next_retry_at', { ascending: true })
        .limit(limit)

    if (error) throw error
    return (data || []) as PendingWebhookEvent[]
}

/**
 * Hard-delete an event row. Used when the payload is garbage (e.g. the
 * controller's pre-validation caught a non-existent website_id) so it
 * never permanently bloats the queue table.
 */
const deleteEvent = async (id: string): Promise<void> => {
    const { error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .delete()
        .eq('id', id)

    if (error) throw error
}

/**
 * Cleanup old processed rows so the queue table does not grow without
 * bound. Called periodically by the webhook processor; not on the
 * request hot path.
 */
const cleanupOldEvents = async (): Promise<{
    done: number
    failed: number
}> => {
    const doneCutoff = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString()
    const failedCutoff = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000,
    ).toISOString()

    const doneResult = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .delete({ count: 'exact' })
        .eq('status', 'done')
        .lt('processed_at', doneCutoff)

    const failedResult = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .delete({ count: 'exact' })
        .eq('status', 'failed')
        .lt('processed_at', failedCutoff)

    if (doneResult.error) throw doneResult.error
    if (failedResult.error) throw failedResult.error

    return {
        done: doneResult.count ?? 0,
        failed: failedResult.count ?? 0,
    }
}

export default {
    insertPending,
    setResultRef,
    markDone,
    markFailed,
    scheduleNextRetry,
    fetchDue,
    deleteEvent,
    cleanupOldEvents,
    RETRY_DELAYS_SECONDS,
}
