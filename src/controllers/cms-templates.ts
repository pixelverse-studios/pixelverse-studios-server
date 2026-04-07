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
]

const MAX_FIELDS_PER_TEMPLATE = 100
const FIELD_KEY_REGEX = /^[a-z][a-z0-9_]{0,63}$/

export interface FieldValidationError {
    error: string
    field?: string
    message: string
}

/**
 * Validates the shape of a field definitions array. Each field must have a
 * well-formed `key`, string `label`, and a `type` in the allowed enum. Also
 * enforces a max field count, unique keys, and per-type option/range checks.
 * Returns a structured error object when invalid, or null when valid.
 */
const validateFieldDefinitions = (
    fields: unknown
): FieldValidationError | null => {
    if (!Array.isArray(fields)) {
        return {
            error: 'Invalid field definition',
            message: 'fields must be an array',
        }
    }
    if (fields.length > MAX_FIELDS_PER_TEMPLATE) {
        return {
            error: 'Invalid field definition',
            message: `fields array must contain at most ${MAX_FIELDS_PER_TEMPLATE} entries`,
        }
    }

    const seenKeys = new Set<string>()
    for (let i = 0; i < fields.length; i++) {
        const f = fields[i] as Partial<FieldDefinition> | null
        if (!f || typeof f !== 'object') {
            return {
                error: 'Invalid field definition',
                message: `fields[${i}] must be an object`,
            }
        }
        if (typeof f.key !== 'string' || f.key.length === 0) {
            return {
                error: 'Invalid field definition',
                field: typeof f.key === 'string' ? f.key : undefined,
                message: `fields[${i}].key must be a non-empty string`,
            }
        }
        if (!FIELD_KEY_REGEX.test(f.key)) {
            return {
                error: 'Invalid field definition',
                field: f.key,
                message: `fields[${i}].key must match ${FIELD_KEY_REGEX} (lowercase, alphanumeric + underscore, starts with a letter, max 64 chars)`,
            }
        }
        if (seenKeys.has(f.key)) {
            return {
                error: 'Invalid field definition',
                field: f.key,
                message: `duplicate field key: ${f.key}`,
            }
        }
        seenKeys.add(f.key)

        if (typeof f.label !== 'string' || f.label.length === 0) {
            return {
                error: 'Invalid field definition',
                field: f.key,
                message: `fields[${i}].label must be a non-empty string`,
            }
        }
        if (
            typeof f.type !== 'string' ||
            !VALID_FIELD_TYPES.includes(f.type as FieldType)
        ) {
            return {
                error: 'Invalid field definition',
                field: f.key,
                message: `fields[${i}].type must be one of ${VALID_FIELD_TYPES.join(', ')}`,
            }
        }

        if (f.type === 'select') {
            if (
                !Array.isArray(f.options) ||
                f.options.length === 0 ||
                !f.options.every(
                    opt => typeof opt === 'string' && opt.length > 0
                )
            ) {
                return {
                    error: 'Invalid field definition',
                    field: f.key,
                    message: 'select type requires non-empty options array of strings',
                }
            }
        }

        if (f.type === 'number') {
            if (
                typeof f.min === 'number' &&
                typeof f.max === 'number' &&
                f.min > f.max
            ) {
                return {
                    error: 'Invalid field definition',
                    field: f.key,
                    message: 'number field min must be <= max',
                }
            }
        }

        if (f.type === 'text' || f.type === 'richtext') {
            if (f.max_length !== undefined) {
                if (typeof f.max_length !== 'number' || f.max_length <= 0) {
                    return {
                        error: 'Invalid field definition',
                        field: f.key,
                        message: `${f.type} field max_length must be a positive number`,
                    }
                }
            }
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
            // Return 404 (not 403) to avoid leaking template existence to
            // unauthorized callers (IDOR enumeration protection).
            return res.status(404).json({ error: 'Template not found' })
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
            return res.status(400).json(fieldError)
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
                return res.status(400).json(fieldError)
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
