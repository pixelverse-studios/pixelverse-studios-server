import { db, Tables } from '../lib/db'

export type MediaAuditAction =
    | 'upload_created'
    | 'draft_saved'
    | 'published'
    | 'archived'
    | 'restored'
    | 'renamed_moved'
    | 'metadata_edited'
    | 'reorder_changed'
    | 'placement_assigned'
    | 'placement_replaced'
    | 'placement_cleared'

export interface MediaAuditLogInput {
    websiteId: string
    clientId: string
    mediaId?: number | null
    mediaKey?: string | null
    action: MediaAuditAction
    actor?: string | null
    oldValues?: Record<string, unknown> | null
    newValues?: Record<string, unknown> | null
}

const createLog = async ({
    websiteId,
    clientId,
    mediaId,
    mediaKey,
    action,
    actor,
    oldValues,
    newValues,
}: MediaAuditLogInput): Promise<void> => {
    const { error } = await db.from(Tables.MEDIA_AUDIT_LOGS).insert({
        website_id: websiteId,
        client_id: clientId,
        media_id: mediaId ?? null,
        media_key: mediaKey ?? null,
        action,
        actor: actor ?? null,
        old_values: oldValues ?? null,
        new_values: newValues ?? null,
    })

    if (error) throw error
}

const tryCreateLog = async (input: MediaAuditLogInput): Promise<void> => {
    try {
        await createLog(input)
    } catch (err) {
        console.error(
            `Failed to write media audit log for ${input.action}: ${input.mediaKey || input.mediaId || 'unknown media'}`,
            err
        )
    }
}

export default {
    createLog,
    tryCreateLog,
}
