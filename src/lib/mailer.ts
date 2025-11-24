import nodemailer from 'nodemailer'
import { OAuth2Client } from 'google-auth-library'
import { convert } from 'html-to-text'

import {
    generateAuditRequestEmail,
    generateContactFormSubmissionEmail
} from '../utils/mailer/emails'

const GMAIL_USER = process.env.GMAIL_USER!
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID!
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN!

const oAuth2Client = new OAuth2Client(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET)
oAuth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN })

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
        const accessToken = await oAuth2Client.getAccessToken()

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: GMAIL_USER,
                clientId: GMAIL_CLIENT_ID,
                clientSecret: GMAIL_CLIENT_SECRET,
                refreshToken: GMAIL_REFRESH_TOKEN,
                accessToken: accessToken.token || ''
            }
        })

        const text = convert(html)

        const mailOptions = {
            from: GMAIL_USER,
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
        const accessToken = await oAuth2Client.getAccessToken()

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: GMAIL_USER,
                clientId: GMAIL_CLIENT_ID,
                clientSecret: GMAIL_CLIENT_SECRET,
                refreshToken: GMAIL_REFRESH_TOKEN,
                accessToken: accessToken.token || ''
            }
        })

        const plainText = text || convert(html)

        const mailOptions = {
            from: GMAIL_USER,
            to: formatRecipients(to),
            subject,
            text: plainText,
            html
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
