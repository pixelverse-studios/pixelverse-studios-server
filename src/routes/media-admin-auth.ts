import { Router } from 'express'
import { body } from 'express-validator'

import mediaAdminAuth from '../controllers/media-admin-auth'
import { requireMediaAdminSession, validateRequest } from './middleware'

const router: Router = Router()
const BASE_ROUTE = '/api/media-admin/auth'

router.post(
    `${BASE_ROUTE}/magic-link`,
    [body('email').isEmail().withMessage('Valid email is required')],
    validateRequest,
    mediaAdminAuth.requestMagicLink
)

router.post(
    `${BASE_ROUTE}/callback`,
    [body('token').isString().notEmpty().withMessage('token is required')],
    validateRequest,
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
