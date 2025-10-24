import { Router } from 'express'

import leads from '../controllers/leads'

const leadsRouter: Router = Router()
const BASE_ROUTE = '/api/leads'

leadsRouter
    .route(BASE_ROUTE)
    .post(leads.createLead)
    .all((req, res) => res.status(405).json({ error: 'Method Not Allowed' }))

export default leadsRouter
