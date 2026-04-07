import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import cmsTemplatesService, {
    FieldDefinition,
    FieldType,
} from '../services/cms-templates'
import clientUsersService from '../services/client-users'
import { handleGenericError } from '../utils/http'

const VALID_FIELD_TYPES: FieldType[] = [
    'text',
    'richtext',
    'image',
    'number',
    'boolean',
    'select',
    'array',
    'json',
    'image_gallery',
]

/**
 * Validates the shape of a field definitions array. Each field must have a
 * string `key`, string `label`, and a `type` in the allowed enum. Returns an
 * error message string when invalid, or null when valid.
 */
const validateFieldDefinitions = (fields: unknown): string | null => {
    if (!Array.isArray(fields)) {
        return 'fields must be an array'
    }
    for (let i = 0; i < fields.length; i++) {
        const f = fields[i] as Partial<FieldDefinition> | null
        if (!f || typeof f !== 'object') {
            return `fields[${i}] must be an object`
        }
        if (typeof f.key !== 'string' || f.key.length === 0) {
            return `fields[${i}].key must be a non-empty string`
        }
        if (typeof f.label !== 'string' || f.label.length === 0) {
            return `fields[${i}].label must be a non-empty string`
        }
        if (
            typeof f.type !== 'string' ||
            !VALID_FIELD_TYPES.includes(f.type as FieldType)
        ) {
            return `fields[${i}].type must be one of ${VALID_FIELD_TYPES.join(', ')}`
        }
    }
    return null
}

const list = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { clientId } = req.params
        const templates = await cmsTemplatesService.findByClientId(clientId)
        return res.status(200).json(templates)
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
        const template = await cmsTemplatesService.findById(id)
        if (!template) {
            return res.status(404).json({ error: 'Template not found' })
        }

        // Resource-level authorization: load the user's assignments and check
        // that they either are a PVS admin or have access to this template's
        // client_id. Middleware can't do this because client_id lives on the
        // resource, not the URL.
        if (!req.authUser) {
            return res.status(401).json({ error: 'Unauthorized' })
        }

        let assignments = req.cmsUserAssignments
        if (!assignments) {
            assignments = await clientUsersService.findByAuthUid(
                req.authUser.uid
            )
        }

        const isPvsAdmin = assignments.some(a => a.is_pvs_admin)
        const hasClientAccess = assignments.some(
            a => a.client_id === template.client_id
        )
        if (!isPvsAdmin && !hasClientAccess) {
            return res.status(403).json({ error: 'Forbidden' })
        }

        return res.status(200).json(template)
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
        const { slug, label, description, fields, active } = req.body

        const fieldError = validateFieldDefinitions(fields)
        if (fieldError) {
            return res.status(400).json({ error: fieldError })
        }

        const existing = await cmsTemplatesService.findByClientAndSlug(
            clientId,
            slug
        )
        if (existing) {
            return res.status(409).json({
                error: 'Template slug already exists for this client',
            })
        }

        const template = await cmsTemplatesService.insert({
            client_id: clientId,
            slug,
            label,
            description: description ?? null,
            fields: fields as FieldDefinition[],
            active,
            created_by: req.authUser?.uid ?? null,
        })

        return res.status(201).json(template)
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
        const { slug, label, description, fields, active } = req.body

        if (fields !== undefined) {
            const fieldError = validateFieldDefinitions(fields)
            if (fieldError) {
                return res.status(400).json({ error: fieldError })
            }
        }

        const existing = await cmsTemplatesService.findById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Template not found' })
        }

        // If the slug is changing, check uniqueness within the client scope.
        if (slug !== undefined && slug !== existing.slug) {
            const conflict = await cmsTemplatesService.findByClientAndSlug(
                existing.client_id,
                slug
            )
            if (conflict) {
                return res.status(409).json({
                    error: 'Template slug already exists for this client',
                })
            }
        }

        const updated = await cmsTemplatesService.update(id, {
            slug,
            label,
            description,
            fields,
            active,
        })

        return res.status(200).json(updated)
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
        const existing = await cmsTemplatesService.findById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Template not found' })
        }

        await cmsTemplatesService.remove(id)
        return res.status(204).send()
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default {
    list,
    getById,
    create,
    update,
    remove,
}
