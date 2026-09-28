import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    PvsAuthRequestError,
    verifyPvsAccessToken
} from '../src/lib/pvs-auth'
import { createTimedFetch } from '../src/lib/timed-fetch'

const originalUrl = process.env.SUPABASE_URL
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY

afterEach(() => {
    vi.useRealTimers()
    if (originalUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
})

describe('PVS authentication transport', () => {
    it('verifies the active actor through the protected Data API RPC', async () => {
        process.env.SUPABASE_URL = 'https://pvs.example.test'
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-key'
        const baseFetch = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: 'a1000000-0000-4000-8000-000000000002',
                    email: 'staff@pvs.test'
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        )

        await expect(verifyPvsAccessToken('user-token', baseFetch)).resolves.toEqual({
            id: 'a1000000-0000-4000-8000-000000000002',
            email: 'staff@pvs.test'
        })
        expect(baseFetch).toHaveBeenCalledWith(
            'https://pvs.example.test/rest/v1/rpc/verify_pvs_dashboard_actor',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    apikey: 'server-key',
                    Authorization: 'Bearer user-token'
                })
            })
        )
    })

    it('classifies a rejected bearer token as invalid', async () => {
        process.env.SUPABASE_URL = 'https://pvs.example.test'
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-key'
        const baseFetch = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response('{}', { status: 401 }))

        await expect(
            verifyPvsAccessToken('invalid-token', baseFetch)
        ).rejects.toEqual(new PvsAuthRequestError(401))
    })

    it('fails closed when server credentials are missing', async () => {
        delete process.env.SUPABASE_URL
        delete process.env.SUPABASE_SERVICE_ROLE_KEY
        await expect(verifyPvsAccessToken('token')).rejects.toEqual(
            new PvsAuthRequestError(503)
        )
    })

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
