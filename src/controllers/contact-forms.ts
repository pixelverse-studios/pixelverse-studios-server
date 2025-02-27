import { Request, Response } from 'express'

import { COLUMNS, db, Tables } from '../lib/db'
import { handleGenericError } from '../utils/http'
import { getWebsiteDetailsForEmail } from '../services/websites'
import { sendContactSubmissionEmail } from '../lib/mailer'

const getAll = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { data, error } = await db.from(Tables.CONTACT_FORMS).select('*')
        if (error) {
            throw error
        }

        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const addRecord = async (req: Request, res: Response): Promise<Response> => {
    const { fullname, email, phone, data: reqData } = req.body
    const { website_id } = req.params

    try {
        const { contact_email: sendToEmail, title } =
            await getWebsiteDetailsForEmail(website_id)

        const { data, error } = await db
            .from(Tables.CONTACT_FORMS)
            .insert({
                fullname,
                email,
                phone,
                data: reqData,
                website_id
            })
            .select()

        if (error) {
            throw error
        }

        const payload = { additional: { ...reqData }, phone, email, fullname }

        await sendContactSubmissionEmail({
            to: sendToEmail,
            subject: `New Contact Form Submission for ${title}`,
            website: title,
            payload
        })

        return res.status(201).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { getAll, addRecord }
