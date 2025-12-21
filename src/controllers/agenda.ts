import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import agendaDB from '../services/agenda'
import { handleGenericError } from '../utils/http'

const getAll = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { status, category, include_completed, limit, offset } = req.query

        const options = {
            status: status as string | undefined,
            category: category as string | undefined,
            includeCompleted: include_completed === 'true',
            limit: limit ? parseInt(limit as string, 10) : 50,
            offset: offset ? parseInt(offset as string, 10) : 0
        }

        const result = await agendaDB.getAll(options)
        return res.status(200).json(result)
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
        const item = await agendaDB.getById(id)

        if (!item) {
            return res.status(404).json({ error: 'Agenda item not found' })
        }

        return res.status(200).json(item)
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

        const { name, description, category, due_date, priority } = req.body

        const payload: {
            name: string
            description?: string
            category?: string
            due_date?: string
            priority?: number
        } = { name }

        if (description !== undefined) payload.description = description
        if (category !== undefined) payload.category = category
        if (due_date !== undefined) payload.due_date = due_date
        if (priority !== undefined) payload.priority = priority

        const data = await agendaDB.insert(payload)
        return res.status(201).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const update = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const { name, description, category, due_date } = req.body

        // Verify item exists
        const existing = await agendaDB.getById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Agenda item not found' })
        }

        // Build payload with only provided fields
        const payload: Record<string, unknown> = {}

        if (name !== undefined) payload.name = name
        if (description !== undefined) payload.description = description
        if (category !== undefined) payload.category = category
        if (due_date !== undefined) payload.due_date = due_date

        const data = await agendaDB.update(id, payload)
        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const updateStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const { status } = req.body

        // Verify item exists
        const existing = await agendaDB.getById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Agenda item not found' })
        }

        const data = await agendaDB.updateStatus(id, status)
        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const updatePriority = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const { priority } = req.body

        // Verify item exists
        const existing = await agendaDB.getById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Agenda item not found' })
        }

        const data = await agendaDB.updatePriority(id, priority)
        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const reorder = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { item_ids } = req.body

        // Verify all items exist
        for (const id of item_ids) {
            const existing = await agendaDB.getById(id)
            if (!existing) {
                return res.status(404).json({
                    error: 'Agenda item not found',
                    message: `Item with ID ${id} not found`
                })
            }
        }

        const result = await agendaDB.reorder(item_ids)
        return res.status(200).json(result)
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

        // Verify item exists
        const existing = await agendaDB.getById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Agenda item not found' })
        }

        await agendaDB.remove(id)
        return res.status(200).json({ message: 'Agenda item deleted successfully' })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    updatePriority,
    reorder,
    remove
}
