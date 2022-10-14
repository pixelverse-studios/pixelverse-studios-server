import nodemailer from 'nodemailer'
import { google } from 'googleapis'
import SMTPTransport from 'nodemailer/lib/smtp-transport'

// bring in logo

export default async function (email: string, token: string) {
    const createTransporter = async () => {
        const OAuth2 = google.auth.OAuth2
        const oauth2Client = new OAuth2(
            process.env.GOOGLE_OAUTH_ID,
            process.env.GOOGLE_OAUTH_SECRET,
            'https://developers.google.com/oauthplayground'
        )
        oauth2Client.setCredentials({
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN
        })

        const accessToken = await new Promise((resolve, reject) => {
            oauth2Client.getAccessToken((err, token) => {
                if (err) {
                    reject('Failed to create access token')
                }

                resolve(token)
            })
        })

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: process.env.EMAIL_USER,
                accessToken,
                clientId: process.env.GOOGLE_OAUTH_ID,
                clientSecret: process.env.GOOGLE_OAUTH_SECRET,
                refreshToken: process.env.GOOGLE_REFRESH_TOKEN
            }
        } as SMTPTransport.Options)

        return transporter
    }

    const sendEmail = async () => {
        const transporter = await createTransporter()
        const header = '<header>OnlyPans</header>'
        const message =
            '<div>To reset your password, click the link below. This is a one time use link. It will expire after you visit the page for the first time.</div>'
        const url = `http://localhost:3000/reset-password/${token}`
        const anchor = `<a href="${url}" target="_blank"><button style="background-color: #04132f;color: white; cursor: pointer; border: none;height: 2rem;width: 6rem;margin: auto; border-radius: 2%;font-weight: 500;">RESET</button></a>`

        const html = `
            <div style="width: 50%; margin: auto; text-align: center;">
                ${header}
                ${message}
                ${anchor}
            </div>
        `
        try {
            await transporter.sendMail({
                subject: 'OnlyPans Password Reset',
                html,
                to: email,
                from: process.env.EMAIL_USER
            } as SMTPTransport.Options)
            return true
        } catch (error: any) {
            throw new Error(error)
        }
    }

    sendEmail()
}
