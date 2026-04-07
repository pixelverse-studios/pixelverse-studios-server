import { z, ZodError, ZodTypeAny } from 'zod'
import sanitizeHtml from 'sanitize-html'

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

const MAX_CONTENT_BYTES = 128 * 1024 // 128KB serialized
const IMAGE_GALLERY_HARD_MAX_IMAGES = 500
const IMAGE_GALLERY_HARD_MAX_GROUPS = 50
const IMAGE_GALLERY_URL_MAX_LENGTH = 2048
const IMAGE_GALLERY_ALT_MAX_LENGTH = 500
const IMAGE_GALLERY_ASPECT_RATIO_MAX_LENGTH = 50

// Allowlist for HTML content stored in `richtext` field values.
// Coordinated with the dashboard editor's output capabilities.
// Anything not in these lists is stripped (defense-in-depth XSS protection).
const RICHTEXT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [
        'p',
        'br',
        'strong',
        'em',
        'u',
        's',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'a',
        'blockquote',
        'code',
        'pre',
        'img',
        'figure',
        'figcaption',
    ],
    allowedAttributes: {
        a: ['href', 'target', 'rel'],
        img: ['src', 'alt', 'width', 'height'],
        '*': ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    // Strip everything else (including event handlers, style attributes,
    // and any tag not in allowedTags)
    disallowedTagsMode: 'discard',
}

/**
 * Sanitizes a richtext HTML string. Strips disallowed tags/attributes,
 * `javascript:` URLs, event handlers, and inline styles.
 *
 * Returns the sanitized string. If sanitization removed content, emits
 * a structured warning log so we can detect compromised editors or
 * pasted-from-Word artifacts.
 */
const sanitizeRichtext = (key: string, value: string): string => {
    const sanitized = sanitizeHtml(value, RICHTEXT_SANITIZE_OPTIONS)
    if (sanitized !== value) {
        console.warn('cms-validation: sanitized richtext field', {
            key,
            originalLength: value.length,
            sanitizedLength: sanitized.length,
        })
    }
    return sanitized
}

const buildImageGallerySchema = (field: FieldDefinition): ZodTypeAny => {
    const maxImages =
        typeof field.config?.max_images === 'number'
            ? (field.config.max_images as number)
            : undefined

    const imageSchema = z.object({
        src: z
            .string()
            .url({ message: 'src must be a valid URL' })
            .max(IMAGE_GALLERY_URL_MAX_LENGTH, {
                message: `src must be ${IMAGE_GALLERY_URL_MAX_LENGTH} characters or fewer`,
            })
            .refine(u => /^https:\/\//i.test(u), {
                message: 'src must be an https URL',
            }),
        alt: z
            .string()
            .max(IMAGE_GALLERY_ALT_MAX_LENGTH, {
                message: `alt must be ${IMAGE_GALLERY_ALT_MAX_LENGTH} characters or fewer`,
            })
            .optional(),
        aspect_ratio: z
            .string()
            .max(IMAGE_GALLERY_ASPECT_RATIO_MAX_LENGTH, {
                message: `aspect_ratio must be ${IMAGE_GALLERY_ASPECT_RATIO_MAX_LENGTH} characters or fewer`,
            })
            .optional(),
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

    return z
        .object({
            groups: z.array(groupSchema).max(IMAGE_GALLERY_HARD_MAX_GROUPS, {
                message: `must have ${IMAGE_GALLERY_HARD_MAX_GROUPS} groups or fewer`,
            }),
        })
        .superRefine((data, ctx) => {
            const typed = data as {
                groups: Array<{ images: unknown[] }>
            }
            const total = typed.groups.reduce(
                (sum, g) => sum + g.images.length,
                0
            )
            // Always enforce the hard ceiling
            if (total > IMAGE_GALLERY_HARD_MAX_IMAGES) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Exceeds hard maximum of ${IMAGE_GALLERY_HARD_MAX_IMAGES} images`,
                })
            }
            // Additionally enforce the template-specified max if smaller
            if (
                typeof maxImages === 'number' &&
                total > maxImages &&
                maxImages < IMAGE_GALLERY_HARD_MAX_IMAGES
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Exceeds maximum of ${maxImages} images`,
                })
            }
        })
        .superRefine((data, ctx) => {
            const typed = data as { groups: Array<{ slug: string }> }
            const slugs = new Set<string>()
            for (const group of typed.groups) {
                if (slugs.has(group.slug)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Duplicate group slug: ${group.slug}`,
                    })
                    return
                }
                slugs.add(group.slug)
            }
        })
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
            return z
                .string()
                .url({ message: 'must be a valid URL' })
                .refine(u => /^https:\/\//i.test(u), {
                    message: 'must be an https URL',
                })
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
        default: {
            // Exhaustiveness check — compile error if a new FieldType is added
            // without a case above. Runtime fallback logs + rejects unknown types.
            const _exhaustive: never = field.type
            console.warn('Unknown field type in template:', _exhaustive)
            return z.never()
        }
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
            : fieldSchema.nullish()
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

    const contentJson = JSON.stringify(content)
    if (contentJson.length > MAX_CONTENT_BYTES) {
        return {
            ok: false,
            status: 400,
            error: 'Content too large',
            details: {
                fieldErrors: {},
                formErrors: [`content exceeds ${MAX_CONTENT_BYTES} bytes`],
            },
        }
    }

    const schema = buildContentSchema(fields)

    try {
        const parsed = schema.parse(content) as Record<string, unknown>
        // Post-validation: sanitize all richtext field values to strip
        // dangerous HTML before persisting. Defense-in-depth alongside
        // the dashboard editor's input-side sanitization.
        const sanitized: Record<string, unknown> = { ...parsed }
        for (const field of fields) {
            if (
                field.type === 'richtext' &&
                typeof sanitized[field.key] === 'string'
            ) {
                sanitized[field.key] = sanitizeRichtext(
                    field.key,
                    sanitized[field.key] as string
                )
            }
        }
        return { ok: true, content: sanitized }
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
