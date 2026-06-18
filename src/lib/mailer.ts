import nodemailer from 'nodemailer'
import { convert } from 'html-to-text'

import {
    generateAuditRequestConfirmationEmail,
    generateAuditRequestEmail,
    generateContactFormSubmissionEmail,
    generateLeadSubmissionConfirmationEmail
} from '../utils/mailer/emails'

interface GmailSmtpCredentials {
    user: string
    pass: string
}

const getGmailSmtpCredentials = (): GmailSmtpCredentials => {
    const user = process.env.GMAIL_USER?.trim()
    const pass = process.env.GMAIL_APP_PASSWORD?.trim()

    if (!user || !pass) {
        throw new Error(
            'Gmail SMTP credentials are not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD.'
        )
    }

    return { user, pass }
}

const createGmailTransporter = () => {
    const credentials = getGmailSmtpCredentials()

    return {
        credentials,
        transporter: nodemailer.createTransport({
            service: 'gmail',
            auth: credentials,
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 20_000,
        }),
    }
}

interface ContactSubmissionEmailParams {
    to: string | string[]
    subject: string
    website: string
    payload: {
        fullname: string
        phone: string
        email: string
        additional: any
    }
}

export async function sendContactSubmissionEmail({
    to,
    subject,
    website,
    payload
}: ContactSubmissionEmailParams): Promise<void> {
    const html = generateContactFormSubmissionEmail({
        website,
        fullname: payload.fullname,
        phone: payload.phone,
        email: payload.email,
        data: payload.additional
    })

    await sendMail({
        to,
        subject,
        html,
        meta: { website }
    })
}

interface AuditRequestEmailPayload {
    name: string
    email: string
    websiteUrl: string
    phoneNumber?: string
    specifics?: string
    submittedAt: string
}

interface AuditSubmissionEmailParams {
    to: string | string[]
    subject?: string
    payload: AuditRequestEmailPayload
}

const DEFAULT_AUDIT_SUBJECT = 'New Free Website Audit Request'
const DEFAULT_AUDIT_CONFIRMATION_SUBJECT =
    'We received your website audit request'
const DEFAULT_LEAD_CONFIRMATION_SUBJECT = 'We received your project details'

export async function sendAuditRequestEmail({
    to,
    subject = DEFAULT_AUDIT_SUBJECT,
    payload
}: AuditSubmissionEmailParams): Promise<void> {
    const html = generateAuditRequestEmail({
        name: payload.name,
        email: payload.email,
        websiteUrl: payload.websiteUrl,
        phoneNumber: payload.phoneNumber ?? null,
        specifics: payload.specifics ?? null,
        submittedAt: payload.submittedAt
    })

    await sendMail({
        to,
        subject,
        html
    })
}

interface AuditRequestConfirmationEmailPayload {
    name: string
    websiteUrl: string
}

interface AuditRequestConfirmationEmailParams {
    to: string | string[]
    subject?: string
    payload: AuditRequestConfirmationEmailPayload
}

export async function sendAuditRequestConfirmationEmail({
    to,
    subject = DEFAULT_AUDIT_CONFIRMATION_SUBJECT,
    payload
}: AuditRequestConfirmationEmailParams): Promise<void> {
    const html = generateAuditRequestConfirmationEmail({
        name: payload.name,
        websiteUrl: payload.websiteUrl
    })

    await sendEmail({
        to,
        subject,
        html
    })
}

interface LeadSubmissionConfirmationEmailPayload {
    name: string
    companyName: string
    budget?: string | null
    timeline?: string | null
    interestedIn?: string[] | null
    currentWebsite?: string | null
    improvements?: string[] | null
}

interface LeadSubmissionConfirmationEmailParams {
    to: string | string[]
    subject?: string
    payload: LeadSubmissionConfirmationEmailPayload
}

export async function sendLeadSubmissionConfirmationEmail({
    to,
    subject = DEFAULT_LEAD_CONFIRMATION_SUBJECT,
    payload
}: LeadSubmissionConfirmationEmailParams): Promise<void> {
    const html = generateLeadSubmissionConfirmationEmail({
        name: payload.name,
        companyName: payload.companyName,
        budget: payload.budget,
        timeline: payload.timeline,
        interestedIn: payload.interestedIn,
        currentWebsite: payload.currentWebsite,
        improvements: payload.improvements
    })

    await sendEmail({
        to,
        subject,
        html
    })
}

interface SendMailOptions {
    to: string | string[]
    subject: string
    html: string
    meta?: Record<string, unknown>
}

const formatRecipients = (recipients: string | string[]): string =>
    Array.isArray(recipients) ? recipients.join(', ') : recipients

const sendMail = async ({
    to,
    subject,
    html,
    meta
}: SendMailOptions): Promise<void> => {
    try {
        const { credentials, transporter } = createGmailTransporter()
        const text = convert(html)

        const mailOptions = {
            from: credentials.user,
            to: formatRecipients(to),
            subject,
            text,
            html
        }

        const result = await transporter.sendMail(mailOptions)
        console.log('✅ Email sent successfully:', {
            result: result.messageId,
            sentTo: mailOptions.to,
            ...meta
        })
    } catch (error) {
        console.error('❌ Error sending email:', error)
    }
}

// Simple markdown to HTML converter for basic formatting
function markdownToHtml(markdown: string): string {
    let html = markdown
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .split('\n')
        .join('<br>')

    html = html.replace(/(<li>.*?<\/li>(<br>)?)+/g, match => {
        return '<ul>' + match.replace(/<br>/g, '') + '</ul>'
    })

    return html
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
        html,
        cc: ['sami@pixelversestudios.io', 'phil@pixelversestudios.io'],
    })
}

interface SendEmailParams {
    to: string | string[]
    subject: string
    html: string
    text?: string
    cc?: string | string[]
}

export async function sendEmail({
    to,
    subject,
    html,
    text,
    cc
}: SendEmailParams): Promise<void> {
    try {
        const { credentials, transporter } = createGmailTransporter()
        const plainText = text || convert(html)

        const mailOptions = {
            from: credentials.user,
            to: formatRecipients(to),
            subject,
            text: plainText,
            html,
            ...(cc && { cc: formatRecipients(cc) }),
        }

        const result = await transporter.sendMail(mailOptions)
        console.log('✅ Email sent successfully:', {
            result: result.messageId,
            sentTo: mailOptions.to,
            subject
        })
    } catch (error) {
        console.error('❌ Error sending email:', error)
        throw error
    }
}
