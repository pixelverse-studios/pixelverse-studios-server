import { Request, Response } from 'express'

import { COLUMNS, db, Tables } from '../lib/db'
import { handleGenericError } from '../utils/http'

const getAll = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { data, error } = await db.from(Tables.CLIENTS).select('*')
        if (error) {
            throw error
        }

        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getIdBySlug = async (slug: string) => {
    try {
        const { data, error } = await db
            .from(Tables.CLIENTS)
            .select()
            .eq(COLUMNS.SLUG, slug)
            .single()

        if (error) throw new Error(error.message)
        return data.id
    } catch (err) {
        throw err
    }
}

const add = async (req: Request, res: Response): Promise<Response> => {
    const { active, client, client_slug } = req.body

    try {
        const { data, error } = await db
            .from(Tables.CLIENTS)
            .insert({ client, active, client_slug, updated_at: new Date() })
            .select()

        if (error) {
            throw error
        }

        return res.status(201).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const edit = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params
    const { client, active } = req.body

    try {
        const payload = {
            updated_at: new Date()
        } as { client?: string; active?: boolean; updated_at: Date }
        if (client != undefined) {
            payload.client = client
        }
        if (active != undefined) {
            payload.active = active
        }
        const { data, error } = await db
            .from(Tables.CLIENTS)
            .update(payload)
            .eq('id', id)
            .select()
            .single()

        if (data == null) {
            return res.status(404).json({ error: 'Client not found' })
        }

        if (error) {
            throw error
        }

        return res.status(201).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const remove = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { id } = req.params
        const { data, error } = await db
            .from('clients')
            .delete()
            .eq('id', id)
            .select()
            .single()

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Client not found' })
        }

        if (error) throw error
        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { add, remove, edit, getAll, getIdBySlug }
