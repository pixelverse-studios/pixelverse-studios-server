import { domaniDb, DomaniTables } from '../lib/domani-db'
import {
    AdminReleaseApiError,
    ConvertMarkdownInput,
    ConvertMarkdownResult,
    DashboardActor
} from '../lib/admin-releases'
import {
    ConversionContentError,
    RELEASE_CONVERTER_VERSION,
    convertReleaseMarkdown
} from '../lib/release-markdown-converter'

const conversionBusinessError = (
    message: string
): AdminReleaseApiError | null => {
    const errors: Record<string, AdminReleaseApiError> = {
        DEV1009_NOT_FOUND: new AdminReleaseApiError(
            404,
            'NOT_FOUND',
            'Release source not found'
        ),
        DEV1009_ROLE_REQUIRED: new AdminReleaseApiError(
            403,
            'ROLE_REQUIRED',
            'An active dashboard role is required'
        ),
        DEV1009_FORBIDDEN: new AdminReleaseApiError(
            403,
            'FORBIDDEN',
            'Insufficient dashboard permissions'
        ),
        DEV1009_PUBLISHED_ADMIN_REQUIRED: new AdminReleaseApiError(
            403,
            'PUBLISHED_CONTENT_ADMIN_REQUIRED',
            'Published release content requires an admin'
        ),
        DEV1009_SOURCE_SUPERSEDED: new AdminReleaseApiError(
            422,
            'INVALID_STATE_TRANSITION',
            'Superseded Markdown sources cannot be converted'
        ),
        DEV1009_SOURCE_VERSION_CONFLICT: new AdminReleaseApiError(
            409,
            'VERSION_CONFLICT',
            'The Markdown source changed since it was loaded'
        ),
        DEV1009_RELEASE_VERSION_CONFLICT: new AdminReleaseApiError(
            409,
            'VERSION_CONFLICT',
            'The release changed since it was loaded'
        ),
        DEV1009_INVALID_NOTES: new AdminReleaseApiError(
            422,
            'CONVERSION_FAILED',
            'Generated release notes failed validation'
        )
    }
    return errors[message] || null
}

const callConversionRpc = async (
    input: ConvertMarkdownInput,
    actor: DashboardActor,
    requestId: string,
    notes: unknown[] | null,
    failure: ConversionContentError | null
): Promise<ConvertMarkdownResult | null> => {
    const { data, error } = await domaniDb.rpc(
        'convert_domani_release_markdown',
        {
            p_release_id: input.releaseId,
            p_prd_id: input.prdId,
            p_source_if_match: input.sourceIfMatch,
            p_release_if_match: input.releaseRowVersion,
            p_converter_version: RELEASE_CONVERTER_VERSION,
            p_notes: notes,
            p_failure_code: failure?.code || null,
            p_failure_message: failure?.message || null,
            p_actor_user_id: actor.userId,
            p_actor_email: actor.email,
            p_actor_role: actor.role,
            p_request_id: requestId
        }
    )
    if (error) {
        const mapped = conversionBusinessError(error.message)
        if (mapped) throw mapped
        throw error
    }
    return data as unknown as ConvertMarkdownResult | null
}

export const convertSavedReleaseMarkdown = async (
    input: ConvertMarkdownInput,
    actor: DashboardActor,
    requestId: string
): Promise<ConvertMarkdownResult> => {
    if (input.rewriteMode === 'provider_assisted') {
        throw new AdminReleaseApiError(
            503,
            'CONVERSION_FAILED',
            'Provider-assisted conversion is not configured; use deterministic mode'
        )
    }

    const { data: source, error } = await domaniDb
        .from(DomaniTables.RELEASE_PRDS)
        .select('raw_markdown')
        .eq('id', input.prdId)
        .eq('release_id', input.releaseId)
        .maybeSingle()
    if (error) throw error
    if (!source)
        throw new AdminReleaseApiError(
            404,
            'NOT_FOUND',
            'Release source not found'
        )

    let notes
    try {
        notes = convertReleaseMarkdown(
            (source as { raw_markdown: string }).raw_markdown
        )
    } catch (conversionError) {
        if (!(conversionError instanceof ConversionContentError))
            throw conversionError
        await callConversionRpc(input, actor, requestId, null, conversionError)
        throw new AdminReleaseApiError(
            422,
            'CONVERSION_FAILED',
            conversionError.message,
            { markdown: [conversionError.message] }
        )
    }

    const result = await callConversionRpc(input, actor, requestId, notes, null)
    if (!result) throw new Error('Conversion RPC returned no result')
    return result
}
