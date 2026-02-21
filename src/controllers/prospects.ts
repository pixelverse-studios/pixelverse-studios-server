import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import { handleGenericError } from '../utils/http'
import {
    listProspects,
    getProspectStats,
    getProspectById,
    updateProspect,
    type ProspectSource,
    type ProspectStatus,
} from '../services/prospects'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const SOURCES: [ProspectSource, ...ProspectSource[]] = [
    'details_form',
    'review_request',
    'calendly_call',
]
const STATUSES: [ProspectStatus, ...ProspectStatus[]] = [
    'new',
    'contacted',
    'qualified',
    'closed',
]

const listQuerySchema = z.object({
    source: z.enum(SOURCES).optional(),
    status: z.enum(STATUSES).optional(),
    limit: z
        .string()
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 20))
        .pipe(z.number().int().min(1).max(100)),
    offset: z
        .string()
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 0))
        .pipe(z.number().int().min(0)),
})

const updateBodySchema = z
    .object({
        status: z.enum(STATUSES).optional(),
        notes: z.string().max(5000).nullable().optional(),
    })
    .refine((d) => d.status !== undefined || d.notes !== undefined, {
        message: 'At least one of status or notes must be provided',
    })

// ─── Handlers ─────────────────────────────────────────────────────────────────

const list = async (req: Request, res: Response): Promise<Response> => {
    try {
        const parsed = listQuerySchema.parse(req.query)
        const { prospects, total } = await listProspects(parsed)

        return res.status(200).json({
            total,
            limit: parsed.limit,
            offset: parsed.offset,
            prospects,
        })
    } catch (err) {
        if (err instanceof ZodError) {
            return res
                .status(400)
                .json({ error: 'Invalid query parameters', details: err.flatten() })
        }
        return handleGenericError(err, res)
    }
}

const stats = async (_req: Request, res: Response): Promise<Response> => {
    try {
        const data = await getProspectStats()
        return res.status(200).json(data)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getById = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { id } = req.params
        const prospect = await getProspectById(id)

        if (!prospect) {
            return res.status(404).json({ error: 'Prospect not found' })
        }

        return res.status(200).json(prospect)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const update = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { id } = req.params
        const patch = updateBodySchema.parse(req.body)

        const existing = await getProspectById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Prospect not found' })
        }

        const updated = await updateProspect(id, patch)
        return res.status(200).json(updated)
    } catch (err) {
        if (err instanceof ZodError) {
            return res
                .status(400)
                .json({ error: 'Invalid payload', details: err.flatten() })
        }
        return handleGenericError(err, res)
    }
}

const prospectsController = { list, stats, getById, update }

export default prospectsController
