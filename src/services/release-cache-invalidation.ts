import crypto from 'crypto'

import { db } from '../lib/db'

interface ClaimedJob {
    id: string
    release_id: string
    targets: string[]
    attempt_count: number
}

export interface ReleasePublicCacheInvalidator {
    invalidate(job: ClaimedJob): Promise<void>
}

const configuredInvalidator = (): ReleasePublicCacheInvalidator | null => {
    const endpoint = process.env.RELEASE_CACHE_INVALIDATION_ENDPOINT?.trim()
    const secret = process.env.RELEASE_CACHE_INVALIDATION_SECRET?.trim()
    if (!endpoint || !secret) return null
    return {
        async invalidate(job) {
            for (const target of job.targets) {
                const payload = JSON.stringify({ jobId: job.id, releaseId: job.release_id, target })
                const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-release-invalidation-signature': `sha256=${signature}`,
                        'idempotency-key': `${job.id}:${target}`,
                    },
                    body: payload,
                    signal: AbortSignal.timeout(10_000),
                })
                if (!response.ok) throw new Error(`Revalidation receiver returned HTTP ${response.status}`)
            }
        },
    }
}

export const dispatchReleaseCacheInvalidations = async (
    invalidator = configuredInvalidator()
): Promise<number> => {
    if (!invalidator) return 0
    const { data, error } = await db.rpc('claim_release_cache_invalidation_jobs', { p_limit: 10 })
    if (error) throw error
    const jobs = (data || []) as unknown as ClaimedJob[]
    for (const job of jobs) {
        try {
            await invalidator.invalidate(job)
            const { error: completeError } = await db.rpc('complete_release_cache_invalidation_job', { p_job_id: job.id })
            if (completeError) throw completeError
        } catch (deliveryError) {
            const safeMessage = deliveryError instanceof Error ? deliveryError.message.slice(0, 1000) : 'Delivery failed'
            const { error: failError } = await db.rpc('fail_release_cache_invalidation_job', { p_job_id: job.id, p_error: safeMessage })
            if (failError) console.error('Unable to record release invalidation failure:', { jobId: job.id, message: failError.message })
            if (job.attempt_count >= 3) console.error('Release cache invalidation requires attention:', { jobId: job.id, releaseId: job.release_id, attemptCount: job.attempt_count })
        }
    }
    return jobs.length
}

export const startReleaseCacheInvalidationDispatcher = (): NodeJS.Timeout | null => {
    if (!configuredInvalidator()) return null
    const intervalMs = Math.max(10_000, Number(process.env.RELEASE_CACHE_DISPATCH_INTERVAL_MS) || 30_000)
    const run = () => dispatchReleaseCacheInvalidations().catch(error => console.error('Release cache invalidation dispatcher failed:', { message: error instanceof Error ? error.message : String(error) }))
    void run()
    const timer = setInterval(run, intervalMs)
    timer.unref()
    return timer
}
