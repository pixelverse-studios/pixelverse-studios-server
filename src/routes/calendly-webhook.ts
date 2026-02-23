import { Router } from 'express'

import calendlyWebhookController from '../controllers/calendly-webhook'

const calendlyWebhookRouter: Router = Router()

calendlyWebhookRouter
    .route('/api/webhooks/calendly')
    .post(calendlyWebhookController.handleWebhook)
    .all((req, res) => res.status(405).json({ error: 'Method Not Allowed' }))

export default calendlyWebhookRouter
