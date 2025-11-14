import { db, Tables } from '../lib/db'

export interface AuditRequestPayload {
    name: string
    email: string
    websiteUrl: string
    phoneNumber?: string
    specifics?: string
}

export interface AuditRequestRecord {
    id: string
    name: string
    email: string
    website_url: string
    phone_number: string | null
    specifics: string | null
    status: string
    created_at: string
    updated_at: string
}

const mapPayloadToRow = ({
    name,
    email,
    websiteUrl,
    phoneNumber,
    specifics
}: AuditRequestPayload) => ({
    name,
    email,
    website_url: websiteUrl,
    phone_number: phoneNumber ?? null,
    specifics: specifics ?? null,
    status: 'pending'
})

export const createAuditRequest = async (
    payload: AuditRequestPayload
): Promise<AuditRequestRecord> => {
    const { data, error } = await db
        .from(Tables.AUDIT_REQUESTS)
        .insert(mapPayloadToRow(payload))
        .select()
        .single()

    if (error) {
        throw error
    }

    return data as AuditRequestRecord
}

const auditRequestsService = {
    createAuditRequest
}

export default auditRequestsService
