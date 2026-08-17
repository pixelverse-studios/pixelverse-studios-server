import { Request, Response } from 'express'

import {
    ADMIN_RELEASE_API_VERSION,
    AdminReleaseApiError,
    adminReleaseErrorResponse,
    requestIdFor
} from '../lib/admin-releases'
import {
    approveSourceSchema,
    archiveNoteSchema,
    auditFiltersSchema,
    createNoteSchema,
    createReleaseSchema,
    emptyActionSchema,
    markReleasedSchema,
    nextCursor,
    pagination,
    parseBody,
    parseUuid,
    releaseListFiltersSchema,
    reorderNotesSchema,
    requireIfMatch,
    saveReleaseEditorSchema,
    setVisibilitySchema,
    updateNoteSchema,
    updateReleaseSchema
} from '../lib/admin-release-management'
import { isSafeReleaseNoteMarkdown } from '../lib/release-markdown-converter'
import { domaniReleaseCalendarDate } from '../lib/release-calendar'
import {
    getAdminRelease,
    listAdminReleaseAudit,
    listAdminReleases,
    mutateAdminRelease
} from '../services/admin-release-management'

interface MutationRpcResult {
    data: Record<string, any>
    releaseRowVersion: number
    primaryRowVersion: number
    cacheInvalidation: {
        jobId: string
        status: 'pending' | 'delivered'
        targets: string[]
    } | null
}

const actor = (req: Request) => {
    if (!req.dashboardActor)
        throw new AdminReleaseApiError(
            401,
            'AUTH_REQUIRED',
            'Authentication is required'
        )
    return req.dashboardActor
}

const sendError = (
    req: Request,
    res: Response,
    error: unknown,
    label: string
): Response => {
    if (error instanceof AdminReleaseApiError)
        return adminReleaseErrorResponse(
            req,
            res,
            error.status,
            error.code,
            error.message,
            error.fieldErrors
        )
    console.error(`Admin release ${label} failed:`, {
        requestId: req.requestId,
        message: error instanceof Error ? error.message : String(error)
    })
    return adminReleaseErrorResponse(
        req,
        res,
        500,
        'INTERNAL_ERROR',
        `Unable to ${label}`
    )
}

const successMeta = (
    requestId: string,
    next: string | null = null,
    cacheInvalidation?: MutationRpcResult['cacheInvalidation']
) => ({
    apiVersion: ADMIN_RELEASE_API_VERSION,
    requestId,
    nextCursor: next,
    ...(cacheInvalidation ? { cacheInvalidation } : {})
})

const sendMutation = (
    res: Response,
    requestId: string,
    result: MutationRpcResult,
    status = 200
): Response => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('ETag', `"${result.primaryRowVersion}"`)
    res.setHeader('X-Release-ETag', `"${result.releaseRowVersion}"`)
    return res
        .status(status)
        .json({
            data: result.data,
            meta: successMeta(requestId, null, result.cacheInvalidation)
        })
}

const querySubset = (
    query: Request['query'],
    keys: string[]
): Record<string, unknown> =>
    Object.fromEntries(
        keys
            .filter(key => query[key] !== undefined)
            .map(key => [key, query[key]])
    )

const assertQueryKeys = (query: Request['query'], allowed: string[]): void => {
    const unknown = Object.keys(query).filter(key => !allowed.includes(key))
    if (unknown.length)
        throw new AdminReleaseApiError(
            400,
            'VALIDATION_ERROR',
            'Invalid query fields',
            Object.fromEntries(
                unknown.map(key => [key, ['Query field is not allowed']])
            )
        )
}

export const listReleases = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const currentActor = actor(req)
        assertQueryKeys(req.query, [
            'lifecycle',
            'visibility',
            'releaseType',
            'platform',
            'version',
            'archived',
            'limit',
            'cursor'
        ])
        const parsed = parseBody(
            releaseListFiltersSchema,
            querySubset(req.query, [
                'lifecycle',
                'visibility',
                'releaseType',
                'platform',
                'version',
                'archived'
            ])
        )
        const filters = {
            lifecycle: parsed.lifecycle || null,
            visibility: parsed.visibility || null,
            releaseType: parsed.releaseType || null,
            platform: parsed.platform || null,
            version: parsed.version || null,
            archived: parsed.archived === 'true'
        }
        if (filters.archived && currentActor.role !== 'admin') {
            throw new AdminReleaseApiError(
                403,
                'FORBIDDEN',
                'Only admins may list archived releases'
            )
        }
        const page = pagination(req.query, filters)
        const result = await listAdminReleases<{
            releases: any[]
            last: { orderedAt: string; id: string } | null
        }>(filters, page.limit, page.after)
        const capabilities = {
            canCreateRelease: currentActor.role !== 'viewer',
            canViewArchivedReleases: currentActor.role === 'admin'
        }
        res.setHeader('Cache-Control', 'no-store')
        return res.json({
            data: { releases: result.releases, capabilities, filters },
            meta: successMeta(requestId, nextCursor(filters, result.last))
        })
    } catch (error) {
        return sendError(req, res, error, 'list releases')
    }
}

export const createRelease = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const payload = parseBody(createReleaseSchema, req.body)
        return sendMutation(
            res,
            requestId,
            await mutateAdminRelease(
                'release.create',
                null,
                null,
                payload,
                actor(req),
                requestId
            ),
            201
        )
    } catch (error) {
        return sendError(req, res, error, 'create release')
    }
}

export const getRelease = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const currentActor = actor(req)
        assertQueryKeys(req.query, ['includeArchived'])
        const releaseId = parseUuid(req.params.releaseId, 'releaseId')
        const includeArchived = req.query.includeArchived === 'true'
        if (
            req.query.includeArchived !== undefined &&
            !['true', 'false'].includes(String(req.query.includeArchived))
        )
            throw new AdminReleaseApiError(
                400,
                'VALIDATION_ERROR',
                'Invalid includeArchived',
                { includeArchived: ['Use true or false'] }
            )
        if (includeArchived && currentActor.role !== 'admin')
            throw new AdminReleaseApiError(
                403,
                'FORBIDDEN',
                'Only admins may include archived records'
            )
        const release = await getAdminRelease<any>(
            releaseId,
            includeArchived,
            currentActor
        )
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('ETag', `"${release.rowVersion}"`)
        return res.json({ data: { release }, meta: successMeta(requestId) })
    } catch (error) {
        return sendError(req, res, error, 'get release')
    }
}

export const listReleaseAudit = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        actor(req)
        assertQueryKeys(req.query, ['action', 'entityType', 'limit', 'cursor'])
        const releaseId = parseUuid(req.params.releaseId, 'releaseId')
        const parsed = parseBody(
            auditFiltersSchema,
            querySubset(req.query, ['action', 'entityType'])
        )
        const filters = {
            action: parsed.action || null,
            entityType: parsed.entityType || null
        }
        const cursorScope = { releaseId, ...filters }
        const page = pagination(req.query, cursorScope)
        const result = await listAdminReleaseAudit<{
            events: any[]
            last: { orderedAt: string; id: string } | null
        }>(releaseId, filters, page.limit, page.after)
        res.setHeader('Cache-Control', 'no-store')
        return res.json({
            data: { events: result.events },
            meta: successMeta(requestId, nextCursor(cursorScope, result.last))
        })
    } catch (error) {
        return sendError(req, res, error, 'list release audit')
    }
}

export const updateRelease = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const releaseId = parseUuid(req.params.releaseId, 'releaseId')
        const payload = parseBody(updateReleaseSchema, req.body)
        return sendMutation(
            res,
            requestId,
            await mutateAdminRelease(
                'release.update',
                releaseId,
                requireIfMatch(req),
                payload,
                actor(req),
                requestId
            )
        )
    } catch (error) {
        return sendError(req, res, error, 'update release')
    }
}

export const saveReleaseEditor = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const releaseId = req.params.releaseId
            ? parseUuid(req.params.releaseId, 'releaseId')
            : null
        const payload = parseBody(saveReleaseEditorSchema, req.body)
        const currentActor = actor(req)
        const primaryIfMatch = releaseId ? requireIfMatch(req) : null
        if (currentActor.role !== 'admin') {
            const publishesToChangelog =
                payload.status === 'published' &&
                payload.timing.kind === 'date' &&
                payload.timing.value <= domaniReleaseCalendarDate()
            if (publishesToChangelog)
                throw new AdminReleaseApiError(
                    403,
                    'PUBLISHED_CONTENT_ADMIN_REQUIRED',
                    'Only an administrator can publish a release to the changelog'
                )
            if (releaseId) {
                const currentRelease = await getAdminRelease<any>(
                    releaseId,
                    false,
                    currentActor
                )
                if (currentRelease.visibility === 'published')
                    throw new AdminReleaseApiError(
                        403,
                        'PUBLISHED_CONTENT_ADMIN_REQUIRED',
                        'Only an administrator can change a published changelog release'
                    )
            }
        }
        return sendMutation(
            res,
            requestId,
            await mutateAdminRelease(
                'release.editor.save',
                releaseId,
                primaryIfMatch,
                payload,
                currentActor,
                requestId
            ),
            releaseId ? 200 : 201
        )
    } catch (error) {
        return sendError(req, res, error, 'save release')
    }
}

export const markReleaseReleased = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const releaseId = parseUuid(req.params.releaseId, 'releaseId')
        const payload = parseBody(markReleasedSchema, req.body)
        return sendMutation(
            res,
            requestId,
            await mutateAdminRelease(
                'release.mark_released',
                releaseId,
                requireIfMatch(req),
                payload,
                actor(req),
                requestId
            )
        )
    } catch (error) {
        return sendError(req, res, error, 'mark release as released')
    }
}

export const setReleaseVisibility = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const releaseId = parseUuid(req.params.releaseId, 'releaseId')
        const payload = parseBody(setVisibilitySchema, req.body)
        return sendMutation(
            res,
            requestId,
            await mutateAdminRelease(
                'release.set_visibility',
                releaseId,
                requireIfMatch(req),
                payload,
                actor(req),
                requestId
            )
        )
    } catch (error) {
        return sendError(req, res, error, 'set release visibility')
    }
}

export const releaseAction =
    (operation: string) =>
    async (req: Request, res: Response): Promise<Response> => {
        const requestId = requestIdFor(req, res)
        try {
            const releaseId = parseUuid(req.params.releaseId, 'releaseId')
            const payload = parseBody(emptyActionSchema, req.body)
            return sendMutation(
                res,
                requestId,
                await mutateAdminRelease(
                    operation,
                    releaseId,
                    requireIfMatch(req),
                    payload,
                    actor(req),
                    requestId
                )
            )
        } catch (error) {
            return sendError(req, res, error, operation)
        }
    }

export const createNote = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const releaseId = parseUuid(req.params.releaseId, 'releaseId')
        const payload = parseBody(createNoteSchema, req.body)
        if (!isSafeReleaseNoteMarkdown(payload.publicBody))
            throw new AdminReleaseApiError(
                422,
                'UNSAFE_PUBLIC_MARKDOWN',
                'Public note Markdown contains unsupported or unsafe content',
                { publicBody: ['Use only the supported safe Markdown subset'] }
            )
        return sendMutation(
            res,
            requestId,
            await mutateAdminRelease(
                'note.create',
                releaseId,
                requireIfMatch(req),
                payload,
                actor(req),
                requestId
            ),
            201
        )
    } catch (error) {
        return sendError(req, res, error, 'create note')
    }
}

export const updateNote = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const releaseId = parseUuid(req.params.releaseId, 'releaseId')
        const noteId = parseUuid(req.params.noteId, 'noteId')
        const payload = parseBody(updateNoteSchema, req.body)
        if (
            payload.publicBody !== undefined &&
            !isSafeReleaseNoteMarkdown(payload.publicBody)
        )
            throw new AdminReleaseApiError(
                422,
                'UNSAFE_PUBLIC_MARKDOWN',
                'Public note Markdown contains unsupported or unsafe content',
                { publicBody: ['Use only the supported safe Markdown subset'] }
            )
        return sendMutation(
            res,
            requestId,
            await mutateAdminRelease(
                'note.update',
                releaseId,
                requireIfMatch(req, 'note'),
                { ...payload, noteId },
                actor(req),
                requestId
            )
        )
    } catch (error) {
        return sendError(req, res, error, 'update note')
    }
}

export const archiveNote = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const releaseId = parseUuid(req.params.releaseId, 'releaseId')
        const noteId = parseUuid(req.params.noteId, 'noteId')
        const payload = parseBody(archiveNoteSchema, req.body)
        return sendMutation(
            res,
            requestId,
            await mutateAdminRelease(
                'note.archive',
                releaseId,
                requireIfMatch(req, 'note'),
                { ...payload, noteId },
                actor(req),
                requestId
            )
        )
    } catch (error) {
        return sendError(req, res, error, 'archive note')
    }
}

export const reorderNotes = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const releaseId = parseUuid(req.params.releaseId, 'releaseId')
        const payload = parseBody(reorderNotesSchema, req.body)
        return sendMutation(
            res,
            requestId,
            await mutateAdminRelease(
                'note.reorder',
                releaseId,
                requireIfMatch(req),
                payload,
                actor(req),
                requestId
            )
        )
    } catch (error) {
        return sendError(req, res, error, 'reorder notes')
    }
}

export const approveSource = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const requestId = requestIdFor(req, res)
    try {
        const releaseId = parseUuid(req.params.releaseId, 'releaseId')
        const sourceId = parseUuid(req.params.prdId, 'prdId')
        const payload = parseBody(approveSourceSchema, req.body)
        return sendMutation(
            res,
            requestId,
            await mutateAdminRelease(
                'source.approve',
                releaseId,
                requireIfMatch(req, 'source'),
                { ...payload, sourceId },
                actor(req),
                requestId
            )
        )
    } catch (error) {
        return sendError(req, res, error, 'approve source')
    }
}
