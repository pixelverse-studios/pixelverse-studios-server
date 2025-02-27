import nodemailer from 'nodemailer'
import { OAuth2Client } from 'google-auth-library'
import { convert } from 'html-to-text'

import { generateContactFormSubmissionEmail } from '../utils/mailer/emails'

const GMAIL_USER = process.env.GMAIL_USER!
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID!
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN!

const oAuth2Client = new OAuth2Client(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET)
oAuth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN })

interface ContactSubmissionEmailParams {
    to: string
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

        const html = generateContactFormSubmissionEmail({
            website,
            fullname: payload.fullname,
            phone: payload.phone,
            email: payload.email,
            data: payload.additional
        })

        const text = convert(html)

        const mailOptions = {
            from: GMAIL_USER,
            to,
            subject,
            text,
            html
        }

        const result = await transporter.sendMail(mailOptions)
        console.log('✅ Email sent successfully:', {
            result: result.messageId,
            sentTo: to,
            website
        })
    } catch (error) {
        console.error('❌ Error sending email:', error)
    }
}
