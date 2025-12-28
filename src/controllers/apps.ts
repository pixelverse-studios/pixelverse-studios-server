import { Request, Response } from 'express'

import appsDB from '../services/apps'
import { findById as findClientById } from '../services/clients'
import { handleGenericError } from '../utils/http'
import { PROJECT_STATUSES, ProjectStatus } from '../lib/db'

const create = async (req: Request, res: Response): Promise<Response> => {
    try {
        const {
            name,
            app_slug,
            client_id,
            description,
            repository_url,
            tech_stack,
            contact_email,
            status,
            priority
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
            tech_stack?: object
            contact_email?: string
            status?: ProjectStatus
            priority?: number
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
        if (status !== undefined) payload.status = status
        if (priority !== undefined) payload.priority = priority

        const data = await appsDB.insert(payload)

        return res.status(201).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const edit = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { id } = req.params
        const {
            name,
            app_slug,
            description,
            repository_url,
            tech_stack,
            contact_email,
            active,
            status,
            priority
        } = req.body

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
        const payload: {
            name?: string
            app_slug?: string
            description?: string
            repository_url?: string
            tech_stack?: object
            contact_email?: string
            active?: boolean
            status?: ProjectStatus
            priority?: number
        } = {}

        if (name !== undefined) payload.name = name
        if (app_slug !== undefined) payload.app_slug = app_slug
        if (description !== undefined) payload.description = description
        if (repository_url !== undefined)
            payload.repository_url = repository_url
        if (tech_stack !== undefined) payload.tech_stack = tech_stack
        if (contact_email !== undefined) payload.contact_email = contact_email
        if (active !== undefined) payload.active = active
        if (status !== undefined) payload.status = status
        if (priority !== undefined) payload.priority = priority

        const data = await appsDB.update(id, payload)

        if (!data) {
            return res.status(404).json({ error: 'App not found' })
        }

        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const updateStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { id } = req.params
        const { status } = req.body

        // Validate status value
        if (!PROJECT_STATUSES.includes(status)) {
            return res.status(400).json({
                error: 'Invalid status',
                message: `Status must be one of: ${PROJECT_STATUSES.join(', ')}`
            })
        }

        // Check if app exists
        const existing = await appsDB.findById(id)
        if (!existing) {
            return res.status(404).json({ error: 'App not found' })
        }

        const data = await appsDB.updateStatus(id, status)

        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { create, edit, updateStatus }
