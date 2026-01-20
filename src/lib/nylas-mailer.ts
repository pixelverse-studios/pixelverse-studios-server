import Nylas from 'nylas'
import {
    DOMANI_BETA_SUBJECT,
    generateDomaniBetaLaunchEmailHtml,
    generateDomaniBetaLaunchEmailText
} from '../utils/mailer/emails'

const NYLAS_API_KEY = process.env.NYLAS_API_KEY!
const NYLAS_GRANT_ID = process.env.NYLAS_GRANT_ID!

// Simple markdown to HTML converter for basic formatting
function markdownToHtml(markdown: string): string {
    let html = markdown
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // Bold
        .replace(/\*(.+?)\*/g, '<em>$1</em>') // Italic
        .replace(/^- (.+)$/gm, '<li>$1</li>') // List items
        .split('\n')
        .join('<br>')

    // Wrap consecutive list items in ul tags
    html = html.replace(/(<li>.*?<\/li>(<br>)?)+/g, match => {
        return '<ul>' + match.replace(/<br>/g, '') + '</ul>'
    })

    return html
}

const nylas = new Nylas({
    apiKey: NYLAS_API_KEY
})

interface SendEmailParams {
    to: string | string[]
    subject: string
    html: string
    text?: string
}

export async function sendEmail({
    to,
    subject,
    html,
    text
}: SendEmailParams): Promise<void> {
    try {
        const recipients = Array.isArray(to) ? to : [to]

        const emailBody = {
            subject,
            body: html,
            to: recipients.map(email => ({ email })),
            cc: [
                { email: 'sami@pixelversestudios.io' },
                { email: 'phil@pixelversestudios.io' }
            ]
        }

        await nylas.messages.send({
            identifier: NYLAS_GRANT_ID,
            requestBody: emailBody
        })

        console.log('✅ Email sent successfully via Nylas:', {
            sentTo: recipients.join(', '),
            cc: 'sami@pixelversestudios.io, phil@pixelversestudios.io',
            subject
        })
    } catch (error) {
        console.error('❌ Error sending email via Nylas:', error)
        throw error
    }
}

interface DeploymentEmailParams {
    to: string
    websiteTitle: string
    deploymentDate: string
    summaryMarkdown: string
}

export async function sendDeploymentEmail({
    to,
    websiteTitle,
    deploymentDate,
    summaryMarkdown
}: DeploymentEmailParams): Promise<void> {
    const summaryHtml = markdownToHtml(summaryMarkdown)

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Deployment: ${websiteTitle}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 8px 8px 0 0;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
        }
        .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 8px 8px;
        }
        .section {
            background: white;
            padding: 20px;
            margin: 20px 0;
            border-radius: 6px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .section h2 {
            margin-top: 0;
            color: #667eea;
            font-size: 18px;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 2px solid #eee;
            color: #999;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 New Deployment</h1>
        <p>${websiteTitle}</p>
    </div>

    <div class="content">
        <div class="section">
            <h2>📅 Deployment Details</h2>
            <p><strong>Date:</strong> ${deploymentDate}</p>
        </div>

        <div class="section">
            <h2>📝 Changes Summary</h2>
            ${summaryHtml}
        </div>
    </div>

    <div class="footer">
        <p>This is an automated deployment notification from PixelVerse Studios</p>
    </div>
</body>
</html>
    `

    await sendEmail({
        to,
        subject: `🚀 New Deployment: ${websiteTitle}`,
        html
    })
}

// ============================================================================
// Domani Beta Launch Email Blast
// ============================================================================

export interface BetaLaunchRecipient {
    email: string
    name?: string | null
}

export interface BetaLaunchConfig {
    iosLink: string
    androidLink: string
    delayBetweenEmails?: number // ms delay between sends to avoid rate limiting
}

export interface BetaLaunchResult {
    email: string
    success: boolean
    error?: string
}

/**
 * Send beta launch email to a single recipient (no CC)
 */
async function sendBetaLaunchEmailToRecipient(
    recipient: BetaLaunchRecipient,
    config: BetaLaunchConfig
): Promise<BetaLaunchResult> {
    try {
        const html = generateDomaniBetaLaunchEmailHtml({
            recipientName: recipient.name,
            iosLink: config.iosLink,
            androidLink: config.androidLink
        })

        const text = generateDomaniBetaLaunchEmailText({
            recipientName: recipient.name,
            iosLink: config.iosLink,
            androidLink: config.androidLink
        })

        await nylas.messages.send({
            identifier: NYLAS_GRANT_ID,
            requestBody: {
                subject: DOMANI_BETA_SUBJECT,
                body: html,
                to: [{ email: recipient.email }]
                // No CC for bulk emails
            }
        })

        console.log(`✅ Beta launch email sent to: ${recipient.email}`)
        return { email: recipient.email, success: true }
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
        console.error(`❌ Failed to send to ${recipient.email}:`, errorMessage)
        return { email: recipient.email, success: false, error: errorMessage }
    }
}

/**
 * Send beta launch emails to multiple recipients with optional delay
 */
export async function sendBetaLaunchEmails(
    recipients: BetaLaunchRecipient[],
    config: BetaLaunchConfig
): Promise<{
    total: number
    successful: number
    failed: number
    results: BetaLaunchResult[]
}> {
    const results: BetaLaunchResult[] = []
    const delay = config.delayBetweenEmails ?? 500 // Default 500ms between emails

    console.log(
        `📧 Starting beta launch email blast to ${recipients.length} recipients...`
    )

    for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i]

        const result = await sendBetaLaunchEmailToRecipient(recipient, config)
        results.push(result)

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

    console.log(`\n📧 Beta launch email blast complete:`)
    console.log(`   ✅ Successful: ${successful}`)
    console.log(`   ❌ Failed: ${failed}`)
    console.log(`   📊 Total: ${recipients.length}`)

    return {
        total: recipients.length,
        successful,
        failed,
        results
    }
}
