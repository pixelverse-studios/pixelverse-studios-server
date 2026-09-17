import { Request, Response } from 'express'
import { ZodError } from 'zod'
import { feedbackIdentitySchema, feedbackQuerySchema, feedbackStatusSchema } from '../lib/domani-feedback'
import * as service from '../services/domani-feedback'

const fail = (res: Response, error: unknown) => {
    if (error instanceof ZodError) return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Invalid feedback request', details: error.flatten() },
        message: 'Invalid feedback request',
    })
    // Avoid logging user content, SQL parameters or service credentials.
    console.error('Domani feedback operation failed', { code: (error as { code?: string })?.code || 'UNKNOWN' })
    return res.status(503).json({ error: { code: 'FEEDBACK_UNAVAILABLE', message: 'Feedback service unavailable' }, message: 'Feedback service unavailable' })
}
const missing = (res: Response) => res.status(404).json({
    error: { code: 'FEEDBACK_NOT_FOUND', message: 'Feedback not found' }, message: 'Feedback not found',
})

export const list = async (req: Request, res: Response) => {
    try {
        const query = feedbackQuerySchema.parse(req.query)
        return res.json(await service.listFeedback(query))
    } catch (error) { return fail(res, error) }
}
export const stats = async (req: Request, res: Response) => {
    try {
        const result = await service.listFeedback({ ...feedbackQuerySchema.parse(req.query), limit: 1, offset: 0 })
        return res.json(result.stats)
    } catch (error) { return fail(res, error) }
}
export const detail = async (req: Request, res: Response) => {
    try {
        const { source, id } = feedbackIdentitySchema.parse({ source: req.params.source || req.query.source, id: req.params.id })
        const item = await service.getFeedback(source, id)
        return item ? res.json(item) : missing(res)
    } catch (error) { return fail(res, error) }
}
export const updateStatus = async (req: Request, res: Response) => {
    try {
        const { source, id } = feedbackIdentitySchema.parse({ source: req.params.source || req.body?.source, id: req.params.id })
        const body = { ...req.body }
        if (!req.params.source) delete body.source
        const { status } = feedbackStatusSchema.parse(body)
        if (!req.dashboardActor) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }, message: 'Authentication required' })
        const item = await service.changeFeedbackStatus(source, id, status, req.dashboardActor)
        return item ? res.json(item) : missing(res)
    } catch (error) { return fail(res, error) }
}
