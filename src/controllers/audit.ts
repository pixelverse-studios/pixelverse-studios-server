import { Request, Response } from 'express'

import { handleGenericError } from '../utils/http'
import auditRequestsService, {
    AuditRequestRecord
} from '../services/audit-requests'

const DEFAULT_DISCORD_WEBHOOK_ERROR =
    'LEAD_NOTIFY_DISCORD_WEBHOOK is not configured'
const DISCORD_USERNAME = 'PixelVerse Audit Alerts'
const DISCORD_TITLE = 'PixelVerse Studios — New Audit Request'

const resolveWebhookUrl = (): string => {
    const webhookUrl = process.env.LEAD_NOTIFY_DISCORD_WEBHOOK?.trim()

    if (!webhookUrl) {
        throw new Error(DEFAULT_DISCORD_WEBHOOK_ERROR)
    }

    return webhookUrl
}

const buildAuditText = (record: AuditRequestRecord): string => {
    return [
        `Name: ${record.name}`,
        `Email: ${record.email}`,
        `Website: ${record.website_url}`,
        `Phone: ${record.phone_number ?? 'n/a'}`,
        `Specifics: ${record.specifics ?? 'n/a'}`,
        `Status: ${record.status}`,
        `Submitted At: ${record.created_at}`
    ].join('\n')
}

const sendAuditAlertToDiscord = async (
    record: AuditRequestRecord
): Promise<void> => {
    const webhookUrl = resolveWebhookUrl()
    const description = buildAuditText(record)

    if (description.length > 4096) {
        throw new Error('Discord payload exceeds maximum embed length')
    }

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username: DISCORD_USERNAME,
            content: DISCORD_TITLE,
            embeds: [
                {
                    description,
                    color: 0x3f00e9,
                    timestamp: record.created_at,
                    footer: {
                        text: 'Audit request notifications'
                    }
                }
            ]
        })
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Discord webhook failed (${response.status}): ${errorText}`)
    }
}

const createAuditRequest = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const { name, email, websiteUrl, phoneNumber, specifics } = req.body

    try {
        const record = await auditRequestsService.createAuditRequest({
            name,
            email,
            websiteUrl,
            phoneNumber,
            specifics
        })

        await sendAuditAlertToDiscord(record)

        return res
            .status(201)
            .json({ id: record.id, status: record.status, created_at: record.created_at })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const auditController = {
    createAuditRequest
}

export default auditController
