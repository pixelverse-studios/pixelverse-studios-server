const { createTransporter } = require('../')

module.exports.resetPasswordEmail = async (email, token) => {
    const transporter = await createTransporter()

    const header =
        '<header style="color: #3fc1aa; font-size: 2rem; margin-bottom: 1rem;">EZPZ Coding</header>'
    const message =
        '<div style="font-size: 1.5rem">To reset your password, click the link below.</div>'
    const pageRoute = 'password/reset'
    const url = `http://localhost:3000/${pageRoute}/${token}`
    const anchor = `<a href="${url}" target="_blank"><button style="margin: 1rem 0;background-color: #04132f;font-size: 1.5rem;color: white; cursor: pointer; border: none;height: 3rem;width: 40%; border-radius: 2%;font-weight: 500;">RESET PASSWORD</button></a>`
    const timeDisclaimer =
        '<div style="font-style=italic; font-size: 1.35rem;">For security purposes, this link above will expire within one hour.</div>'

    const html = `
        <section style="text-align: center">
            ${header}
            ${message}
            <div style="width: 100%; text-align:center;">
                ${anchor}
            </div>
            ${timeDisclaimer}
        </section>
        `

    try {
        await transporter.sendMail({
            subject: 'EZPZ Coding Password Reset',
            html,
            to: email,
            from: process.env.EMAIL_USER
        })
    } catch (error) {
        throw new Error(error)
    }
}
