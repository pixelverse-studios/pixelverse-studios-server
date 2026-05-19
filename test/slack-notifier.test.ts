import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sendSlackNotification } from '../src/lib/slack-notifier'

const webhookUrl = 'https://hooks.slack.test/services/test'

interface SlackPayloadBlock {
    type: string
    text?: unknown
    elements?: unknown[]
    fields?: unknown[]
}

interface SlackPayload {
    text: string
    blocks: SlackPayloadBlock[]
}

const notification = {
    title: 'New Lead <Submission>',
    category: 'Details & Form',
    description: 'A prospect submitted > the form.',
    timestamp: '2026-05-19T18:00:00.000Z',
    fields: [
        { label: 'Name', value: 'Ada <Lovelace>' },
        { label: 'Email', value: 'ada@example.com' },
        { label: 'Phone', value: '' },
        { label: 'Budget', value: null },
        { label: 'Timeline', value: undefined },
        { label: 'Qualified', value: true },
    ],
}

const mockSlackResponse = (response: Response): void => {
    vi.mocked(fetch).mockResolvedValue(response)
}

const getFetchRequest = (): {
    url: string
    init: RequestInit
    body: SlackPayload
} => {
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    return {
        url: String(url),
        init: init as RequestInit,
        body: JSON.parse(String((init as RequestInit).body)) as SlackPayload,
    }
}

describe('sendSlackNotification', () => {
    beforeEach(() => {
        process.env.OPS_NOTIFY_SLACK_WEBHOOK = webhookUrl
    })

    it('throws a clear configuration error when the Slack webhook is missing', async () => {
        delete process.env.OPS_NOTIFY_SLACK_WEBHOOK

        await expect(sendSlackNotification(notification)).rejects.toThrow(
            'OPS_NOTIFY_SLACK_WEBHOOK is not configured'
        )
        expect(fetch).not.toHaveBeenCalled()
    })

    it('sends a JSON POST request to the configured webhook URL', async () => {
        mockSlackResponse(new Response('ok', { status: 200 }))

        await sendSlackNotification(notification)

        const request = getFetchRequest()
        expect(request.url).toBe(webhookUrl)
        expect(request.init.method).toBe('POST')
        expect(request.init.headers).toEqual({ 'Content-Type': 'application/json' })
        expect(request.body.text).toBe('New Lead <Submission> - Details & Form')
    })

    it('builds the expected Block Kit payload', async () => {
        mockSlackResponse(new Response('ok', { status: 200 }))

        await sendSlackNotification(notification)

        const { body } = getFetchRequest()

        expect(body.blocks[0]).toEqual({
            type: 'header',
            text: {
                type: 'plain_text',
                text: 'New Lead <Submission>',
                emoji: false,
            },
        })
        expect(body.blocks[1]).toEqual({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: '*Category:* Details &amp; Form | *Received:* 2026-05-19T18:00:00.000Z',
                },
            ],
        })
        expect(body.blocks[2]).toEqual({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: 'A prospect submitted &gt; the form.',
            },
        })
        expect(body.blocks[3]).toEqual({
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: '*Name*\nAda &lt;Lovelace&gt;' },
                { type: 'mrkdwn', text: '*Email*\nada@example.com' },
                { type: 'mrkdwn', text: '*Phone*\nNot provided' },
                { type: 'mrkdwn', text: '*Budget*\nNot provided' },
                { type: 'mrkdwn', text: '*Timeline*\nNot provided' },
                { type: 'mrkdwn', text: '*Qualified*\ntrue' },
            ],
        })
    })

    it('chunks fields into sections of at most 10 fields', async () => {
        mockSlackResponse(new Response('ok', { status: 200 }))

        await sendSlackNotification({
            ...notification,
            fields: Array.from({ length: 12 }, (_, index) => ({
                label: `Field ${index + 1}`,
                value: `Value ${index + 1}`,
            })),
        })

        const { body } = getFetchRequest()
        const fieldSections = body.blocks.filter(block => block.fields)

        expect(fieldSections).toHaveLength(2)
        expect(fieldSections[0].fields).toHaveLength(10)
        expect(fieldSections[1].fields).toHaveLength(2)
    })

    it('throws with Slack response status and body text for non-2xx responses', async () => {
        mockSlackResponse(new Response('invalid_auth', { status: 403 }))

        await expect(sendSlackNotification(notification)).rejects.toThrow(
            'Slack webhook failed (403): invalid_auth'
        )
    })
})
