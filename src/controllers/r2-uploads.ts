import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import r2UploadsService from '../services/r2-uploads'
import { R2ConfigError } from '../lib/r2'
import { hasEditAccessToClient } from '../routes/auth-middleware'
import { handleGenericError } from '../utils/http'

const presign = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { websiteId } = req.params
        const website = await r2UploadsService.fetchWebsiteForUpload(websiteId)
        if (!website) {
            return res.status(404).json({ error: 'Website not found' })
        }

        const hasAccess = await hasEditAccessToClient(req, website.client_id)
        if (!hasAccess) {
            return res.status(403).json({ error: 'Forbidden' })
        }

        const { filename, content_type, folder } = req.body as {
            filename: string
            content_type: string
            folder?: string
        }

        const result = await r2UploadsService.createPresignedUpload({
            website,
            filename,
            contentType: content_type,
            folder: folder || '',
        })

        return res.status(201).json(result)
    } catch (err) {
        if (err instanceof R2ConfigError) {
            console.error('R2 config error:', err.message)
            return res
                .status(503)
                .json({ error: 'R2 storage not configured' })
        }
        return handleGenericError(err, res)
    }
}

const remove = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { websiteId } = req.params
        const website = await r2UploadsService.fetchWebsiteForUpload(websiteId)
        if (!website) {
            return res.status(404).json({ error: 'Website not found' })
        }

        const hasAccess = await hasEditAccessToClient(req, website.client_id)
        if (!hasAccess) {
            return res.status(403).json({ error: 'Forbidden' })
        }

        const { r2_key } = req.body as { r2_key: string }

        await r2UploadsService.deleteUpload({
            website,
            r2_key,
        })

        return res.status(200).json({ success: true })
    } catch (err) {
        if (err instanceof R2ConfigError) {
            console.error('R2 config error:', err.message)
            return res
                .status(503)
                .json({ error: 'R2 storage not configured' })
        }
        return handleGenericError(err, res)
    }
}

export default { presign, remove }
