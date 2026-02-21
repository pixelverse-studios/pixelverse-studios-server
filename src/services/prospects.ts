import { db, Tables } from '../lib/db'

type ProspectSource = 'details_form' | 'review_request' | 'calendly_call'

/**
 * Inserts a new prospect row, or touches updated_at if the email already
 * exists (preserving the original source). Returns the prospect id.
 */
export const upsertProspect = async (
    email: string,
    name: string,
    source: ProspectSource
): Promise<string> => {
    const { data: inserted, error: insertError } = await db
        .from(Tables.PROSPECTS)
        .insert({ email, name, source })
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

const prospectsService = { upsertProspect }

export default prospectsService
