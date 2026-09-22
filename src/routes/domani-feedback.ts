import express, { Router, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { requireDomaniStaff } from '../middleware/domani-staff-auth'
import * as feedback from '../controllers/domani-feedback'

const router = Router()
const BASE_ROUTE = '/api/domani/feedback'
router.use(BASE_ROUTE, cors({
    origin: (origin, callback) => callback(null, !origin || (process.env.PVS_DASHBOARD_ORIGINS || '').split(',').map(value => value.trim()).includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600, // Cache browser preflight checks; every actual request still verifies staff access.
}))
// Prefix guard also covers any future history/send/read-state routes.
router.use(BASE_ROUTE, requireDomaniStaff)
router.get(BASE_ROUTE, feedback.list)
router.get(`${BASE_ROUTE}/stats`, feedback.stats)
router.post(`${BASE_ROUTE}/:source/:id/messages`, express.json({ limit: '128kb' }), feedback.submitReply)
router.get(`${BASE_ROUTE}/:source/:id/replies/:requestKey`, feedback.replyState)
router.post(`${BASE_ROUTE}/:source/:id/replies/:requestKey/reconcile`, feedback.reconcileReply)
router.post(`${BASE_ROUTE}/:source/:id/replies/:requestKey/retry`, feedback.replyState)
router.get(`${BASE_ROUTE}/:source/:id/messages`, feedback.history)
router.patch(`${BASE_ROUTE}/:source/:id/read`, express.json({ limit: '8kb' }), feedback.markRead)
router.get(`${BASE_ROUTE}/:source/:id`, feedback.detail)
router.get(`${BASE_ROUTE}/:id`, feedback.detail)
router.patch(`${BASE_ROUTE}/:source/:id/status`, express.json({ limit: '8kb' }), feedback.updateStatus)
router.patch(`${BASE_ROUTE}/:id/status`, express.json({ limit: '8kb' }), feedback.updateStatus)

// Keep malformed/oversized JSON responses safe and consistent at this boundary.
router.use(BASE_ROUTE, (error: any, _req: Request, res: Response, next: NextFunction) => {
    if (error?.type === 'entity.too.large') {
        res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Feedback request is too large' }, message: 'Feedback request is too large' })
    } else if (error?.type === 'entity.parse.failed') {
        res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Invalid JSON body' }, message: 'Invalid JSON body' })
    } else next(error)
})

export default router
