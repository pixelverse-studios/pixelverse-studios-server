import { Request, Response } from 'express'

import { db, Tables } from '../lib/db'
import clients from './clients'
import { handleGenericError } from '../utils/http'

const getAll = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { data, error } = await db.from(Tables.NEWSLETTER).select('*')
        if (error) throw error
        return res.status(200).json({ newsletter: data })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const add = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { clientSlug } = req.params
        const { firstName, lastName, email } = req.body
        const clientId = await clients.getIdBySlug(clientSlug)
        const { error } = await db.from(Tables.NEWSLETTER).insert([
            {
                client_id: clientId,
                firstname: firstName,
                lastname: lastName,
                email,
                updated_at: new Date()
            }
        ])
        if (error) throw error
        return res.status(201).json({ message: 'Subscriber added.' })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { add, getAll }
