import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import websitesDB from '../services/websites'
import { handleGenericError } from '../utils/http'

const updateSeoFocus = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const { seo_focus } = req.body

        const data = await websitesDB.updateSeoFocus(id, seo_focus)

        if (!data) {
            return res.status(404).json({ error: 'Website not found' })
        }

        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { updateSeoFocus }
