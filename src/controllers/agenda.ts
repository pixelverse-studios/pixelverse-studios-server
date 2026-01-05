import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import { handleGenericError } from '../utils/http'
import agendaService from '../services/agenda'

/**
 * GET /api/agenda
 * List agenda items with filtering and pagination
 *
 * Query params:
 * - status: 'pending' | 'in_progress' | 'completed' | 'active'
 * - category: filter by exact category match
 * - include_completed: 'true' to include completed items
 * - limit: max items (default 50, max 100)
 * - offset: pagination offset (default 0)
 */
const list = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const status = req.query.status as string | undefined
        const category = req.query.category as string | undefined
        const includeCompleted = req.query.include_completed === 'true'
        const limit = Math.min(
            parseInt(req.query.limit as string) || 50,
            100
        )
        const offset = parseInt(req.query.offset as string) || 0

        const result = await agendaService.getAll({
            status,
            category,
            includeCompleted,
            limit,
            offset
        })

        return res.status(200).json({
            items: result.items,
            total: result.total
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

/**
 * GET /api/agenda/:id
 * Get a single agenda item by ID
 */
const getOne = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const item = await agendaService.getById(id)

        if (!item) {
            return res.status(404).json({ message: 'Agenda item not found' })
        }

        return res.status(200).json(item)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

/**
 * POST /api/agenda/new
 * Create a new agenda item
 */
const create = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { name, description, category, due_date } = req.body

        const item = await agendaService.create({
            name,
            description,
            category,
            due_date
        })

        return res.status(201).json(item)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default {
    list,
    getOne,
    create
}
