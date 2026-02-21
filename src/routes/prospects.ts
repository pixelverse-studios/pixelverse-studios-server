import { Router } from 'express'

import prospectsController from '../controllers/prospects'

const prospectsRouter: Router = Router()

// GET /api/prospects/stats must come before /:id to avoid "stats" being
// treated as a UUID parameter.
prospectsRouter
    .route('/api/prospects/stats')
    .get(prospectsController.stats)
    .all((req, res) => res.status(405).json({ error: 'Method Not Allowed' }))

prospectsRouter
    .route('/api/prospects')
    .get(prospectsController.list)
    .all((req, res) => res.status(405).json({ error: 'Method Not Allowed' }))

prospectsRouter
    .route('/api/prospects/:id')
    .get(prospectsController.getById)
    .patch(prospectsController.update)
    .all((req, res) => res.status(405).json({ error: 'Method Not Allowed' }))

export default prospectsRouter
