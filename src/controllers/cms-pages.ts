import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import cmsPagesService, {
    CmsPublishStatus,
} from '../services/cms-pages'
import cmsTemplatesService from '../services/cms-templates'
import { validateContent } from '../utils/cms-validation'
import { handleGenericError } from '../utils/http'
import {
    hasEditAccessToClient,
    hasViewAccessToClient,
} from '../routes/auth-middleware'

const list = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { clientId } = req.params
        const statusFilter = req.query.status as CmsPublishStatus | undefined

        // The route validator applies .toInt() so limit/offset arrive as
        // numbers when present. Bounds (1-100, >=0) are already enforced
        // by the validator — defaults kick in only when the query param
        // is absent.
        const limit =
            typeof req.query.limit === 'number' ? req.query.limit : 50
        const offset =
            typeof req.query.offset === 'number' ? req.query.offset : 0

        const pages = await cmsPagesService.findByClientId(clientId, {
            status: statusFilter,
            limit,
            offset,
        })
        return res.status(200).json(pages)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

// GET /api/cms/pages/:id uses only requireAuth (no requireCmsAccess) because
// the URL does not contain clientId — the client scope must be resolved from
// the page record. Authorization is performed here after the resource lookup.
const getById = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const page = await cmsPagesService.findByIdWithTemplate(id)
        if (!page) {
            return res.status(404).json({ error: 'Page not found' })
        }

        // Resource-level auth: check the caller has view access to this page's client.
        // Returns 404 (not 403) for forbidden to avoid ID enumeration.
        const hasAccess = await hasViewAccessToClient(req, page.client_id)
        if (!hasAccess) {
            return res.status(404).json({ error: 'Page not found' })
        }

        return res.status(200).json(page)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const create = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { clientId } = req.params
        const { template_id, slug, content, status } = req.body as {
            template_id: string
            slug: string
            content: Record<string, unknown>
            status?: CmsPublishStatus
        }

        const template = await cmsTemplatesService.findById(template_id)
        if (!template) {
            return res.status(404).json({ error: 'Template not found' })
        }
        if (template.client_id !== clientId) {
            return res.status(400).json({
                error: 'Template does not belong to this client',
            })
        }

        const validation = validateContent(template.fields, content)
        if (!validation.ok) {
            return res.status(validation.status).json({
                error: validation.error,
                details: validation.details,
            })
        }

        const page = await cmsPagesService.insert({
            client_id: clientId,
            template_id: template.id,
            slug,
            content: validation.content,
            status,
            template_version: template.version,
            last_edited_by: req.authUser?.uid ?? null,
        })

        return res.status(201).json(page)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const update = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const existing = await cmsPagesService.findById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Page not found' })
        }

        if (!req.authUser) {
            return res.status(401).json({ error: 'Unauthorized' })
        }

        const canEdit = await hasEditAccessToClient(req, existing.client_id)
        if (!canEdit) {
            return res.status(404).json({ error: 'Page not found' })
        }

        const { slug, content, status } = req.body as {
            slug?: string
            content?: Record<string, unknown>
            status?: CmsPublishStatus
        }

        // If content is being updated, validate against the current template
        let validatedContent: Record<string, unknown> | undefined
        let templateVersionToBump: number | undefined
        if (content !== undefined) {
            const template = await cmsTemplatesService.findById(
                existing.template_id
            )
            if (!template) {
                return res.status(409).json({
                    error: 'Template no longer exists for this page',
                    message:
                        'The template this page references has been deleted. Contact a PVS admin to resolve.',
                })
            }
            const validation = validateContent(template.fields, content)
            if (!validation.ok) {
                return res.status(validation.status).json({
                    error: validation.error,
                    details: validation.details,
                })
            }
            validatedContent = validation.content
            templateVersionToBump = template.version
        }

        const updated = await cmsPagesService.update(id, {
            slug,
            content: validatedContent,
            status,
            last_edited_by: req.authUser.uid,
            template_version: templateVersionToBump,
        })

        return res.status(200).json(updated)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const publish = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const existing = await cmsPagesService.findById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Page not found' })
        }

        if (!req.authUser) {
            return res.status(401).json({ error: 'Unauthorized' })
        }

        const canEdit = await hasEditAccessToClient(req, existing.client_id)
        if (!canEdit) {
            return res.status(404).json({ error: 'Page not found' })
        }

        // Re-validate the stored content against the current template before
        // publishing. Prevents a stale page whose template has changed from
        // being published with content that no longer conforms.
        const template = await cmsTemplatesService.findById(existing.template_id)
        if (!template) {
            return res.status(409).json({
                error: 'Template no longer exists for this page',
                message:
                    'The template this page references has been deleted. Contact a PVS admin to resolve.',
            })
        }
        const validation = validateContent(template.fields, existing.content)
        if (!validation.ok) {
            return res.status(validation.status).json({
                error: 'Cannot publish: content no longer matches template',
                details: validation.details,
            })
        }

        const published = await cmsPagesService.publish(id, req.authUser.uid)
        return res.status(200).json(published)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const remove = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const existing = await cmsPagesService.findById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Page not found' })
        }

        if (!req.authUser) {
            return res.status(401).json({ error: 'Unauthorized' })
        }

        const canEdit = await hasEditAccessToClient(req, existing.client_id)
        if (!canEdit) {
            return res.status(404).json({ error: 'Page not found' })
        }

        await cmsPagesService.remove(id)
        return res.status(200).json({ success: true })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { list, getById, create, update, publish, remove }
