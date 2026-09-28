import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTimedFetch } from '../src/lib/pvs-auth'

afterEach(() => vi.useRealTimers())

describe('PVS authentication transport', () => {
    it('aborts an upstream request at the configured deadline', async () => {
        vi.useFakeTimers()
        const baseFetch = vi.fn<typeof fetch>(
            (_input, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        'abort',
                        () => {
                            reject(
                                new DOMException(
                                    'The operation was aborted',
                                    'AbortError'
                                )
                            )
                        },
                        { once: true }
                    )
                })
        )
        const request = createTimedFetch(
            baseFetch,
            25
        )('https://auth.example.test/user')
        const assertion = expect(request).rejects.toMatchObject({
            name: 'AbortError'
        })

        await vi.advanceTimersByTimeAsync(25)
        await assertion
        expect(baseFetch).toHaveBeenCalledOnce()
    })

    it('preserves a caller abort signal', async () => {
        const caller = new AbortController()
        const baseFetch = vi.fn<typeof fetch>(
            (_input, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        'abort',
                        () => {
                            reject(
                                new DOMException(
                                    'The operation was aborted',
                                    'AbortError'
                                )
                            )
                        },
                        { once: true }
                    )
                })
        )
        const request = createTimedFetch(baseFetch, 10_000)(
            'https://auth.example.test/user',
            {
                signal: caller.signal
            }
        )
        const assertion = expect(request).rejects.toMatchObject({
            name: 'AbortError'
        })

        caller.abort()
        await assertion
    })
})
