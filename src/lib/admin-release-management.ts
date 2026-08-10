import crypto from 'crypto'
import { Request } from 'express'
import { z } from 'zod'

import {
    ADMIN_RELEASE_API_VERSION,
    AdminReleaseApiError,
    FieldErrors,
    RELEASE_AUDIT_ACTIONS,
    RELEASE_AUDIT_ENTITY_TYPES,
    parseIfMatch,
} from './admin-releases'
import { normalizeReleaseNoteMarkdown } from './release-markdown-converter'

const cursorSecret = () => process.env.ADMIN_RELEASE_CURSOR_SECRET || process.env.DOMANI_RELEASE_CURSOR_SECRET || ''

const fieldErrorsFor = (error: z.ZodError): FieldErrors => {
    const fields: FieldErrors = {}
    for (const issue of error.issues) {
        if (issue.code === z.ZodIssueCode.unrecognized_keys) {
            issue.keys.forEach(key => { fields[key] = ['Field is not allowed'] })
            continue
        }
        const key = issue.path.join('.') || 'body'
        fields[key] ||= []
        fields[key].push(issue.message)
    }
    return fields
}

export const parseBody = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
        throw new AdminReleaseApiError(400, 'VALIDATION_ERROR', 'Invalid request fields', fieldErrorsFor(parsed.error))
    }
    return parsed.data
}

export const requireIfMatch = (req: Request, resource = 'release'): number => {
    const version = parseIfMatch(req.get('if-match'))
    if (version === null) {
        throw new AdminReleaseApiError(428, 'PRECONDITION_REQUIRED', `If-Match is required for the ${resource}`, {
            ifMatch: [`Provide the current ${resource} row version`],
        })
    }
    return version
}

const nullableText = (max: number) => z.string().max(max).nullable().optional()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}, 'Date must be a real calendar date')
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}-01T00:00:00.000Z`)
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 7) === value
}, 'Month must be a real calendar month')
const date = isoDate.nullable().optional()
const month = isoMonth.nullable().optional()

export const createReleaseSchema = z.object({
    version: z.string().regex(/^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(\.(0|[1-9][0-9]{0,8}))?$/),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(160),
    releaseType: z.enum(['major', 'minor', 'patch', 'roadmap']),
    publicSummary: nullableText(2000),
    internalSummary: nullableText(10000),
    targetMonth: month,
    targetDate: date,
    confirmedDate: date,
    ownerUserId: z.string().uuid().nullable().optional(),
}).strict().superRefine((value, context) => {
    const hasPatch = value.version.split('.').length === 3
    if ((value.releaseType === 'patch') !== hasPatch) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['releaseType'], message: 'Patch versions require patch; two-part versions require a non-patch type' })
    }
})

export const updateReleaseSchema = z.object({
    title: z.string().trim().min(1).max(160).optional(),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
    releaseType: z.enum(['major', 'minor', 'patch', 'roadmap']).optional(),
    lifecycleStatus: z.enum(['draft', 'planned', 'in_progress', 'released', 'canceled']).optional(),
    publicSummary: nullableText(2000),
    internalSummary: nullableText(10000),
    targetMonth: month,
    targetDate: date,
    confirmedDate: date,
    releasedAt: z.string().datetime({ offset: true }).nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, { message: 'At least one field is required' })

const publicMarkdown = z.string()
    .transform(normalizeReleaseNoteMarkdown)
    .pipe(z.string().trim().min(1).max(4000))
const platforms = z.array(z.enum(['ios', 'android'])).min(1).max(2).refine(items => new Set(items).size === items.length, 'Platforms must be unique')
export const createNoteSchema = z.object({
    noteType: z.enum(['feature', 'improvement', 'fix', 'breaking']),
    publicTitle: z.string().trim().min(1).max(160),
    publicBody: publicMarkdown,
    technicalNotes: nullableText(20000),
    platforms,
    isPublic: z.boolean().optional().default(false),
}).strict()

export const updateNoteSchema = z.object({
    releaseRowVersion: z.number().int().positive(),
    noteType: z.enum(['feature', 'improvement', 'fix', 'breaking']).optional(),
    publicTitle: z.string().trim().min(1).max(160).optional(),
    publicBody: publicMarkdown.optional(),
    technicalNotes: nullableText(20000),
    platforms: platforms.optional(),
    isPublic: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).some(key => key !== 'releaseRowVersion'), { message: 'At least one note field is required' })

export const archiveNoteSchema = z.object({ releaseRowVersion: z.number().int().positive() }).strict()
export const reorderNotesSchema = z.object({
    notes: z.array(z.object({ id: z.string().uuid(), rowVersion: z.number().int().positive() }).strict()),
}).strict()

export const emptyActionSchema = z.object({}).strict()

export const approveSourceSchema = z.object({
    releaseRowVersion: z.number().int().positive(),
    noteRowVersions: z.array(z.object({ id: z.string().uuid(), rowVersion: z.number().int().positive() }).strict()),
}).strict()

const encodeCursor = (payload: Record<string, unknown>): string => {
    const secret = cursorSecret()
    if (!secret) throw new Error('ADMIN_RELEASE_CURSOR_SECRET is required')
    const encoded = Buffer.from(JSON.stringify({ apiVersion: ADMIN_RELEASE_API_VERSION, ...payload })).toString('base64url')
    const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url')
    return `${encoded}.${signature}`
}

const decodeCursor = (cursor: string, filters: Record<string, unknown>): { orderedAt: string; id: string } => {
    const secret = cursorSecret()
    if (!secret) throw new Error('ADMIN_RELEASE_CURSOR_SECRET is required')
    const [encoded, signature, extra] = cursor.split('.')
    const expected = crypto.createHmac('sha256', secret).update(encoded || '').digest('base64url')
    const actualSignature = Buffer.from(signature || '')
    const expectedSignature = Buffer.from(expected)
    if (!encoded || !signature || extra || actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
        throw new AdminReleaseApiError(400, 'VALIDATION_ERROR', 'Invalid cursor', { cursor: ['Cursor is invalid'] })
    }
    try {
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
        if (payload.apiVersion !== ADMIN_RELEASE_API_VERSION || JSON.stringify(payload.filters) !== JSON.stringify(filters) || typeof payload.orderedAt !== 'string' || !z.string().uuid().safeParse(payload.id).success) throw new Error()
        return { orderedAt: payload.orderedAt, id: payload.id }
    } catch {
        throw new AdminReleaseApiError(400, 'VALIDATION_ERROR', 'Invalid cursor', { cursor: ['Cursor does not match the active filters'] })
    }
}

export interface PageOptions { limit: number; after: { orderedAt: string; id: string } | null }
export const pagination = (query: Record<string, unknown>, filters: Record<string, unknown>): PageOptions => {
    if (query.limit !== undefined && typeof query.limit !== 'string') throw new AdminReleaseApiError(400, 'VALIDATION_ERROR', 'Invalid limit', { limit: ['Limit must be a single integer'] })
    const limitResult = z.coerce.number().int().min(1).max(100).default(20).safeParse(query.limit)
    if (!limitResult.success) throw new AdminReleaseApiError(400, 'VALIDATION_ERROR', 'Invalid limit', { limit: ['Limit must be between 1 and 100'] })
    if (query.cursor !== undefined && typeof query.cursor !== 'string') throw new AdminReleaseApiError(400, 'VALIDATION_ERROR', 'Invalid cursor', { cursor: ['Cursor must be a single string'] })
    const cursor = typeof query.cursor === 'string' ? decodeCursor(query.cursor, filters) : null
    return { limit: limitResult.data, after: cursor }
}

export const nextCursor = (filters: Record<string, unknown>, item: { orderedAt: string; id: string } | null): string | null =>
    item ? encodeCursor({ filters, ...item }) : null

export const releaseListFiltersSchema = z.object({
    lifecycle: z.enum(['draft', 'planned', 'in_progress', 'released', 'canceled']).optional(),
    visibility: z.enum(['private', 'public_preview', 'published']).optional(),
    releaseType: z.enum(['major', 'minor', 'patch', 'roadmap']).optional(),
    platform: z.enum(['ios', 'android']).optional(),
    version: z.string().max(64).optional(),
    archived: z.enum(['true', 'false']).optional(),
}).strict()

export const auditFiltersSchema = z.object({
    action: z.enum(RELEASE_AUDIT_ACTIONS).optional(),
    entityType: z.enum(RELEASE_AUDIT_ENTITY_TYPES).optional(),
}).strict()

export const parseUuid = (value: string, field: string): string => {
    if (!z.string().uuid().safeParse(value).success) throw new AdminReleaseApiError(400, 'VALIDATION_ERROR', `Invalid ${field}`, { [field]: [`${field} must be a UUID`] })
    return value
}
