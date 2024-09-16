const nodemailer = require('nodemailer')
const { google } = require('googleapis')

module.exports.createTransporter = async () => {
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
    })

    return transporter
}
