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
    updateRelease,
} from '../controllers/admin-release-management'
import { adminReleaseErrorResponse } from '../lib/admin-releases'
import { requireDashboardActor, requireDashboardRole } from '../middleware/admin-release-auth'

const router = Router()
const origins = (process.env.PVS_DASHBOARD_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
const dashboardCors = cors({
    origin: (origin, callback) => callback(null, !origin || origins.includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'X-Request-Id'],
    exposedHeaders: ['ETag', 'X-Release-ETag', 'X-Request-Id'],
    maxAge: 600,
})
const json = express.json({ limit: '64kb' })

router.use('/api/admin/releases', dashboardCors)
router.use('/api/admin/releases', requireDashboardActor)

router.get('/api/admin/releases', requireDashboardRole('viewer'), listReleases)
router.post('/api/admin/releases', requireDashboardRole('editor'), json, createRelease)
router.get('/api/admin/releases/:releaseId', requireDashboardRole('viewer'), getRelease)
router.get('/api/admin/releases/:releaseId/audit', requireDashboardRole('viewer'), listReleaseAudit)
router.patch('/api/admin/releases/:releaseId', requireDashboardRole('editor'), json, updateRelease)

router.post('/api/admin/releases/:releaseId/archive', requireDashboardRole('admin'), json, releaseAction('release.archive'))
router.post('/api/admin/releases/:releaseId/publish-preview', requireDashboardRole('editor'), json, releaseAction('release.publish_preview'))
router.post('/api/admin/releases/:releaseId/return-to-private', requireDashboardRole('editor'), json, releaseAction('release.return_private'))
router.post('/api/admin/releases/:releaseId/publish', requireDashboardRole('admin'), json, releaseAction('release.publish'))
router.post('/api/admin/releases/:releaseId/unpublish', requireDashboardRole('admin'), json, releaseAction('release.unpublish'))

router.post('/api/admin/releases/:releaseId/notes', requireDashboardRole('editor'), json, createNote)
router.post('/api/admin/releases/:releaseId/notes/reorder', requireDashboardRole('editor'), json, reorderNotes)
router.patch('/api/admin/releases/:releaseId/notes/:noteId', requireDashboardRole('editor'), json, updateNote)
router.post('/api/admin/releases/:releaseId/notes/:noteId/archive', requireDashboardRole('admin'), json, archiveNote)
router.post('/api/admin/releases/:releaseId/prds/:prdId/approve', requireDashboardRole('editor'), json, approveSource)

router.use('/api/admin/releases', (error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const bodyError = error as { type?: string }
    adminReleaseErrorResponse(req, res, bodyError.type === 'entity.too.large' ? 413 : 400, 'VALIDATION_ERROR', bodyError.type === 'entity.too.large' ? 'Request body is too large' : 'Malformed request body')
})

export default router
