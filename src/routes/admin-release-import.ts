import express, { NextFunction, Request, Response, Router } from 'express'
import cors from 'cors'
import multer from 'multer'

import { importMarkdown } from '../controllers/admin-release-import'
import {
    AdminReleaseApiError,
    MAX_MARKDOWN_BYTES,
    adminReleaseErrorResponse,
} from '../lib/admin-releases'
import {
    requireDashboardActor,
    requireDashboardRole,
} from '../middleware/admin-release-auth'

const router = Router()
const dashboardOrigins = (process.env.PVS_DASHBOARD_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
const dashboardCors = cors({
    origin: (origin, callback) => {
        callback(null, !origin || dashboardOrigins.includes(origin))
    },
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'X-Request-Id'],
    exposedHeaders: ['ETag', 'X-Request-Id'],
    maxAge: 600,
})
const jsonParser = express.json({ limit: '7mb' })
const multipartParser = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_MARKDOWN_BYTES,
        files: 1,
        fields: 12,
        fieldSize: 4096,
    },
}).single('file')

export const parseImportBody = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const done = (error?: unknown) => {
        if (!error) {
            next()
            return
        }
        if (error instanceof multer.MulterError) {
            const tooLarge = error.code === 'LIMIT_FILE_SIZE'
            adminReleaseErrorResponse(
                req,
                res,
                tooLarge ? 413 : 400,
                tooLarge ? 'MARKDOWN_TOO_LARGE' : 'VALIDATION_ERROR',
                tooLarge ? 'Markdown exceeds the 1 MiB limit' : 'Invalid multipart upload',
                { file: [tooLarge ? 'Markdown must be 1 MiB or smaller' : error.message] }
            )
            return
        }
        const bodyError = error as { type?: string; status?: number }
        if (bodyError.type === 'entity.too.large') {
            adminReleaseErrorResponse(
                req,
                res,
                413,
                'MARKDOWN_TOO_LARGE',
                'Request body is too large',
                { markdown: ['Decoded Markdown must be 1 MiB or smaller'] }
            )
            return
        }
        adminReleaseErrorResponse(req, res, 400, 'VALIDATION_ERROR', 'Malformed request body')
    }

    if (req.is('application/json')) {
        jsonParser(req, res, done)
        return
    }
    if (req.is('multipart/form-data')) {
        multipartParser(req, res, done)
        return
    }
    adminReleaseErrorResponse(
        req,
        res,
        415,
        'MARKDOWN_FILE_TYPE_INVALID',
        'Content-Type must be application/json or multipart/form-data'
    )
}

router.use('/api/admin/releases', dashboardCors)

router.post(
    '/api/admin/releases/import-markdown',
    requireDashboardActor,
    requireDashboardRole('editor'),
    parseImportBody,
    importMarkdown
)

export default router
