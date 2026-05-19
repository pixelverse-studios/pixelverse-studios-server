import { describe, expect, it, vi } from 'vitest'

describe('test harness', () => {
    it('runs with isolated test environment variables', () => {
        process.env.OPS_NOTIFY_SLACK_WEBHOOK = 'https://hooks.slack.test/example'

        expect(process.env.NODE_ENV).toBe('test')
        expect(process.env.OPS_NOTIFY_SLACK_WEBHOOK).toBe(
            'https://hooks.slack.test/example'
        )
    })

    it('resets environment variables between tests', () => {
        expect(process.env.NODE_ENV).toBe('test')
        expect(process.env.OPS_NOTIFY_SLACK_WEBHOOK).toBeUndefined()
    })

    it('fails unmocked fetch calls by default', async () => {
        await expect(fetch('https://example.com')).rejects.toThrow(
            'Unexpected network call in test'
        )
    })

    it('allows fetch to be mocked per test', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response('ok', { status: 200 })
        )

        const response = await fetch('https://example.com')

        expect(response.ok).toBe(true)
    })
})
