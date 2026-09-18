import express, { Router, Request, Response, NextFunction } from 'express'
import { receiveDelivery } from '../controllers/domani-feedback-webhook'
const router = Router()
const path = '/api/webhooks/domani/feedback/resend'
router.post(path, express.raw({ type: 'application/json', limit: '256kb' }), receiveDelivery)
router.use(path, (error: any, _req: Request, res: Response, next: NextFunction) => {
    if (error?.type === 'entity.too.large') res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE' } })
    else next(error)
})
export default router
