import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import appsDB from '../services/apps'
import { findById as findClientById } from '../services/clients'
import { handleGenericError } from '../utils/http'

const getAll = async (req: Request, res: Response): Promise<Response> => {
    try {
        const apps = await appsDB.getAll()
        return res.status(200).json(apps)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getById = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const app = await appsDB.getById(id)

        if (!app) {
            return res.status(404).json({ error: 'App not found' })
        }

        return res.status(200).json(app)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getByClient = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { clientId } = req.params

        // Verify client exists
        const client = await findClientById(clientId)
        if (!client) {
            return res.status(404).json({ error: 'Client not found' })
        }

        const apps = await appsDB.getByClientId(clientId)
        return res.status(200).json(apps)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const create = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const {
            name,
            app_slug,
            client_id,
            description,
            repository_url,
            tech_stack,
            contact_email,
            active
        } = req.body

        // Verify client exists
        const client = await findClientById(client_id)
        if (!client) {
            return res.status(404).json({
                error: 'Client not found',
                message: 'The specified client_id does not exist.'
            })
        }

        // Check for duplicate slug
        const existingSlug = await appsDB.findBySlug(app_slug)
        if (existingSlug) {
            return res.status(409).json({
                error: 'App slug already exists',
                message: 'An app with this slug already exists.'
            })
        }

        // Build payload
        const payload: {
            name: string
            app_slug: string
            client_id: string
            description?: string
            repository_url?: string
            tech_stack?: string[]
            contact_email?: string
            active?: boolean
        } = {
            name,
            app_slug,
            client_id
        }

        if (description !== undefined) payload.description = description
        if (repository_url !== undefined)
            payload.repository_url = repository_url
        if (tech_stack !== undefined) payload.tech_stack = tech_stack
        if (contact_email !== undefined) payload.contact_email = contact_email
        if (active !== undefined) payload.active = active

        const data = await appsDB.insert(payload)
        return res.status(201).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const edit = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const {
            name,
            app_slug,
            description,
            repository_url,
            tech_stack,
            contact_email,
            active
        } = req.body

        // Verify app exists
        const existing = await appsDB.getById(id)
        if (!existing) {
            return res.status(404).json({ error: 'App not found' })
        }

        // Check for duplicate slug (excluding current app)
        if (app_slug) {
            const existingSlug = await appsDB.findBySlug(app_slug, id)
            if (existingSlug) {
                return res.status(409).json({
                    error: 'App slug already exists',
                    message: 'An app with this slug already exists.'
                })
            }
        }

        // Build payload with only provided fields
        const payload: Record<string, unknown> = {}

        if (name !== undefined) payload.name = name
        if (app_slug !== undefined) payload.app_slug = app_slug
        if (description !== undefined) payload.description = description
        if (repository_url !== undefined)
            payload.repository_url = repository_url
        if (tech_stack !== undefined) payload.tech_stack = tech_stack
        if (contact_email !== undefined) payload.contact_email = contact_email
        if (active !== undefined) payload.active = active

        const data = await appsDB.update(id, payload)
        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const remove = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params

        // Verify app exists
        const existing = await appsDB.getById(id)
        if (!existing) {
            return res.status(404).json({ error: 'App not found' })
        }

        await appsDB.remove(id)
        return res.status(200).json({ message: 'App deleted successfully' })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { getAll, getById, getByClient, create, edit, remove }
