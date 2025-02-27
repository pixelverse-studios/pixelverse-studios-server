import { Request, Response } from 'express'

import { handleGenericError } from '../utils/http'
import { sendContactSubmissionEmail } from '../lib/mailer'
import websitesDB from '../services/websites'
import contactFormDB from '../services/contact-forms'

const getAll = async (req: Request, res: Response): Promise<Response> => {
    try {
        const allSubmissions =
            await contactFormDB.getAllContactFormSubmissions()

        return res.status(200).json(allSubmissions)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const addRecord = async (req: Request, res: Response): Promise<Response> => {
    const { fullname, email, phone, data: reqData } = req.body
    const { website_id } = req.params

    try {
        const { contact_email: sendToEmail, title } =
            await websitesDB.getWebsiteDetailsForEmail(website_id)

        await contactFormDB.addFormSubmissionRecord({
            website_id,
            payload: { fullname, email, phone, additional: reqData }
        })
        const payload = { additional: { ...reqData }, phone, email, fullname }

        await sendContactSubmissionEmail({
            to:
                process.env.NODE_ENVIRONMENT === 'development'
                    ? 'info@pixelversestudios.io'
                    : sendToEmail,
            subject: `New Contact Form Submission for ${title}`,
            website: title,
            payload
        })

        return res.status(201)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { getAll, addRecord }
