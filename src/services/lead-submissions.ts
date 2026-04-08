import { db, Tables } from '../lib/db'

export interface LeadSubmissionPayload {
    prospectId: string
    companyName: string
    phone?: string
    budget: string
    timeline: string
    currentWebsite?: string
    improvements: string[]
    interestedIn?: string[]
    briefSummary?: string
    promoCode?: string
}

export interface LeadSubmissionRecord {
    id: string
    prospect_id: string
    company_name: string
    phone: string | null
    budget: string
    timeline: string
    current_website: string | null
    improvements: string[]
    interested_in: string[] | null
    brief_summary: string | null
    promo_code: string | null
    created_at: string
}

export const createLeadSubmission = async (
    payload: LeadSubmissionPayload
): Promise<LeadSubmissionRecord> => {
    const { data, error } = await db
        .from(Tables.LEAD_SUBMISSIONS)
        .insert({
            prospect_id: payload.prospectId,
            company_name: payload.companyName,
            phone: payload.phone || null,
            budget: payload.budget,
            timeline: payload.timeline,
            current_website: payload.currentWebsite || null,
            improvements: payload.improvements,
            interested_in: payload.interestedIn ?? null,
            brief_summary: payload.briefSummary || null,
            promo_code: payload.promoCode || null,
        })
        .select()
        .single()

    if (error) throw error

    return data as LeadSubmissionRecord
}

const leadSubmissionsService = { createLeadSubmission }

export default leadSubmissionsService
