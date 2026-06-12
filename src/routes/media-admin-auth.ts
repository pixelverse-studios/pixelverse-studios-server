import { Router } from 'express'

import mediaAdminAuth from '../controllers/media-admin-auth'
import { requireMediaAdminSession } from './middleware'

const router: Router = Router()
const BASE_ROUTE = '/api/media-admin/auth'

router.post(
    `${BASE_ROUTE}/magic-link`,
    mediaAdminAuth.requestMagicLink
)

router.post(
    `${BASE_ROUTE}/callback`,
    mediaAdminAuth.callback
)

router.get(
    `${BASE_ROUTE}/session`,
    requireMediaAdminSession,
    mediaAdminAuth.getSession
)

router.post(
    `${BASE_ROUTE}/logout`,
    mediaAdminAuth.logout
)

export default router
