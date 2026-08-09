import { db, Tables } from '../lib/db'

export type MiniSessionCampaignAuditAction =
    | 'created'
    | 'draft_saved'
    | 'duplicated'
    | 'published'
    | 'marked_sold_out'
    | 'closed'
    | 'archived'
    | 'booking_options_changed'

export interface MiniSessionCampaignAuditInput {
    campaignId?: string | null
    websiteId: string
    clientId: string
    action: MiniSessionCampaignAuditAction
    actor?: string | null
    oldValues?: Record<string, unknown> | null
    newValues?: Record<string, unknown> | null
}

const createLog = async ({
    campaignId,
    websiteId,
    clientId,
    action,
    actor,
    oldValues,
    newValues,
}: MiniSessionCampaignAuditInput): Promise<void> => {
    const { error } = await db
        .from(Tables.MINI_SESSION_CAMPAIGN_AUDIT_LOGS)
        .insert({
            campaign_id: campaignId ?? null,
            website_id: websiteId,
            client_id: clientId,
            action,
            actor: actor ?? null,
            old_values: oldValues ?? null,
            new_values: newValues ?? null,
        })

    if (error) throw error
}

const tryCreateLog = async (
    input: MiniSessionCampaignAuditInput
): Promise<void> => {
    try {
        await createLog(input)
    } catch (error) {
        console.error(
            `Failed to write Mini Sessions audit log for ${input.action}: ${input.campaignId || 'unknown campaign'}`,
            error
        )
    }
}

export default {
    createLog,
    tryCreateLog,
}
