import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)
const DOMANI_FROM_EMAIL = 'Domani <hello@domani-app.com>'

export interface CampaignRecipient {
    email: string
    name?: string | null
}

export interface CampaignSendResult {
    email: string
    name?: string | null
    success: boolean
    error?: string
}

export type CampaignTemplateFn = (recipient: CampaignRecipient) => {
    html: string
}

export interface CampaignSendOptions {
    delayBetweenEmails?: number
}

/**
 * Send campaign emails to multiple recipients using a template function.
 * Generic sender that supports any template via the templateFn parameter.
 */
export async function sendCampaignEmails(
    recipients: CampaignRecipient[],
    subject: string,
    templateFn: CampaignTemplateFn,
    options: CampaignSendOptions = {}
): Promise<{
    total: number
    successful: number
    failed: number
    results: CampaignSendResult[]
}> {
    const results: CampaignSendResult[] = []
    const delay = options.delayBetweenEmails ?? 500

    console.log(
        `📧 Starting campaign email blast to ${recipients.length} recipients...`
    )

    for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i]

        try {
            const { html } = templateFn(recipient)

            await resend.emails.send({
                from: DOMANI_FROM_EMAIL,
                to: recipient.email,
                subject,
                html,
            })

            console.log(`✅ Campaign email sent to: ${recipient.email}`)
            results.push({
                email: recipient.email,
                name: recipient.name,
                success: true,
            })
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'Unknown error'
            console.error(
                `❌ Failed to send to ${recipient.email}:`,
                errorMessage
            )
            results.push({
                email: recipient.email,
                name: recipient.name,
                success: false,
                error: errorMessage,
            })
        }

        // Add delay between emails (except for the last one)
        if (i < recipients.length - 1 && delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay))
        }

        // Log progress every 10 emails
        if ((i + 1) % 10 === 0) {
            console.log(`📊 Progress: ${i + 1}/${recipients.length} emails sent`)
        }
    }

    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    console.log(`\n📧 Campaign email blast complete:`)
    console.log(`   ✅ Successful: ${successful}`)
    console.log(`   ❌ Failed: ${failed}`)
    console.log(`   📊 Total: ${recipients.length}`)

    return {
        total: recipients.length,
        successful,
        failed,
        results,
    }
}
