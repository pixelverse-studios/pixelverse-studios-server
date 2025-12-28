import { Router } from 'express'
import { body } from 'express-validator'

import { validateRequest } from './middleware'
import projects from '../controllers/projects'

const projectsRouter: Router = Router()
const BASE_ROUTE = '/api/projects'

projectsRouter.patch(
    `${BASE_ROUTE}/reorder`,
    [
        body('items')
            .isArray({ min: 1 })
            .withMessage('items must be a non-empty array'),
        body('items.*.id')
            .isUUID()
            .withMessage('Each item must have a valid UUID id'),
        body('items.*.type')
            .isIn(['website', 'app'])
            .withMessage('Each item type must be "website" or "app"'),
        body('items.*.priority')
            .isInt()
            .withMessage('Each item must have an integer priority')
    ],
    validateRequest,
    projects.reorder
)

export default projectsRouter
