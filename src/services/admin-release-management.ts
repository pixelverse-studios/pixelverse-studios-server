import { db } from '../lib/db'
import {
    AdminReleaseApiError,
    DashboardActor,
} from '../lib/admin-releases'

const managementError = (message: string): AdminReleaseApiError | null => {
    const errors: Record<string, AdminReleaseApiError> = {
        DEV1042_NOT_FOUND: new AdminReleaseApiError(404, 'NOT_FOUND', 'Release resource not found'),
        DEV1042_FORBIDDEN: new AdminReleaseApiError(403, 'FORBIDDEN', 'Insufficient dashboard permissions'),
        DEV1042_PUBLISHED_ADMIN_REQUIRED: new AdminReleaseApiError(403, 'PUBLISHED_CONTENT_ADMIN_REQUIRED', 'Published release content requires an admin'),
        DEV1042_VERSION_CONFLICT: new AdminReleaseApiError(409, 'VERSION_CONFLICT', 'The release changed after it was loaded. Refresh and review the latest version.'),
        DEV1042_INVALID_STATE: new AdminReleaseApiError(422, 'INVALID_STATE_TRANSITION', 'The requested release state transition is not allowed'),
        DEV1042_PUBLIC_NOTE_REQUIRED: new AdminReleaseApiError(422, 'PUBLIC_NOTE_REQUIRED', 'At least one active public note is required'),
        DEV1042_UNSAFE_MARKDOWN: new AdminReleaseApiError(422, 'UNSAFE_PUBLIC_MARKDOWN', 'Public note Markdown contains unsupported or unsafe content', { publicBody: ['Use only the supported safe Markdown subset'] }),
        DEV1042_NOTE_SET_INVALID: new AdminReleaseApiError(409, 'VERSION_CONFLICT', 'The note set changed after it was loaded. Refresh and review the latest version.'),
        DEV1042_VERSION_EXISTS: new AdminReleaseApiError(409, 'VERSION_ALREADY_EXISTS', 'Release version already exists'),
        DEV1042_SLUG_EXISTS: new AdminReleaseApiError(409, 'SLUG_ALREADY_EXISTS', 'Release slug already exists'),
        DEV1042_SOURCE_STATE_INVALID: new AdminReleaseApiError(422, 'INVALID_STATE_TRANSITION', 'The source is not ready for approval'),
    }
    return errors[message] || null
}

const rpc = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(name, params)
    if (error) {
        const mapped = managementError(error.message)
        if (mapped) throw mapped
        if (error.code === '23505' && `${error.details || ''}${error.message}`.includes('version')) throw managementError('DEV1042_VERSION_EXISTS')!
        if (error.code === '23505' && `${error.details || ''}${error.message}`.includes('slug')) throw managementError('DEV1042_SLUG_EXISTS')!
        throw error
    }
    return data as unknown as T
}

const actorParams = (actor: DashboardActor, requestId: string) => ({
    p_actor_user_id: actor.userId,
    p_actor_email: actor.email,
    p_actor_role: actor.role,
    p_request_id: requestId,
})

export const listAdminReleases = <T>(filters: Record<string, unknown>, limit: number, after: Record<string, unknown> | null) =>
    rpc<T>('list_admin_domani_releases', { p_filters: filters, p_limit: limit, p_after: after })

export const getAdminRelease = <T>(releaseId: string, includeArchived: boolean, actor: DashboardActor) =>
    rpc<T>('get_admin_domani_release', { p_release_id: releaseId, p_include_archived: includeArchived, p_actor_role: actor.role })

export const listAdminReleaseAudit = <T>(releaseId: string, filters: Record<string, unknown>, limit: number, after: Record<string, unknown> | null) =>
    rpc<T>('list_admin_domani_release_audit', { p_release_id: releaseId, p_filters: filters, p_limit: limit, p_after: after })

export const mutateAdminRelease = <T>(operation: string, releaseId: string | null, primaryIfMatch: number | null, payload: unknown, actor: DashboardActor, requestId: string) =>
    rpc<T>('mutate_admin_domani_release', {
        p_operation: operation,
        p_release_id: releaseId,
        p_primary_if_match: primaryIfMatch,
        p_payload: payload,
        ...actorParams(actor, requestId),
    })
