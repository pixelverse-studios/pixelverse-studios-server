import { db, Tables } from '../lib/db'
import { domaniDb, DomaniTables } from '../lib/domani-db'

// ============================================================================
// Type Definitions
// ============================================================================

export interface EmailCampaignRecord {
    id: string
    template_type: string
    subject: string
    html_content: string
    recipient_count: number
    successful: number
    failed: number
    recipients: unknown
    sent_by: string
    created_at: string
}

export interface EmailCampaignSummary {
    id: string
    template_type: string
    subject: string
    recipient_count: number
    successful: number
    failed: number
    sent_by: string
    created_at: string
}

interface CreateCampaignPayload {
    templateType: string
    subject: string
    htmlContent: string
    recipientCount: number
    successful: number
    failed: number
    recipients: unknown[]
    sentBy: string
}

export interface ResolvedRecipient {
    id: string
    email: string
    full_name: string | null
}

// ============================================================================
// Campaign CRUD
// ============================================================================

const createCampaign = async (
    payload: CreateCampaignPayload
): Promise<EmailCampaignRecord> => {
    const { data, error } = await db
        .from(Tables.EMAIL_CAMPAIGNS)
        .insert([
            {
                template_type: payload.templateType,
                subject: payload.subject,
                html_content: payload.htmlContent,
                recipient_count: payload.recipientCount,
                successful: payload.successful,
                failed: payload.failed,
                recipients: payload.recipients,
                sent_by: payload.sentBy,
            },
        ])
        .select()
        .single()

    if (error) throw error
    return data as EmailCampaignRecord
}

const listCampaigns = async (
    limit: number = 20,
    offset: number = 0
): Promise<{ campaigns: EmailCampaignSummary[]; total: number }> => {
    const { count, error: countError } = await db
        .from(Tables.EMAIL_CAMPAIGNS)
        .select('*', { count: 'exact', head: true })

    if (countError) throw countError

    const { data, error } = await db
        .from(Tables.EMAIL_CAMPAIGNS)
        .select(
            'id, template_type, subject, recipient_count, successful, failed, sent_by, created_at'
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (error) throw error

    return {
        campaigns: (data || []) as EmailCampaignSummary[],
        total: count ?? 0,
    }
}

// ============================================================================
// Recipient Resolution (Domani DB)
// ============================================================================

const resolveRecipientIds = async (
    ids: string[]
): Promise<{ recipients: ResolvedRecipient[]; missing: string[] }> => {
    const { data, error } = await domaniDb
        .from(DomaniTables.PROFILES)
        .select('id, email, full_name')
        .in('id', ids)
        .is('deleted_at', null)

    if (error) throw error

    const found = (data || []) as ResolvedRecipient[]
    const foundIds = new Set(found.map(r => r.id))
    const missing = ids.filter(id => !foundIds.has(id))

    return { recipients: found, missing }
}

export default { createCampaign, listCampaigns, resolveRecipientIds }
