import SMTPTransport from 'nodemailer/lib/smtp-transport'

import { createTransporter } from '../'

export const sendIntroMeetingResponse = async (
    sendToEmail: string,
    meetingDetails: { location: string; dateTime: string }
) => {
    const transporter = await createTransporter()

    const header = `<header>EZPZ Coding LLC</header>`
    const body = `<div>We want to thank you for requesting to meet with us for a potential project. The meeting is on our books, we look forward to speaking with you on ${meetingDetails.location} at ${meetingDetails.dateTime}</div>`

    const html = `
        <div>
            ${header}
            ${body}
        </div>
    `

    try {
        const res = await transporter.sendMail({
            subject: 'Intro Meeting Confirmed!',
            html,
            to: sendToEmail,
            from: process.env.EMAIL_USER
        } as SMTPTransport.Options)
        return true
    } catch (error: any) {
        throw new Error(error)
    }
}
