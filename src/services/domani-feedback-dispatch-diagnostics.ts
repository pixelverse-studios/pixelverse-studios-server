type Operation = 'claim_domani_feedback_reply' | 'send_support_reply' | 'finish_domani_feedback_reply' | 'dispatch_cycle'
const networkCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'])

// Never serialize errors: PostgREST details/messages can contain SQL values,
// recipient addresses or headers. Only machine-readable diagnostic fields escape.
export class DispatchFailure extends Error {
    readonly code: string
    readonly httpStatus?: number
    constructor(readonly operation: Operation, error: unknown, status?: number) {
        super('Feedback dispatch operation failed')
        const source = error as { code?: unknown; name?: unknown; cause?: { code?: unknown }; message?: unknown } | null
        const code = source?.code || source?.cause?.code
        this.code = typeof code === 'string' && (/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code) || networkCodes.has(code))
            ? code
            : source?.name === 'TimeoutError' || source?.name === 'AbortError' ? 'REQUEST_TIMEOUT'
            : typeof source?.message === 'string' && /fetch failed|network request failed/i.test(source.message) ? 'NETWORK_ERROR'
            : 'UNCLASSIFIED_ERROR'
        this.httpStatus = Number.isInteger(status) && status! >= 100 && status! <= 599 ? status : undefined
    }
}

export function createDispatchDiagnostics() {
    let previous: { signature: string; failure: DispatchFailure; lastLoggedAt: number; failures: number; suppressed: number } | undefined
    return {
        failure(error: unknown) {
            const failure = error instanceof DispatchFailure ? error : new DispatchFailure('dispatch_cycle', error)
            const signature = `${failure.operation}:${failure.code}:${failure.httpStatus}`
            const now = Date.now()
            const same = previous?.signature === signature
            const failures = same ? previous!.failures + 1 : 1
            if (same && now - previous!.lastLoggedAt < 60_000) {
                previous!.failures = failures
                previous!.suppressed++
                return
            }
            console.error('Domani feedback dispatch requires attention', {
                operation: failure.operation, code: failure.code, httpStatus: failure.httpStatus,
                consecutiveFailures: failures, suppressedRepeats: same ? previous!.suppressed : 0,
            })
            previous = { signature, failure, lastLoggedAt: now, failures, suppressed: 0 }
        },
        healthy() {
            if (!previous) return
            console.info('Domani feedback dispatch recovered', {
                operation: previous.failure.operation, code: previous.failure.code,
                consecutiveFailures: previous.failures, suppressedRepeats: previous.suppressed,
            })
            previous = undefined
        },
    }
}
