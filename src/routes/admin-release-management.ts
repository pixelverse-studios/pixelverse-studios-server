import cors from 'cors'
import express, { Router } from 'express'

import {
    approveSource,
    archiveNote,
    createNote,
    createRelease,
    getRelease,
    listReleaseAudit,
    listReleases,
    releaseAction,
    reorderNotes,
    updateNote,
    updateRelease
} from '../controllers/admin-release-management'
import { adminReleaseErrorResponse } from '../lib/admin-releases'
import { requireDashboardActor } from '../middleware/admin-release-auth'

const router = Router()
const origins = (process.env.PVS_DASHBOARD_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
const dashboardCors = cors({
    origin: (origin, callback) =>
        callback(null, !origin || origins.includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Authorization',
        'Content-Type',
        'If-Match',
        'X-Request-Id'
    ],
    exposedHeaders: ['ETag', 'X-Release-ETag', 'X-Request-Id'],
    maxAge: 600
})
const json = express.json({ limit: '64kb' })

router.use('/api/admin/releases', dashboardCors)
router.use('/api/admin/releases', requireDashboardActor)

router.get('/api/admin/releases', listReleases)
router.post('/api/admin/releases', json, createRelease)
router.get('/api/admin/releases/:releaseId', getRelease)
router.get('/api/admin/releases/:releaseId/audit', listReleaseAudit)
router.patch('/api/admin/releases/:releaseId', json, updateRelease)

router.post(
    '/api/admin/releases/:releaseId/archive',
    json,
    releaseAction('release.archive')
)
router.post(
    '/api/admin/releases/:releaseId/publish-preview',
    json,
    releaseAction('release.publish_preview')
)
router.post(
    '/api/admin/releases/:releaseId/return-to-private',
    json,
    releaseAction('release.return_private')
)
router.post(
    '/api/admin/releases/:releaseId/publish',
    json,
    releaseAction('release.publish')
)
router.post(
    '/api/admin/releases/:releaseId/unpublish',
    json,
    releaseAction('release.unpublish')
)

router.post('/api/admin/releases/:releaseId/notes', json, createNote)
router.post('/api/admin/releases/:releaseId/notes/reorder', json, reorderNotes)
router.patch('/api/admin/releases/:releaseId/notes/:noteId', json, updateNote)
router.post(
    '/api/admin/releases/:releaseId/notes/:noteId/archive',
    json,
    archiveNote
)
router.post(
    '/api/admin/releases/:releaseId/prds/:prdId/approve',
    json,
    approveSource
)

router.use(
    '/api/admin/releases',
    (
        error: unknown,
        req: express.Request,
        res: express.Response,
        _next: express.NextFunction
    ) => {
        const bodyError = error as { type?: string }
        adminReleaseErrorResponse(
            req,
            res,
            bodyError.type === 'entity.too.large' ? 413 : 400,
            'VALIDATION_ERROR',
            bodyError.type === 'entity.too.large'
                ? 'Request body is too large'
                : 'Malformed request body'
        )
    }
)

export default router
