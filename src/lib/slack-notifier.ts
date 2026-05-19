export interface SlackNotificationField {
    label: string
    value: string | number | boolean | null | undefined
}

export interface SlackNotification {
    title: string
    description: string
    category: string
    fields: SlackNotificationField[]
    timestamp?: string
}

interface SlackTextObject {
    type: 'plain_text' | 'mrkdwn'
    text: string
    emoji?: boolean
}

interface SlackBlock {
    type: 'header' | 'context' | 'section'
    text?: SlackTextObject
    elements?: SlackTextObject[]
    fields?: SlackTextObject[]
}

const SLACK_HEADER_TEXT_LIMIT = 150
const SLACK_SECTION_TEXT_LIMIT = 3000
const SLACK_FIELD_TEXT_LIMIT = 2000
const SLACK_FIELDS_PER_SECTION = 10

const resolveSlackWebhookUrl = (): string => {
    const webhookUrl = process.env.OPS_NOTIFY_SLACK_WEBHOOK?.trim()
    if (!webhookUrl) throw new Error('OPS_NOTIFY_SLACK_WEBHOOK is not configured')
    return webhookUrl
}

const truncate = (value: string, maxLength: number): string => {
    if (value.length <= maxLength) return value
    return `${value.slice(0, maxLength - 3)}...`
}

const escapeSlackText = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

const formatFieldValue = (value: SlackNotificationField['value']): string => {
    if (value === null || value === undefined || value === '') return 'Not provided'
    return String(value)
}

const toPlainText = (text: string, maxLength: number): SlackTextObject => ({
    type: 'plain_text',
    text: truncate(text, maxLength),
    emoji: false,
})

const toMarkdownText = (text: string, maxLength: number): SlackTextObject => ({
    type: 'mrkdwn',
    text: truncate(escapeSlackText(text), maxLength),
})

const formatField = ({ label, value }: SlackNotificationField): SlackTextObject =>
    toMarkdownText(
        `*${label}*\n${formatFieldValue(value)}`,
        SLACK_FIELD_TEXT_LIMIT
    )

const chunkFields = <T>(items: T[], chunkSize: number): T[][] => {
    const chunks: T[][] = []
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize))
    }
    return chunks
}

const buildSlackBlocks = (notification: SlackNotification): SlackBlock[] => {
    const receivedAt = notification.timestamp ?? new Date().toISOString()
    const fieldSections = chunkFields(
        notification.fields.map(formatField),
        SLACK_FIELDS_PER_SECTION
    ).map<SlackBlock>(fields => ({
        type: 'section',
        fields,
    }))

    return [
        {
            type: 'header',
            text: toPlainText(notification.title, SLACK_HEADER_TEXT_LIMIT),
        },
        {
            type: 'context',
            elements: [
                toMarkdownText(
                    `*Category:* ${notification.category} | *Received:* ${receivedAt}`,
                    SLACK_SECTION_TEXT_LIMIT
                ),
            ],
        },
        {
            type: 'section',
            text: toMarkdownText(
                notification.description,
                SLACK_SECTION_TEXT_LIMIT
            ),
        },
        ...fieldSections,
    ]
}

export const sendSlackNotification = async (
    notification: SlackNotification
): Promise<void> => {
    const webhookUrl = resolveSlackWebhookUrl()
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text: `${notification.title} - ${notification.category}`,
            blocks: buildSlackBlocks(notification),
        }),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Slack webhook failed (${response.status}): ${errorText}`)
    }
}
