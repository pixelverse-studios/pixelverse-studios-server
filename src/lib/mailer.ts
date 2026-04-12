import nodemailer from 'nodemailer'
import { convert } from 'html-to-text'

import {
    generateAuditRequestEmail,
    generateContactFormSubmissionEmail
} from '../utils/mailer/emails'

const GMAIL_USER = process.env.GMAIL_USER!
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD!

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
    },
})

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
        const plainText = text || convert(html)

        const mailOptions = {
            from: GMAIL_USER,
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
