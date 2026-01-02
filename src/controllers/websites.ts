import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import websitesDB from '../services/websites'
import { findById as findClientById } from '../services/clients'
import { handleGenericError } from '../utils/http'
import { PROJECT_STATUSES, ProjectStatus } from '../lib/db'

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

const edit = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const {
            title,
            domain,
            website_slug,
            type,
            features,
            contact_email,
            seo_focus,
            status,
            priority
        } = req.body

        // Check for duplicate domain (excluding current website)
        if (domain) {
            const existingDomain = await websitesDB.findByDomain(domain, id)
            if (existingDomain) {
                return res.status(409).json({
                    error: 'Domain already exists',
                    message: 'A website with this domain already exists.'
                })
            }
        }

        // Check for duplicate slug (excluding current website)
        if (website_slug) {
            const existingSlug = await websitesDB.findBySlug(website_slug, id)
            if (existingSlug) {
                return res.status(409).json({
                    error: 'Website slug already exists',
                    message: 'A website with this slug already exists.'
                })
            }
        }

        // Build payload with only provided fields
        const payload: {
            title?: string
            domain?: string
            website_slug?: string
            type?: string
            features?: string
            contact_email?: string
            seo_focus?: object
            status?: ProjectStatus
            priority?: number
        } = {}

        if (title !== undefined) payload.title = title
        if (domain !== undefined) payload.domain = domain
        if (website_slug !== undefined) payload.website_slug = website_slug
        if (type !== undefined) payload.type = type
        if (features !== undefined) payload.features = features
        if (contact_email !== undefined) payload.contact_email = contact_email
        if (seo_focus !== undefined) payload.seo_focus = seo_focus
        if (status !== undefined) payload.status = status
        if (priority !== undefined) payload.priority = priority

        const data = await websitesDB.update(id, payload)

        if (!data) {
            return res.status(404).json({ error: 'Website not found' })
        }

        return res.status(200).json(data)
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
            title,
            domain,
            website_slug,
            client_id,
            type,
            features,
            contact_email,
            seo_focus
        } = req.body

        // Verify client exists
        const client = await findClientById(client_id)
        if (!client) {
            return res.status(404).json({
                error: 'Client not found',
                message: 'The specified client_id does not exist.'
            })
        }

        // Check for duplicate domain
        const existingDomain = await websitesDB.findByDomain(domain)
        if (existingDomain) {
            return res.status(409).json({
                error: 'Domain already exists',
                message: 'A website with this domain already exists.'
            })
        }

        // Check for duplicate slug
        const existingSlug = await websitesDB.findBySlug(website_slug)
        if (existingSlug) {
            return res.status(409).json({
                error: 'Website slug already exists',
                message: 'A website with this slug already exists.'
            })
        }

        // Build payload
        const payload: {
            title: string
            domain: string
            website_slug: string
            client_id: string
            type?: string
            features?: string
            contact_email?: string
            seo_focus?: object
        } = {
            title,
            domain,
            website_slug,
            client_id
        }

        if (type !== undefined) payload.type = type
        if (features !== undefined) payload.features = features
        if (contact_email !== undefined) payload.contact_email = contact_email
        if (seo_focus !== undefined) payload.seo_focus = seo_focus

        const data = await websitesDB.insert(payload)

        return res.status(201).json(data)
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

        // Check if website exists
        const existing = await websitesDB.findById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Website not found' })
        }

        const data = await websitesDB.updateStatus(id, status as ProjectStatus)

        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { updateSeoFocus, edit, create, updateStatus }
