import { Router } from 'express'

import auditController from '../controllers/audit'

const auditRouter: Router = Router()

auditRouter.post('/api/audit', auditController.createAuditRequest)

export default auditRouter
