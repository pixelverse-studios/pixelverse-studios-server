import { z, ZodError, ZodTypeAny } from 'zod'

import { FieldDefinition } from '../services/cms-templates'

export interface ContentValidationSuccess {
    ok: true
    content: Record<string, unknown>
}

export interface ContentValidationFailure {
    ok: false
    status: 400
    error: string
    details: {
        fieldErrors: Record<string, string[]>
        formErrors: string[]
    }
}

export type ContentValidationResult =
    | ContentValidationSuccess
    | ContentValidationFailure

const GROUP_SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

const buildImageGallerySchema = (field: FieldDefinition): ZodTypeAny => {
    const maxImages =
        typeof field.config?.max_images === 'number'
            ? (field.config.max_images as number)
            : undefined

    const imageSchema = z.object({
        src: z.string().url({ message: 'src must be a valid URL' }),
        alt: z.string().optional(),
        aspect_ratio: z.string().optional(),
        r2_key: z.string().optional(),
        sort_order: z.number().int().nonnegative().optional(),
    })

    const groupSchema = z.object({
        name: z.string().min(1, { message: 'group name is required' }),
        slug: z
            .string()
            .min(1, { message: 'group slug is required' })
            .regex(GROUP_SLUG_REGEX, {
                message:
                    'group slug must be lowercase alphanumeric with optional hyphens',
            }),
        sort_order: z.number().int().nonnegative().optional(),
        images: z.array(imageSchema),
    })

    let gallerySchema: ZodTypeAny = z.object({
        groups: z.array(groupSchema),
    })

    if (typeof maxImages === 'number') {
        gallerySchema = (gallerySchema as z.ZodObject<z.ZodRawShape>).superRefine(
            (data, ctx) => {
                const typed = data as {
                    groups: Array<{ images: unknown[] }>
                }
                const total = typed.groups.reduce(
                    (sum, g) => sum + g.images.length,
                    0
                )
                if (total > maxImages) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Exceeds maximum of ${maxImages} images`,
                    })
                }
            }
        )
    }

    return gallerySchema
}

const buildFieldSchema = (field: FieldDefinition): ZodTypeAny => {
    switch (field.type) {
        case 'text':
        case 'richtext': {
            let schema = z.string()
            if (typeof field.max_length === 'number') {
                schema = schema.max(field.max_length, {
                    message: `must be ${field.max_length} characters or fewer`,
                })
            }
            return schema
        }
        case 'image':
            return z.string().url({ message: 'must be a valid URL' })
        case 'number': {
            let schema = z.number()
            if (typeof field.min === 'number') {
                schema = schema.min(field.min, {
                    message: `must be >= ${field.min}`,
                })
            }
            if (typeof field.max === 'number') {
                schema = schema.max(field.max, {
                    message: `must be <= ${field.max}`,
                })
            }
            return schema
        }
        case 'boolean':
            return z.boolean()
        case 'select': {
            const options = field.options
            if (!Array.isArray(options) || options.length === 0) {
                // Fall back to any string — template validation should have
                // caught empty options on create, but stay defensive at runtime.
                return z.string()
            }
            return z.enum(options as [string, ...string[]])
        }
        case 'array':
            return z.array(z.any())
        case 'json':
            return z.any()
        case 'image_gallery':
            return buildImageGallerySchema(field)
        default:
            return z.any()
    }
}

/**
 * Builds a strict zod schema from a template's field definitions.
 * The resulting schema:
 *   - Requires fields marked `required: true`
 *   - Allows other fields to be omitted
 *   - Rejects any keys not defined in the template
 */
export const buildContentSchema = (
    fields: FieldDefinition[]
): z.ZodObject<z.ZodRawShape> => {
    const shape: z.ZodRawShape = {}

    for (const field of fields) {
        const fieldSchema = buildFieldSchema(field)
        shape[field.key] = field.required
            ? fieldSchema
            : fieldSchema.optional()
    }

    return z.object(shape).strict()
}

/**
 * Validates a content payload against a template's field definitions.
 * Returns a structured result the controller can pass to the client.
 */
export const validateContent = (
    fields: FieldDefinition[],
    content: unknown
): ContentValidationResult => {
    if (typeof content !== 'object' || content === null || Array.isArray(content)) {
        return {
            ok: false,
            status: 400,
            error: 'Content validation failed',
            details: {
                fieldErrors: {},
                formErrors: ['content must be an object'],
            },
        }
    }

    const schema = buildContentSchema(fields)

    try {
        const parsed = schema.parse(content)
        return { ok: true, content: parsed as Record<string, unknown> }
    } catch (err) {
        if (err instanceof ZodError) {
            const flattened = err.flatten()
            return {
                ok: false,
                status: 400,
                error: 'Content validation failed',
                details: {
                    fieldErrors: flattened.fieldErrors as Record<
                        string,
                        string[]
                    >,
                    formErrors: flattened.formErrors,
                },
            }
        }
        throw err
    }
}
