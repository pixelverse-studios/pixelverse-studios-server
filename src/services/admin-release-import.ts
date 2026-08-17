import { domaniDb } from '../lib/domani-db'
import {
    AdminReleaseApiError,
    DashboardActor,
    ImportMarkdownInput,
    ImportMarkdownResult,
    markdownSha256
} from '../lib/admin-releases'

const businessError = (message: string): AdminReleaseApiError | null => {
    const errors: Record<string, AdminReleaseApiError> = {
        DEV1008_NOT_FOUND: new AdminReleaseApiError(
            404,
            'NOT_FOUND',
            'Release not found'
        ),
        DEV1008_ROLE_REQUIRED: new AdminReleaseApiError(
            403,
            'ROLE_REQUIRED',
            'An active dashboard role is required'
        ),
        DEV1008_FORBIDDEN: new AdminReleaseApiError(
            403,
            'FORBIDDEN',
            'Insufficient dashboard permissions'
        ),
        DEV1008_PRECONDITION_REQUIRED: new AdminReleaseApiError(
            428,
            'PRECONDITION_REQUIRED',
            'If-Match is required for an existing release',
            { ifMatch: ['Provide the current release row version'] }
        ),
        DEV1008_VERSION_CONFLICT: new AdminReleaseApiError(
            409,
            'VERSION_CONFLICT',
            'The release changed since it was loaded'
        ),
        DEV1008_PUBLISHED_ADMIN_REQUIRED: new AdminReleaseApiError(
            403,
            'PUBLISHED_CONTENT_ADMIN_REQUIRED',
            'Published release content requires an admin'
        ),
        DEV1008_IDEMPOTENCY_CONFLICT: new AdminReleaseApiError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This source was already imported with a different intended surface'
        ),
        DEV1008_CREATION_FIELDS_REQUIRED: new AdminReleaseApiError(
            400,
            'VALIDATION_ERROR',
            'New releases require releaseTitle and releaseSlug',
            {
                releaseTitle: ['Required when releaseVersion does not exist'],
                releaseSlug: ['Required when releaseVersion does not exist']
            }
        ),
        DEV1008_RELEASE_TYPE_INVALID: new AdminReleaseApiError(
            400,
            'VALIDATION_ERROR',
            'releaseType does not match the release version',
            {
                releaseVersion: ['Use a canonical X.Y.Z semantic version']
            }
        ),
        DEV1008_VERSION_ALREADY_EXISTS: new AdminReleaseApiError(
            409,
            'VERSION_ALREADY_EXISTS',
            'Release version already exists'
        ),
        DEV1008_SLUG_ALREADY_EXISTS: new AdminReleaseApiError(
            409,
            'SLUG_ALREADY_EXISTS',
            'Release slug already exists'
        )
    }
    return errors[message] || null
}

export const importReleaseMarkdown = async (
    input: ImportMarkdownInput,
    actor: DashboardActor,
    requestId: string
): Promise<ImportMarkdownResult> => {
    const { data, error } = await domaniDb.rpc(
        'import_domani_release_markdown',
        {
            p_release_id: input.releaseId,
            p_release_version: input.releaseVersion,
            p_release_title: input.releaseTitle,
            p_release_slug: input.releaseSlug,
            p_release_type: input.releaseType,
            p_source_type: input.sourceType,
            p_source_reference: input.sourceReference,
            p_raw_markdown: input.markdown,
            p_original_filename: input.filename,
            p_source_content_sha256: markdownSha256(input.markdown),
            p_intended_surface: input.intendedSurface,
            p_if_match: input.ifMatch,
            p_actor_user_id: actor.userId,
            p_actor_email: actor.email,
            p_actor_role: actor.role,
            p_request_id: requestId
        }
    )
    if (error) {
        const mapped = businessError(error.message)
        if (mapped) throw mapped
        throw error
    }
    return data as unknown as ImportMarkdownResult
}
