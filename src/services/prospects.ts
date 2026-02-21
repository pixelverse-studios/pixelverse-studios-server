import { db, Tables } from '../lib/db'

export type ProspectSource = 'details_form' | 'review_request' | 'calendly_call'
export type ProspectStatus = 'new' | 'contacted' | 'qualified' | 'closed'

// ─── Upsert ───────────────────────────────────────────────────────────────────

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
        if (!existing) throw new Error('Prospect disappeared during upsert')
        return existing.id
    }

    throw insertError
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface ListProspectsOptions {
    source?: ProspectSource
    status?: ProspectStatus
    limit: number
    offset: number
}

export const listProspects = async ({
    source,
    status,
    limit,
    offset,
}: ListProspectsOptions) => {
    let query = db
        .from(Tables.V_PROSPECTS_ALL)
        .select('*', { count: 'exact' })

    if (source) query = query.eq('source', source)
    if (status) query = query.eq('status', status)

    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) throw error
    return { prospects: data ?? [], total: count ?? 0 }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export const getProspectStats = async () => {
    const countWhere = (col: string, val: string) =>
        db
            .from(Tables.PROSPECTS)
            .select('*', { count: 'exact', head: true })
            .eq(col, val)
            .then(({ count, error }) => {
                if (error) throw error
                return count ?? 0
            })

    const [total, bySource, byStatus] = await Promise.all([
        db
            .from(Tables.PROSPECTS)
            .select('*', { count: 'exact', head: true })
            .then(({ count, error }) => {
                if (error) throw error
                return count ?? 0
            }),
        Promise.all([
            countWhere('source', 'details_form').then((n) => ({ details_form: n })),
            countWhere('source', 'review_request').then((n) => ({ review_request: n })),
            countWhere('source', 'calendly_call').then((n) => ({ calendly_call: n })),
        ]),
        Promise.all([
            countWhere('status', 'new').then((n) => ({ new: n })),
            countWhere('status', 'contacted').then((n) => ({ contacted: n })),
            countWhere('status', 'qualified').then((n) => ({ qualified: n })),
            countWhere('status', 'closed').then((n) => ({ closed: n })),
        ]),
    ])

    return {
        total,
        by_source: Object.assign({}, ...bySource) as Record<ProspectSource, number>,
        by_status: Object.assign({}, ...byStatus) as Record<ProspectStatus, number>,
    }
}

// ─── Detail ───────────────────────────────────────────────────────────────────

export const getProspectById = async (id: string) => {
    const { data: prospect, error: prospectError } = await db
        .from(Tables.V_PROSPECTS_ALL)
        .select('*')
        .eq('id', id)
        .maybeSingle()

    if (prospectError) throw prospectError
    if (!prospect) return null

    const [
        { data: leadSubmissions, error: lsError },
        { data: auditRequests, error: arError },
        { data: calendlyBookings, error: cbError },
    ] = await Promise.all([
        db
            .from(Tables.LEAD_SUBMISSIONS)
            .select('*')
            .eq('prospect_id', id)
            .order('created_at', { ascending: false }),
        db
            .from(Tables.AUDIT_REQUESTS)
            .select('*')
            .eq('prospect_id', id)
            .order('created_at', { ascending: false }),
        db
            .from(Tables.CALENDLY_BOOKINGS)
            .select('*')
            .eq('prospect_id', id)
            .order('created_at', { ascending: false }),
    ])

    if (lsError) throw lsError
    if (arError) throw arError
    if (cbError) throw cbError

    return {
        ...prospect,
        lead_submissions: leadSubmissions ?? [],
        audit_requests: auditRequests ?? [],
        calendly_bookings: calendlyBookings ?? [],
    }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export interface UpdateProspectPayload {
    status?: ProspectStatus
    notes?: string | null
}

export const updateProspect = async (
    id: string,
    patch: UpdateProspectPayload
) => {
    const { data, error } = await db
        .from(Tables.PROSPECTS)
        .update(patch)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}
