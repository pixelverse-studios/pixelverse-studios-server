import { Router } from 'express'
import { body, param } from 'express-validator'

import { validateRequest } from './middleware'
import { requireAuth, requirePvsAdmin } from './auth-middleware'
import controller from '../controllers/client-users'

const cmsUsersRouter: Router = Router()

const ROLES = ['admin', 'editor', 'viewer'] as const

cmsUsersRouter.get('/api/cms/me', requireAuth, controller.me)

cmsUsersRouter.get(
    '/api/cms/clients/:clientId/users',
    requireAuth,
    requirePvsAdmin,
    [
        param('clientId')
            .isUUID()
            .withMessage('clientId must be a valid UUID'),
    ],
    validateRequest,
    controller.list
)

cmsUsersRouter.post(
    '/api/cms/clients/:clientId/users',
    requireAuth,
    requirePvsAdmin,
    [
        param('clientId')
            .isUUID()
            .withMessage('clientId must be a valid UUID'),
        body('email')
            .isEmail()
            .withMessage('email must be a valid email address'),
        body('role')
            .isIn(ROLES as unknown as string[])
            .withMessage(`role must be one of: ${ROLES.join(', ')}`),
        body('display_name')
            .optional({ values: 'null' })
            .isString()
            .withMessage('display_name must be a string'),
    ],
    validateRequest,
    controller.invite
)

cmsUsersRouter.patch(
    '/api/cms/users/:id',
    requireAuth,
    requirePvsAdmin,
    [
        param('id').isUUID().withMessage('id must be a valid UUID'),
        body('role')
            .isIn(ROLES as unknown as string[])
            .withMessage(`role must be one of: ${ROLES.join(', ')}`),
    ],
    validateRequest,
    controller.updateRole
)

cmsUsersRouter.delete(
    '/api/cms/users/:id',
    requireAuth,
    requirePvsAdmin,
    [param('id').isUUID().withMessage('id must be a valid UUID')],
    validateRequest,
    controller.remove
)

export default cmsUsersRouter
