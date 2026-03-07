import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import { handleGenericError } from '../utils/http'
import { sanitizeRichText } from '../utils/html'
import emailCampaignService from '../services/email-campaigns'
import { sendCampaignEmails, CampaignRecipient } from '../lib/nylas-mailer'
import { generateVersionReleaseEmailHtml } from '../utils/mailer/emails'

// Hardcoded preview recipients
const PREVIEW_RECIPIENTS = [
    'phil@pixelversestudios.io',
    'sami@pixelversestudios.io',
]

// Module-level flag — prevents concurrent campaign sends
let campaignSendInProgress = false

/**
 * POST /api/domani/email-campaigns/preview
 * Sanitizes HTML content and sends a test email to Phil + Sami
 */
const preview = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { subject, htmlContent } = req.body
        const sanitizedContent = sanitizeRichText(htmlContent)

        const previewRecipients: CampaignRecipient[] =
            PREVIEW_RECIPIENTS.map(email => ({ email, name: 'Preview' }))

        await sendCampaignEmails(
            previewRecipients,
            `[PREVIEW] ${subject}`,
            recipient => ({
                html: generateVersionReleaseEmailHtml({
                    recipientEmail: recipient.email,
                    recipientName: recipient.name,
                    subject,
                    htmlContent: sanitizedContent,
                }),
            })
        )

        return res.status(200).json({
            message: 'Preview email sent successfully',
            previewSentTo: PREVIEW_RECIPIENTS,
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

/**
 * POST /api/domani/email-campaigns/send
 * Resolves recipient IDs from Domani DB, sends campaign emails,
 * and stores a campaign record with results
 */
const send = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        if (campaignSendInProgress) {
            return res.status(409).json({
                error: 'A campaign send is already in progress',
                message:
                    'Please wait for the current send to complete before starting another.',
            })
        }

        const { subject, htmlContent, recipientIds, sentBy, delayBetweenEmails } =
            req.body
        const sanitizedContent = sanitizeRichText(htmlContent)

        // Resolve user IDs from Domani DB
        const { recipients: resolvedRecipients, missing } =
            await emailCampaignService.resolveRecipientIds(recipientIds)

        if (missing.length > 0) {
            return res.status(400).json({
                error: 'Invalid recipient IDs',
                message: `The following user IDs were not found or are deleted: ${missing.join(', ')}`,
                invalidIds: missing,
            })
        }

        // Map to campaign recipients
        const campaignRecipients: CampaignRecipient[] = resolvedRecipients.map(
            r => ({
                email: r.email,
                name: r.full_name,
            })
        )

        campaignSendInProgress = true
        try {
            const result = await sendCampaignEmails(
                campaignRecipients,
                subject,
                recipient => ({
                    html: generateVersionReleaseEmailHtml({
                        recipientEmail: recipient.email,
                        recipientName: recipient.name,
                        subject,
                        htmlContent: sanitizedContent,
                    }),
                }),
                { delayBetweenEmails }
            )

            // Store campaign record with results
            const campaign = await emailCampaignService.createCampaign({
                templateType: 'version_release',
                subject,
                htmlContent: sanitizedContent,
                recipientCount: result.total,
                successful: result.successful,
                failed: result.failed,
                recipients: result.results,
                sentBy,
            })

            return res.status(201).json({
                campaignId: campaign.id,
                total: result.total,
                successful: result.successful,
                failed: result.failed,
            })
        } finally {
            campaignSendInProgress = false
        }
    } catch (err) {
        return handleGenericError(err, res)
    }
}

/**
 * GET /api/domani/email-campaigns
 * List campaign history with summary counts (no full recipient list)
 */
const list = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100)
        const offset = parseInt(req.query.offset as string) || 0

        const result = await emailCampaignService.listCampaigns(limit, offset)

        return res.status(200).json({
            campaigns: result.campaigns,
            total: result.total,
            limit,
            offset,
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { preview, send, list }
