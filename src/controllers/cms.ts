import { Request, Response } from 'express'

import { db, Tables } from '../lib/db'
import clients from './clients'
import { handleGenericError } from '../utils/http'

const add = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { page, content, active } = req.body
        const { clientSlug } = req.params

        const clientId = await clients.getIdBySlug(clientSlug)
        const { data, error } = await db
            .from(Tables.CMS)
            .insert({
                client_id: clientId,
                page,
                content,
                active,
                updated_at: new Date()
            })
            .select()

        if (error) throw error

        return res.status(200).json({ message: 'CMS item added', data })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { add }
