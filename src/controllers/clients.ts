import { Request, Response } from 'express'

import { db, Tables } from '../lib/db'
import { handleGenericError } from '../utils/http'

const getAll = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { data, error } = await db.from(Tables.CLIENTS).select('*')
        if (error) {
            throw error
        }

        return res.status(200).json({ clients: data })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getIdBySlug = async (slug: string) => {
    try {
        const { data, error } = await db
            .from(Tables.CLIENTS)
            .select()
            .eq('client_slug', slug)

        if (error) throw error
        return data[0].id
    } catch (err) {
        throw err
    }
}

const add = async (req: Request, res: Response): Promise<Response> => {
    const { active, client, client_slug } = req.body

    try {
        const { data, error } = await db
            .from(Tables.CLIENTS)
            .insert([{ client, active, client_slug, updated_at: new Date() }])
            .select()

        if (error) {
            throw error
        }

        return res
            .status(201)
            .json({ message: 'Client created successfully', data })
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

        if (data == null) {
            return res.status(404).json({ error: 'Client not found' })
        }

        if (error) {
            throw error
        }

        return res
            .status(201)
            .json({ message: 'Client updated successfully', data: data[0] })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const remove = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params
    const { data, error } = await db
        .from('clients')
        .delete()
        .eq('id', id)
        .select()

    if (!data || data.length === 0) {
        return res.status(404).json({ error: 'Client not found' })
    }

    return res
        .status(200)
        .json({ message: 'Client deleted successfully', data })
}

export default { add, remove, edit, getAll, getIdBySlug }
