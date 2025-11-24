import Nylas from 'nylas'

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
    html = html.replace(/(<li>.*?<\/li>(<br>)?)+/g, (match) => {
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
            cc: [{ email: 'sami@pixelversestudios.io' }]
        }

        await nylas.messages.send({
            identifier: NYLAS_GRANT_ID,
            requestBody: emailBody
        })

        console.log('✅ Email sent successfully via Nylas:', {
            sentTo: recipients.join(', '),
            cc: 'sami@pixelversestudios.io',
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
    changedUrls: string[]
}

export async function sendDeploymentEmail({
    to,
    websiteTitle,
    deploymentDate,
    summaryMarkdown,
    changedUrls
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
        .url-list {
            list-style: none;
            padding: 0;
        }
        .url-list li {
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        .url-list li:last-child {
            border-bottom: none;
        }
        .url-list a {
            color: #667eea;
            text-decoration: none;
        }
        .url-list a:hover {
            text-decoration: underline;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 2px solid #eee;
            color: #999;
            font-size: 14px;
        }
        .cta-button {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 6px;
            margin-top: 20px;
        }
        .cta-button:hover {
            background: #5568d3;
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

        <div class="section">
            <h2>🔗 Changed URLs</h2>
            <p>The following pages have been updated and need to be re-indexed in Google Search Console:</p>
            <ul class="url-list">
                ${changedUrls.map(url => `<li><a href="${url}">${url}</a></li>`).join('')}
            </ul>
            <a href="https://search.google.com/search-console" class="cta-button">Open Google Search Console</a>
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
