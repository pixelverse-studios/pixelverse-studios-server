import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import cmsPagesService, {
    CmsPublishStatus,
} from '../services/cms-pages'
import cmsTemplatesService from '../services/cms-templates'
import clientUsersService from '../services/client-users'
import { validateContent } from '../utils/cms-validation'
import { handleGenericError } from '../utils/http'

const VALID_STATUSES: CmsPublishStatus[] = ['draft', 'published', 'archived']

/**
 * Checks whether the current authenticated user can view pages for a client.
 * Mirrors requireCmsAccess('view') semantics but is callable from controllers
 * that need to make the check after a resource lookup.
 */
const hasViewAccessToClient = async (
    req: Request,
    clientId: string
): Promise<boolean> => {
    if (!req.authUser) return false

    const assignments =
        req.cmsUserAssignments ||
        (await clientUsersService.findByAuthUid(req.authUser.uid))
    if (!req.cmsUserAssignments) req.cmsUserAssignments = assignments

    if (assignments.some(a => a.is_pvs_admin)) return true
    return assignments.some(a => a.client_id === clientId)
}

const list = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { clientId } = req.params
        const statusFilter = req.query.status as CmsPublishStatus | undefined

        if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
            return res.status(400).json({
                error: 'Invalid status filter',
                message: `status must be one of ${VALID_STATUSES.join(', ')}`,
            })
        }

        const pages = await cmsPagesService.findByClientId(
            clientId,
            statusFilter
        )
        return res.status(200).json(pages)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

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

        // Resource-level auth — need edit access for this page's client.
        if (!req.authUser) {
            return res.status(401).json({ error: 'Unauthorized' })
        }
        const assignments =
            req.cmsUserAssignments ||
            (await clientUsersService.findByAuthUid(req.authUser.uid))
        if (!req.cmsUserAssignments) req.cmsUserAssignments = assignments

        const isPvsAdmin = assignments.some(a => a.is_pvs_admin)
        const clientAssignment = assignments.find(
            a => a.client_id === existing.client_id
        )
        const canEdit =
            isPvsAdmin ||
            (clientAssignment !== undefined &&
                (clientAssignment.role === 'editor' ||
                    clientAssignment.role === 'admin'))
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
        if (content !== undefined) {
            const template = await cmsTemplatesService.findById(
                existing.template_id
            )
            if (!template) {
                return res.status(500).json({
                    error: 'Template no longer exists for this page',
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
        }

        const updated = await cmsPagesService.update(id, {
            slug,
            content: validatedContent,
            status,
            last_edited_by: req.authUser.uid,
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

        // Resource-level edit access check
        const assignments =
            req.cmsUserAssignments ||
            (await clientUsersService.findByAuthUid(req.authUser.uid))
        if (!req.cmsUserAssignments) req.cmsUserAssignments = assignments

        const isPvsAdmin = assignments.some(a => a.is_pvs_admin)
        const clientAssignment = assignments.find(
            a => a.client_id === existing.client_id
        )
        const canEdit =
            isPvsAdmin ||
            (clientAssignment !== undefined &&
                (clientAssignment.role === 'editor' ||
                    clientAssignment.role === 'admin'))
        if (!canEdit) {
            return res.status(404).json({ error: 'Page not found' })
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

        const assignments =
            req.cmsUserAssignments ||
            (await clientUsersService.findByAuthUid(req.authUser.uid))
        if (!req.cmsUserAssignments) req.cmsUserAssignments = assignments

        const isPvsAdmin = assignments.some(a => a.is_pvs_admin)
        const clientAssignment = assignments.find(
            a => a.client_id === existing.client_id
        )
        const canEdit =
            isPvsAdmin ||
            (clientAssignment !== undefined &&
                (clientAssignment.role === 'editor' ||
                    clientAssignment.role === 'admin'))
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
