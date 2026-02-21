import { db, Tables } from '../lib/db'

export interface AuditRequestPayload {
    name: string
    email: string
    websiteUrl: string
    phoneNumber?: string
    specifics?: string
    prospectId: string
}

export interface AuditRequestRecord {
    id: string
    name: string
    email: string
    website_url: string
    phone_number: string | null
    specifics: string | null
    status: string
    prospect_id: string | null
    created_at: string
    updated_at: string
}

const mapPayloadToRow = ({
    name,
    email,
    websiteUrl,
    phoneNumber,
    specifics,
    prospectId,
}: AuditRequestPayload) => ({
    name,
    email,
    website_url: websiteUrl,
    phone_number: phoneNumber ?? null,
    specifics: specifics ?? null,
    prospect_id: prospectId,
    status: 'pending',
})

export const upsertProspect = async (
    email: string,
    name: string
): Promise<string> => {
    // Try to insert a new prospect first
    const { data: inserted, error: insertError } = await db
        .from(Tables.PROSPECTS)
        .insert({ email, name, source: 'review_request' })
        .select('id')
        .single()

    if (!insertError) return inserted.id

    // Email already exists — touch updated_at and return the existing id
    if (insertError.code === '23505') {
        const { data: existing, error: updateError } = await db
            .from(Tables.PROSPECTS)
            .update({ updated_at: new Date().toISOString() })
            .eq('email', email)
            .select('id')
            .single()

        if (updateError) throw updateError
        return existing.id
    }

    throw insertError
}

export const createAuditRequest = async (
    payload: AuditRequestPayload
): Promise<AuditRequestRecord> => {
    const { data, error } = await db
        .from(Tables.AUDIT_REQUESTS)
        .insert(mapPayloadToRow(payload))
        .select()
        .single()

    if (error) throw error

    return data as AuditRequestRecord
}

const auditRequestsService = {
    upsertProspect,
    createAuditRequest,
}

export default auditRequestsService
