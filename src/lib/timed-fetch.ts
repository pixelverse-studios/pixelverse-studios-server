export const createTimedFetch =
    (baseFetch: typeof fetch, timeoutMs: number): typeof fetch =>
    async (input, init = {}) => {
        const controller = new AbortController()
        const upstreamSignal = init.signal
        const abortFromUpstream = () => controller.abort()

        if (upstreamSignal?.aborted) controller.abort()
        else
            upstreamSignal?.addEventListener('abort', abortFromUpstream, {
                once: true
            })

        const timeout = setTimeout(() => controller.abort(), timeoutMs)
        try {
            return await baseFetch(input, {
                ...init,
                signal: controller.signal
            })
        } finally {
            clearTimeout(timeout)
            upstreamSignal?.removeEventListener('abort', abortFromUpstream)
        }
    }
