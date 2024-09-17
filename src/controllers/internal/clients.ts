import { Request, Response } from 'express'

import { db, Tables } from '../../lib/db'
import { handleGenericError } from '../../utils/http'

export const getAllClients = async (
    req: Request,
    res: Response
): Promise<Response> => {
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

export const addClient = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const { client, active } = req.body

    try {
        const { data, error } = await db
            .from(Tables.CLIENTS)
            .insert([{ client, active, updated_at: new Date() }])
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

export const editClient = async (
    req: Request,
    res: Response
): Promise<Response> => {
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

export const deleteClient = async (
    req: Request,
    res: Response
): Promise<Response> => {
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
