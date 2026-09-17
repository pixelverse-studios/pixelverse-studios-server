import express, { Router, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { requireDomaniStaff } from '../middleware/domani-staff-auth'
import * as feedback from '../controllers/domani-feedback'

const router = Router()
router.use('/api/domani/feedback', cors({
    origin: (origin, callback) => callback(null, !origin || (process.env.PVS_DASHBOARD_ORIGINS || '').split(',').map(value => value.trim()).includes(origin)),
    methods: ['GET', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
}))
// Prefix guard also covers any future history/send/read-state routes.
router.use('/api/domani/feedback', requireDomaniStaff)
router.get('/api/domani/feedback', feedback.list)
router.get('/api/domani/feedback/stats', feedback.stats)
router.get('/api/domani/feedback/:source/:id', feedback.detail)
router.get('/api/domani/feedback/:id', feedback.detail)
router.patch('/api/domani/feedback/:source/:id/status', express.json({ limit: '8kb' }), feedback.updateStatus)
router.patch('/api/domani/feedback/:id/status', express.json({ limit: '8kb' }), feedback.updateStatus)

// Keep malformed/oversized JSON responses safe and consistent at this boundary.
router.use('/api/domani/feedback', (error: any, _req: Request, res: Response, next: NextFunction) => {
    if (error?.type === 'entity.too.large') {
        res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Feedback request exceeds 8 KiB' }, message: 'Feedback request exceeds 8 KiB' })
    } else if (error?.type === 'entity.parse.failed') {
        res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Invalid JSON body' }, message: 'Invalid JSON body' })
    } else next(error)
})

export default router
