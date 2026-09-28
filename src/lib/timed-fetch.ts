export const runWithTimeout = async <T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    upstreamSignal?: AbortSignal | null
): Promise<T> => {
    const controller = new AbortController()
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason)

    if (upstreamSignal?.aborted) controller.abort(upstreamSignal.reason)
    else
        upstreamSignal?.addEventListener('abort', abortFromUpstream, {
            once: true
        })

    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let rejectOperation: (() => void) | undefined
    const abortPromise = new Promise<never>((_resolve, reject) => {
        rejectOperation = () => reject(controller.signal.reason)
        if (controller.signal.aborted) rejectOperation()
        else
            controller.signal.addEventListener('abort', rejectOperation, {
                once: true
            })
    })
    try {
        return await Promise.race([operation(controller.signal), abortPromise])
    } finally {
        clearTimeout(timeout)
        if (rejectOperation)
            controller.signal.removeEventListener('abort', rejectOperation)
        upstreamSignal?.removeEventListener('abort', abortFromUpstream)
    }
}
