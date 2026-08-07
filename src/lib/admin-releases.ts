import crypto from 'crypto'
import path from 'path'
import { Request, Response } from 'express'
import { z } from 'zod'

export const ADMIN_RELEASE_API_VERSION = '2026-08-05' as const
export const MAX_MARKDOWN_BYTES = 1_048_576

export const DASHBOARD_ROLES = ['viewer', 'editor', 'admin'] as const
export type DashboardRole = (typeof DASHBOARD_ROLES)[number]

export interface DashboardActor {
    userId: string
    email: string
    role: DashboardRole
}

export type ReleaseType = 'major' | 'minor' | 'patch' | 'roadmap'
export type ReleaseSourceType =
    | 'linear_epic'
    | 'linear_ticket'
    | 'milestone'
    | 'manual'
export type ReleaseIntendedSurface = 'changelog' | 'coming_soon' | 'both'

export interface ImportMarkdownInput {
    markdown: string
    filename: string | null
    releaseId: string | null
    releaseVersion: string | null
    releaseTitle: string | null
    releaseSlug: string | null
    releaseType: ReleaseType | null
    sourceType: ReleaseSourceType
    sourceReference: string
    intendedSurface: ReleaseIntendedSurface
    ifMatch: number | null
}

export interface AdminRelease {
    id: string
    version: string
    slug: string
    title: string
    releaseType: ReleaseType
    lifecycleStatus: 'draft' | 'planned' | 'in_progress' | 'released' | 'canceled'
    visibility: 'private' | 'public_preview' | 'published'
    publicSummary: string | null
    internalSummary: string | null
    targetMonth: string | null
    targetDate: string | null
    confirmedDate: string | null
    releasedAt: string | null
    ownerUserId: string | null
    rowVersion: number
    createdAt: string
    updatedAt: string
    archivedAt: string | null
}

export interface AdminReleaseSource {
    id: string
    releaseId: string
    rawMarkdown: string
    originalFilename: string | null
    sourceType: ReleaseSourceType
    sourceReference: string
    sourceContentSha256: string
    intendedSurface: ReleaseIntendedSurface
    conversionStatus: 'raw' | 'needs_review' | 'approved' | 'failed' | 'superseded'
    latestConversionRunId: string | null
    conversionErrorCode: string | null
    conversionErrorMessage: string | null
    rowVersion: number
    createdAt: string
    updatedAt: string
}

export interface ImportMarkdownResult {
    release: AdminRelease
    source: AdminReleaseSource
    duplicate: boolean
}

export type FieldErrors = Record<string, string[]>

export class AdminReleaseApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly fieldErrors: FieldErrors = {}
    ) {
        super(message)
        this.name = 'AdminReleaseApiError'
    }
}

export const requestIdFor = (req: Request, res: Response): string => {
    const candidate =
        req.requestId || res.getHeader('x-request-id')?.toString() || crypto.randomUUID()
    const normalized = candidate.trim()
    const requestId =
        normalized.length > 0 && normalized.length <= 255
            ? normalized
            : crypto.randomUUID()
    req.requestId = requestId
    res.setHeader('x-request-id', requestId)
    return requestId
}

export const adminReleaseErrorResponse = (
    req: Request,
    res: Response,
    status: number,
    code: string,
    message: string,
    fieldErrors: FieldErrors = {}
): Response => {
    const requestId = requestIdFor(req, res)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(status).json({
        error: { code, message, fieldErrors, requestId },
    })
}

const optionalTrimmed = (max: number) =>
    z.preprocess(
        value => (value === '' || value === undefined ? undefined : value),
        z.string().trim().min(1).max(max).optional()
    )

const importFieldsSchema = z
    .object({
        markdown: z.string().optional(),
        filename: optionalTrimmed(255),
        releaseId: z.preprocess(
            value => (value === '' || value === undefined ? undefined : value),
            z.string().uuid().optional()
        ),
        releaseVersion: z.preprocess(
            value => (value === '' || value === undefined ? undefined : value),
            z
                .string()
                .regex(/^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(\.(0|[1-9][0-9]{0,8}))?$/)
                .optional()
        ),
        releaseTitle: optionalTrimmed(160),
        releaseSlug: z.preprocess(
            value => (value === '' || value === undefined ? undefined : value),
            z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional()
        ),
        releaseType: z.enum(['major', 'minor', 'patch', 'roadmap']).optional(),
        sourceType: z.enum(['linear_epic', 'linear_ticket', 'milestone', 'manual']),
        sourceReference: z.string().trim().min(1).max(2048),
        intendedSurface: z
            .enum(['changelog', 'coming_soon', 'both'])
            .optional()
            .default('changelog'),
        convert: z.union([z.literal(false), z.literal('false')]).optional().default(false),
    })
    .strict()
    .superRefine((value, context) => {
        if (Boolean(value.releaseId) === Boolean(value.releaseVersion)) {
            const message = 'Provide exactly one of releaseId or releaseVersion'
            context.addIssue({ code: z.ZodIssueCode.custom, path: ['releaseId'], message })
            context.addIssue({ code: z.ZodIssueCode.custom, path: ['releaseVersion'], message })
        }
    })

const fieldErrorsFor = (error: z.ZodError): FieldErrors => {
    const result: FieldErrors = {}
    error.issues.forEach(issue => {
        if (issue.code === z.ZodIssueCode.unrecognized_keys) {
            issue.keys.forEach(key => {
                result[key] = ['Field is not allowed']
            })
            return
        }
        const field = issue.path.join('.') || 'body'
        if (!result[field]) result[field] = []
        if (!result[field].includes(issue.message)) result[field].push(issue.message)
    })
    return result
}

const sanitizeFilename = (filename: string): string => {
    const normalized = filename.replace(/\\/g, '/')
    return path.posix.basename(normalized).trim()
}

const markdownFromBytes = (bytes: Buffer): string => {
    if (bytes.length === 0) {
        throw new AdminReleaseApiError(400, 'MARKDOWN_FILE_REQUIRED', 'Markdown content is required', {
            file: ['Markdown content is required'],
        })
    }
    if (bytes.length > MAX_MARKDOWN_BYTES) {
        throw new AdminReleaseApiError(413, 'MARKDOWN_TOO_LARGE', 'Markdown exceeds the 1 MiB limit', {
            file: ['Markdown must be 1 MiB or smaller'],
        })
    }

    let markdown: string
    try {
        markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        throw new AdminReleaseApiError(400, 'MARKDOWN_INVALID_UTF8', 'Markdown must be valid UTF-8', {
            file: ['Markdown must be valid UTF-8'],
        })
    }
    if (markdown.includes('\0')) {
        throw new AdminReleaseApiError(400, 'MARKDOWN_INVALID_UTF8', 'Markdown cannot contain NUL bytes', {
            file: ['Markdown cannot contain NUL bytes'],
        })
    }
    return markdown
}

export const parseIfMatch = (value: string | undefined): number | null => {
    if (value === undefined) return null
    const match = value.match(/^"([1-9][0-9]*)"$/)
    if (!match) {
        throw new AdminReleaseApiError(400, 'VALIDATION_ERROR', 'Invalid If-Match header', {
            ifMatch: ['If-Match must be a quoted positive row version'],
        })
    }
    const rowVersion = Number(match[1])
    if (!Number.isSafeInteger(rowVersion)) {
        throw new AdminReleaseApiError(400, 'VALIDATION_ERROR', 'Invalid If-Match header', {
            ifMatch: ['If-Match row version is outside the supported range'],
        })
    }
    return rowVersion
}

export const normalizeImportMarkdownRequest = (
    req: Request
): ImportMarkdownInput => {
    const raw = req.body as Record<string, unknown>
    if (raw?.convert === true || raw?.convert === 'true') {
        throw new AdminReleaseApiError(
            422,
            'IMPORT_CONVERSION_NOT_SUPPORTED',
            'Import and conversion are separate operations',
            { convert: ['convert=true is not supported; import first, then convert'] }
        )
    }

    const parsed = importFieldsSchema.safeParse(raw)
    if (!parsed.success) {
        throw new AdminReleaseApiError(
            400,
            'VALIDATION_ERROR',
            'Invalid request fields',
            fieldErrorsFor(parsed.error)
        )
    }

    const isMultipart = Boolean(req.is('multipart/form-data'))
    let filename = parsed.data.filename || null
    let bytes: Buffer
    if (isMultipart) {
        if (!req.file) {
            throw new AdminReleaseApiError(400, 'MARKDOWN_FILE_REQUIRED', 'A Markdown file is required', {
                file: ['Upload exactly one file in the file field'],
            })
        }
        filename = sanitizeFilename(req.file.originalname)
        if (!filename || filename.length > 255 || !filename.toLowerCase().endsWith('.md')) {
            throw new AdminReleaseApiError(
                415,
                'MARKDOWN_FILE_TYPE_INVALID',
                'Only .md files are supported',
                { file: ['Filename must end in .md'] }
            )
        }
        bytes = req.file.buffer
    } else {
        if (typeof parsed.data.markdown !== 'string') {
            throw new AdminReleaseApiError(400, 'MARKDOWN_FILE_REQUIRED', 'Markdown content is required', {
                markdown: ['Markdown content is required'],
            })
        }
        bytes = Buffer.from(parsed.data.markdown, 'utf8')
        if (filename) {
            filename = sanitizeFilename(filename)
            if (!filename || filename.length > 255) {
                throw new AdminReleaseApiError(400, 'VALIDATION_ERROR', 'Invalid filename', {
                    filename: ['Filename must be between 1 and 255 characters'],
                })
            }
        }
    }

    const markdown = markdownFromBytes(bytes)
    const ifMatch = parseIfMatch(req.get('if-match'))
    if (parsed.data.releaseId && ifMatch === null) {
        throw new AdminReleaseApiError(
            428,
            'PRECONDITION_REQUIRED',
            'If-Match is required for an existing release',
            { ifMatch: ['Provide the current release row version'] }
        )
    }

    return {
        markdown,
        filename,
        releaseId: parsed.data.releaseId || null,
        releaseVersion: parsed.data.releaseVersion || null,
        releaseTitle: parsed.data.releaseTitle || null,
        releaseSlug: parsed.data.releaseSlug || null,
        releaseType: parsed.data.releaseType || null,
        sourceType: parsed.data.sourceType,
        sourceReference: parsed.data.sourceReference,
        intendedSurface: parsed.data.intendedSurface,
        ifMatch,
    }
}

export const markdownSha256 = (markdown: string): string =>
    crypto.createHash('sha256').update(Buffer.from(markdown, 'utf8')).digest('hex')
