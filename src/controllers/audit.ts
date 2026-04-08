import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import { handleGenericError } from '../utils/http'
import { upsertProspect } from '../services/prospects'
import auditRequestsService, { AuditRequestRecord } from '../services/audit-requests'

const auditSchema = z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
    websiteUrl: z.string().url().max(2048),
    phoneNumber: z.string().optional(),
    specifics: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((v) => (Array.isArray(v) ? v.join(', ') : v)),
    otherDetail: z.string().max(500).optional(),
    promoCode: z
        .string()
        .trim()
        .max(32)
        .optional()
        .transform(v => (v && v.length > 0 ? v : undefined)),
    honeypot: z.string().optional(),
})

const DISCORD_USERNAME = 'PixelVerse Audit Alerts'
const DISCORD_TITLE = '📝 Website Review Request'

const resolveWebhookUrl = (): string => {
    const webhookUrl = process.env.LEAD_NOTIFY_DISCORD_WEBHOOK?.trim()
    if (!webhookUrl) throw new Error('LEAD_NOTIFY_DISCORD_WEBHOOK is not configured')
    return webhookUrl
}

const buildDiscordDescription = (record: AuditRequestRecord): string => {
    const lines = [
        '────────────────────────',
        `👤 Name:        ${record.name}`,
        `📧 Email:       ${record.email}`,
        `🌐 Website:     ${record.website_url}`,
        `📞 Phone:       ${record.phone_number ?? 'Not provided'}`,
        `🔍 Focus areas: ${record.specifics ?? 'Not specified'}`,
    ]

    if (record.other_detail) {
        lines.push(`📝 Other:       ${record.other_detail}`)
    }

    if (record.promo_code) {
        lines.push(`🎟 Promo:       ${record.promo_code}`)
    }

    return lines.join('\n')
}

const sendAuditAlertToDiscord = async (
    record: AuditRequestRecord
): Promise<void> => {
    const webhookUrl = resolveWebhookUrl()
    const description = buildDiscordDescription(record)

    if (description.length > 4096) {
        throw new Error('Discord payload exceeds maximum embed length')
    }

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: DISCORD_USERNAME,
            content: DISCORD_TITLE,
            embeds: [
                {
                    description,
                    color: 0x3f00e9,
                    timestamp: record.created_at,
                    footer: { text: 'Audit request notifications' },
                },
            ],
        }),
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
    try {
        const parsed = auditSchema.parse(req.body)

        // Honeypot: return 200 silently to not tip off bots
        if (parsed.honeypot) {
            return res.status(200).json({ message: 'Audit request received.' })
        }

        const {
            name,
            email,
            websiteUrl,
            phoneNumber,
            specifics,
            otherDetail,
            promoCode,
        } = parsed

        const prospectId = await upsertProspect(email, name, 'review_request')

        const record = await auditRequestsService.createAuditRequest({
            name,
            email,
            websiteUrl,
            phoneNumber,
            specifics,
            otherDetail,
            prospectId,
            promoCode,
        })

        sendAuditAlertToDiscord(record).catch((err) =>
            console.error('Discord notification failed (audit saved):', err)
        )

        return res.status(201).json({ message: 'Audit request received.' })
    } catch (err) {
        if (err instanceof ZodError) {
            return res.status(400).json({
                error: 'Invalid payload',
                details: err.flatten(),
            })
        }
        return handleGenericError(err, res)
    }
}

const auditController = {
    createAuditRequest,
}

export default auditController
