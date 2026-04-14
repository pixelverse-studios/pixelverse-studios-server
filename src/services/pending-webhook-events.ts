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
// the event is marked 'failed' and no further retries are scheduled.
const RETRY_DELAYS_SECONDS = [60, 300, 1800]

export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1

const insertPending = async (
    event_type: string,
    payload: Record<string, unknown>,
): Promise<PendingWebhookEvent> => {
    const { data, error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .insert([
            {
                event_type,
                payload,
                status: 'pending',
                attempts: 0,
                next_retry_at: new Date().toISOString(),
            },
        ])
        .select()
        .single()

    if (error) throw error
    return data as PendingWebhookEvent
}

const markDone = async (
    id: string,
    attempts: number,
    result_ref?: string | null,
): Promise<void> => {
    const { error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .update({
            status: 'done',
            attempts,
            processed_at: new Date().toISOString(),
            result_ref: result_ref ?? null,
            last_error: null,
        })
        .eq('id', id)

    if (error) throw error
}

const scheduleNextRetry = async (
    id: string,
    attempts: number,
    errorMessage: string,
): Promise<{ status: PendingWebhookStatus; next_retry_at: string | null }> => {
    // attempts is the number of attempts made so far (including the one that
    // just failed). The next delay is indexed by attempts - 1 because the first
    // failure uses RETRY_DELAYS_SECONDS[0].
    const delayIndex = attempts - 1
    const delaySeconds = RETRY_DELAYS_SECONDS[delayIndex]

    if (delaySeconds === undefined) {
        const { error } = await db
            .from(Tables.PENDING_WEBHOOK_EVENTS)
            .update({
                status: 'failed',
                attempts,
                last_error: errorMessage,
                processed_at: new Date().toISOString(),
            })
            .eq('id', id)

        if (error) throw error
        return { status: 'failed', next_retry_at: null }
    }

    const nextRetry = new Date(Date.now() + delaySeconds * 1000).toISOString()
    const { error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .update({
            status: 'pending',
            attempts,
            last_error: errorMessage,
            next_retry_at: nextRetry,
        })
        .eq('id', id)

    if (error) throw error
    return { status: 'pending', next_retry_at: nextRetry }
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

export default {
    insertPending,
    markDone,
    scheduleNextRetry,
    fetchDue,
    RETRY_DELAYS_SECONDS,
}
