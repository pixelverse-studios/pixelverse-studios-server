import { recordIncomingEvent, feedbackReplyDomain } from '../services/domani-feedback-inbound'
import type { Request, Response } from 'express'
import { Webhook } from 'svix'
import { ZodError } from 'zod'
import { recordDeliveryEvent } from '../services/domani-feedback-delivery'

export async function receiveDelivery(req: Request, res: Response) {
    const secret = process.env.DOMANI_FEEDBACK_WEBHOOK_SECRET
    if (!secret) return res.status(503).json({ error: { code: 'WEBHOOK_UNCONFIGURED' } })
    const id = req.get('svix-id') || ''
    let payload: unknown
    try {
        if (!Buffer.isBuffer(req.body) || !id || id.length > 250) throw new Error('Invalid webhook')
        new Webhook(secret).verify(req.body.toString('utf8'), {
            'svix-id': id, 'svix-timestamp': req.get('svix-timestamp') || '', 'svix-signature': req.get('svix-signature') || '',
        })
        payload = JSON.parse(req.body.toString('utf8'))
    } catch { return res.status(400).json({ error: { code: 'INVALID_WEBHOOK_SIGNATURE' } }) }
    try {
        if ((payload as { type?: string })?.type === 'email.received') {
            if (!feedbackReplyDomain()) return res.status(503).json({ error: { code: 'INBOUND_DISABLED' } })
            await recordIncomingEvent(id, payload)
        } else await recordDeliveryEvent(id, payload)
        return res.status(202).json({ received: true })
    } catch (error) {
        if (error instanceof ZodError) return res.status(400).json({ error: { code: 'INVALID_WEBHOOK_EVENT' } })
        console.error('Domani delivery receipt failed', { eventId: id })
        return res.status(503).json({ error: { code: 'WEBHOOK_RETRY_REQUIRED' } })
    }
}
