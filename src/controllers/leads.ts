import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import { handleGenericError } from '../utils/http'
import { upsertProspect } from '../services/prospects'
import leadSubmissionsService from '../services/lead-submissions'
import { sendSlackNotification } from '../lib/slack-notifier'

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
    interestedIn: z
        .array(z.enum(['web-design', 'seo', 'unsure']))
        .min(1)
        .optional(),
    currentWebsite: z
        .string()
        .trim()
        .max(2048)
        .regex(
            /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/[\S]*)?$/i,
            'Enter a valid website URL (e.g. yourbusiness.com).'
        )
        .optional()
        .or(z.literal('')),
    improvements: z.array(z.string().min(1).max(200)).min(1).max(20),
    briefSummary: z.string().max(2000).optional(),
    promoCode: z
        .string()
        .trim()
        .max(32)
        .optional()
        .transform(v => (v && v.length > 0 ? v : undefined)),
    attribution: z.unknown().optional(),
    honeypot: z.string().optional(),
})

const sendLeadAlertToSlack = async (
    data: z.infer<typeof leadsSchema>
): Promise<void> => {
    await sendSlackNotification({
        title: 'New Lead Submission',
        category: 'Details Form',
        description: 'A prospective client submitted the project details form.',
        fields: [
            { label: 'Name', value: data.name },
            { label: 'Email', value: data.email },
            { label: 'Company', value: data.companyName },
            { label: 'Phone', value: data.phone },
            { label: 'Budget', value: data.budget },
            { label: 'Timeline', value: data.timeline },
            { label: 'Website', value: data.currentWebsite },
            { label: 'Services', value: data.interestedIn?.join(', ') },
            { label: 'Needs', value: data.improvements.join(', ') },
            { label: 'Notes', value: data.briefSummary || 'None' },
            ...(data.promoCode ? [{ label: 'Promo', value: data.promoCode }] : []),
        ],
    })
}

const createLead = async (req: Request, res: Response): Promise<Response> => {
    try {
        const parsed = leadsSchema.parse(req.body)

        // Honeypot: return 200 silently to not tip off bots
        if (parsed.honeypot) {
            return res.status(200).json({ message: 'Message received.' })
        }

        const {
            name,
            email,
            companyName,
            phone,
            budget,
            timeline,
            interestedIn,
            currentWebsite,
            improvements,
            briefSummary,
            promoCode,
            attribution,
        } = parsed

        const prospectId = await upsertProspect(email, name, 'details_form')

        await leadSubmissionsService.createLeadSubmission({
            prospectId,
            companyName,
            phone,
            budget,
            timeline,
            interestedIn,
            currentWebsite,
            improvements,
            briefSummary,
            promoCode,
            attribution,
        })

        sendLeadAlertToSlack(parsed).catch((err) =>
            console.error('Slack notification failed (lead saved):', err)
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
