import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import { handleGenericError } from '../utils/http'
import { upsertProspect } from '../services/prospects'
import leadSubmissionsService from '../services/lead-submissions'

const leadsSchema = z.object({
    name: z.string().min(2).max(100),
    email: z.string().email().max(254),
    companyName: z.string().min(1).max(150),
    phone: z
        .string()
        .regex(/^[\d\s+\-().]{7,20}$/)
        .optional()
        .or(z.literal('')),
    budget: z.enum(['<1k', '1-3k', '3-6k', '6-10k', '10k+']),
    timeline: z.enum(['ASAP', '1-2mo', '3-6mo', '6+mo', 'unsure']),
    currentWebsite: z.string().url().optional().or(z.literal('')),
    improvements: z.array(z.string().min(1).max(200)).min(1).max(20),
    briefSummary: z.string().max(2000).optional(),
    website_confirm: z.string().optional(), // honeypot
})

const DISCORD_USERNAME = 'PixelVerse Lead Alerts'
const DISCORD_TITLE = '📋 New Lead — Details Form'

const resolveWebhookUrl = (): string => {
    const webhookUrl = process.env.LEAD_NOTIFY_DISCORD_WEBHOOK?.trim()
    if (!webhookUrl) throw new Error('LEAD_NOTIFY_DISCORD_WEBHOOK is not configured')
    return webhookUrl
}

const buildDiscordDescription = (data: z.infer<typeof leadsSchema>): string => {
    return [
        '──────────────────────────',
        `👤 Name:      ${data.name}`,
        `📧 Email:     ${data.email}`,
        `🏢 Company:   ${data.companyName}`,
        `📞 Phone:     ${data.phone || 'Not provided'}`,
        `💰 Budget:    ${data.budget}`,
        `⏱ Timeline:  ${data.timeline}`,
        `🌐 Website:   ${data.currentWebsite || 'Not provided'}`,
        `🔧 Needs:     ${data.improvements.join(', ')}`,
        `📝 Notes:     ${data.briefSummary || 'None'}`,
    ].join('\n')
}

const sendLeadAlertToDiscord = async (
    data: z.infer<typeof leadsSchema>
): Promise<void> => {
    const webhookUrl = resolveWebhookUrl()
    const description = buildDiscordDescription(data)

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
                    timestamp: new Date().toISOString(),
                    footer: { text: 'Lead intake notifications' },
                },
            ],
        }),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Discord webhook failed (${response.status}): ${errorText}`)
    }
}

const createLead = async (req: Request, res: Response): Promise<Response> => {
    try {
        const parsed = leadsSchema.parse(req.body)

        // Honeypot: return 200 silently to not tip off bots
        if (parsed.website_confirm) {
            return res.status(200).json({ message: 'Message received.' })
        }

        const {
            name,
            email,
            companyName,
            phone,
            budget,
            timeline,
            currentWebsite,
            improvements,
            briefSummary,
        } = parsed

        const prospectId = await upsertProspect(email, name, 'details_form')

        await leadSubmissionsService.createLeadSubmission({
            prospectId,
            companyName,
            phone,
            budget,
            timeline,
            currentWebsite,
            improvements,
            briefSummary,
        })

        sendLeadAlertToDiscord(parsed).catch((err) =>
            console.error('Discord notification failed (lead saved):', err)
        )

        console.log('Lead submission created', { email })

        return res.status(201).json({ message: 'Message received.' })
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

export default { createLead }
