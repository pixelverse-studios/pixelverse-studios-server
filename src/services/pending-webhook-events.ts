import { db, Tables } from '../lib/db'

export type PendingWebhookStatus = 'pending' | 'done' | 'failed'

/**
 * Queue row shape. `payload` is typed via the generic parameter so consumers
 * that know the event type can avoid the `as unknown as T` dance. Defaults
 * to an opaque record for callers that don't care.
 */
export interface PendingWebhookEvent<P = Record<string, unknown>> {
    id: string
    event_type: string
    payload: P
    status: PendingWebhookStatus
    attempts: number
    next_retry_at: string
    last_error: string | null
    result_ref: string | null
    email_sent_at: string | null
    created_at: string
    processed_at: string | null
}

const RETRY_DELAYS_SECONDS = [60, 300, 1800]

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
 *
 * Note: `last_error` on a `status='done'` row is a non-fatal warning (e.g.
 * deployment row was created but the notification email failed). Operator
 * query for "done but degraded" events: `WHERE status='done' AND last_error IS NOT NULL`.
 */
export const ErrorReasons = {
    WEBSITE_NOT_FOUND: 'website_not_found',
    DB_INSERT_FAILED: 'db_insert_failed',
    EMAIL_SEND_FAILED: 'email_send_failed',
    UNKNOWN: 'unknown',
} as const

export type ErrorReason = (typeof ErrorReasons)[keyof typeof ErrorReasons]

/**
 * Best-effort retry wrapper for transient DB bookkeeping writes (setResultRef,
 * setEmailSent). These writes happen AFTER user-facing work has already
 * succeeded, so a single transient Supabase failure cannot be allowed to
 * cascade into "retry the whole event" (which would duplicate the user-facing
 * work). Retries linearly for up to ~2s total before giving up.
 */
const withRetries = async <T>(
    label: string,
    fn: () => Promise<T>,
    attempts = 3,
): Promise<T> => {
    let lastErr: unknown
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn()
        } catch (err) {
            lastErr = err
            if (i < attempts - 1) {
                await new Promise(resolve =>
                    setTimeout(resolve, 200 * (i + 1)),
                )
            }
        }
    }
    console.error(
        `❌ ${label} failed after ${attempts} attempts:`,
        lastErr,
    )
    throw lastErr
}

/**
 * Insert a fresh event row. `initialDelayMs` pushes next_retry_at into the
 * future so the background poller cannot claim the row while the inline
 * handler is still processing it (otherwise double-processing is possible
 * when the inline attempt is slow).
 */
const insertPending = async <P extends Record<string, unknown>>(
    eventType: string,
    payload: P,
    initialDelayMs: number,
): Promise<PendingWebhookEvent<P>> => {
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
    return data as PendingWebhookEvent<P>
}

/**
 * Record that the downstream record was created so an idempotent retry
 * (after a crash between createDeployment and markDone) will not re-create
 * it. Wrapped in withRetries because this write happens AFTER a successful
 * user-facing side effect — a transient failure here cannot be allowed to
 * trigger a duplicate of that side effect.
 */
const setResultRef = async (id: string, resultRef: string): Promise<void> => {
    await withRetries(`setResultRef(${id})`, async () => {
        const { error } = await db
            .from(Tables.PENDING_WEBHOOK_EVENTS)
            .update({ result_ref: resultRef })
            .eq('id', id)
        if (error) throw error
    })
}

/**
 * Record that the notification email succeeded. Retries check this column
 * and skip the email block when set, preventing duplicate notifications if
 * a crash happens after sendEmail succeeds but before markDone. Wrapped
 * in withRetries for the same reason as setResultRef.
 */
const setEmailSent = async (id: string): Promise<void> => {
    await withRetries(`setEmailSent(${id})`, async () => {
        const { error } = await db
            .from(Tables.PENDING_WEBHOOK_EVENTS)
            .update({ email_sent_at: new Date().toISOString() })
            .eq('id', id)
        if (error) throw error
    })
}

/**
 * Mark the event as successfully processed. `warning` optionally persists
 * a last_error marker on an otherwise-successful event (e.g. deployment
 * row created but email bounced). Leave undefined for a clean success.
 */
const markDone = async (
    id: string,
    attempts: number,
    resultRef: string,
    warning?: ErrorReason,
): Promise<void> => {
    const { error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .update({
            status: 'done',
            attempts,
            processed_at: new Date().toISOString(),
            result_ref: resultRef,
            last_error: warning ?? null,
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
 * attempts made so far *including the one that just failed* (on the first
 * failure attempts=1, on the second attempts=2, etc.).
 *
 * Returns `scheduled=true` if a retry was scheduled, `scheduled=false`
 * when the retry budget is exhausted and the caller should invoke
 * markFailed.
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
    setEmailSent,
    markDone,
    markFailed,
    scheduleNextRetry,
    fetchDue,
    cleanupOldEvents,
    RETRY_DELAYS_SECONDS,
}
