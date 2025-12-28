import { Request, Response } from 'express'

import { db, Tables } from '../lib/db'
import { handleGenericError } from '../utils/http'

const getAll = async (req: Request, res: Response): Promise<Response> => {
    try {
        const limit = Math.min(
            Math.max(parseInt(req.query.limit as string) || 20, 1),
            100
        )
        const offset = Math.max(parseInt(req.query.offset as string) || 0, 0)

        // Get total count
        const { count, error: countError } = await db
            .from(Tables.CLIENT_WEBSITE_SUMMARY)
            .select('*', { count: 'exact', head: true })

        if (countError) {
            throw countError
        }

        // Get paginated data
        const { data, error } = await db
            .from(Tables.CLIENT_WEBSITE_SUMMARY)
            .select('*')
            .range(offset, offset + limit - 1)

        if (error) {
            throw error
        }

        return res.status(200).json({
            total: count ?? 0,
            limit,
            offset,
            clients: data
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getById = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { id } = req.params

        // Fetch client data with related websites and apps
        const { data: clientData, error: clientError } = await db
            .from(Tables.CLIENTS)
            .select(
                `
                *,
                websites (
                    id,
                    title,
                    website_slug,
                    domain,
                    type,
                    seo_focus,
                    status,
                    priority
                ),
                apps (
                    id,
                    name,
                    app_slug,
                    description,
                    repository_url,
                    tech_stack,
                    contact_email,
                    active,
                    status,
                    priority
                )
            `
            )
            .eq('id', id)
            .single()

        if (clientError) {
            throw clientError
        }

        if (!clientData) {
            return res.status(404).json({ error: 'Client not found' })
        }

        return res.status(200).json(clientData)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getByEmail = async (email: string) => {
    try {
        const { data, error } = await db
            .from(Tables.CLIENTS)
            .select('*')
            .eq('email', email)
            .single()

        if (error) throw new Error(error.message)
        return data
    } catch (err) {
        throw err
    }
}

const add = async (req: Request, res: Response): Promise<Response> => {
    const { firstname, lastname, email, phone, active } = req.body

    try {
        const { data, error } = await db
            .from(Tables.CLIENTS)
            .insert({
                firstname,
                lastname,
                email: email || null,
                phone: phone || null,
                active: active ?? true,
                updated_at: new Date()
            })
            .select()
            .single()

        if (error) {
            throw error
        }

        return res.status(201).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

interface ClientUpdatePayload {
    firstname?: string
    lastname?: string
    email?: string | null
    phone?: string | null
    active?: boolean
    updated_at: Date
}

const edit = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params
    const { firstname, lastname, email, phone, active } = req.body

    try {
        const payload: ClientUpdatePayload = {
            updated_at: new Date()
        }

        if (firstname !== undefined) {
            payload.firstname = firstname
        }
        if (lastname !== undefined) {
            payload.lastname = lastname
        }
        if (email !== undefined) {
            payload.email = email || null
        }
        if (phone !== undefined) {
            payload.phone = phone || null
        }
        if (active !== undefined) {
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

        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const remove = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { id } = req.params
        const { data, error } = await db
            .from(Tables.CLIENTS)
            .delete()
            .eq('id', id)
            .select()
            .single()

        if (!data) {
            return res.status(404).json({ error: 'Client not found' })
        }

        if (error) throw error
        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { add, remove, edit, getAll, getById, getByEmail }
