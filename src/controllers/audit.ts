import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import { handleGenericError } from '../utils/http'
import { upsertProspect } from '../services/prospects'
import auditRequestsService, { AuditRequestRecord } from '../services/audit-requests'
import { sendSlackNotification } from '../lib/slack-notifier'
import { sendAuditRequestConfirmationEmail } from '../lib/mailer'

const auditSchema = z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
    websiteUrl: z
        .string()
        .trim()
        .max(2048)
        .regex(
            /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/[\S]*)?$/i,
            'Enter a valid website URL (e.g. yourbusiness.com).'
        ),
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
    attribution: z.unknown().optional(),
    honeypot: z.string().optional(),
})

const sendAuditAlertToSlack = async (
    record: AuditRequestRecord
): Promise<void> => {
    await sendSlackNotification({
        title: 'New Website Audit Request',
        category: 'Website Audit',
        description: 'A prospective client requested a free website audit.',
        timestamp: record.created_at,
        fields: [
            { label: 'Name', value: record.name },
            { label: 'Email', value: record.email },
            { label: 'Website', value: record.website_url },
            { label: 'Phone', value: record.phone_number },
            { label: 'Focus Areas', value: record.specifics },
            ...(record.other_detail
                ? [{ label: 'Other Details', value: record.other_detail }]
                : []),
            ...(record.promo_code
                ? [{ label: 'Promo', value: record.promo_code }]
                : []),
        ],
    })
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
            attribution,
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
            attribution,
        })

        sendAuditAlertToSlack(record).catch((err) =>
            console.error('Slack notification failed (audit saved):', err)
        )

        sendAuditRequestConfirmationEmail({
            to: record.email,
            payload: {
                name: record.name,
                websiteUrl: record.website_url,
            },
        }).catch((err) =>
            console.error('Audit confirmation email failed (audit saved):', err)
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
