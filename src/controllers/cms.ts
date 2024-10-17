import { Request, Response } from 'express'

import { db, Tables, COLUMNS } from '../lib/db'
import clients from './clients'
import { handleGenericError } from '../utils/http'

const get = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { data, error } = await db.from(Tables.CMS).select()
        if (error) {
            throw error
        }

        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getById = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { clientSlug } = req.params

        const clientId = await clients.getIdBySlug(clientSlug)
        const { data, error } = await db
            .from(Tables.CMS)
            .select()
            .eq(COLUMNS.CLIENT_ID, clientId)
        if (error) {
            throw error
        }

        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getActiveById = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const { clientSlug } = req.params
        const clientId = await clients.getIdBySlug(clientSlug)
        const { data, error } = await db
            .from(Tables.CMS)
            .select()
            .eq(COLUMNS.CLIENT_ID, clientId)
            .eq('active', true)
        if (error) {
            throw error
        }

        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const add = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { page, content, active } = req.body
        const { id } = req.params

        const { data, error } = await db
            .from(Tables.CMS)
            .insert({
                client_id: id,
                page,
                content,
                active,
                updated_at: new Date()
            })
            .select()

        if (error) throw error

        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const edit = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params
    try {
        const { data, error } = await db
            .from(Tables.CMS)
            .update({ ...req.body, updated_at: new Date() })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { add, get, getById, getActiveById, edit }
