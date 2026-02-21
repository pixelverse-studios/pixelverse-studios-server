import { db, Tables, COLUMNS } from '../lib/db'

// Single source of truth for valid enum values — types are derived from these arrays.
export const PROSPECT_SOURCES = ['details_form', 'review_request', 'calendly_call'] as const
export const PROSPECT_STATUSES = ['new', 'contacted', 'qualified', 'closed'] as const

export type ProspectSource = (typeof PROSPECT_SOURCES)[number]
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number]

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

    if (source) query = query.eq(COLUMNS.PROSPECT_SOURCE, source)
    if (status) query = query.eq(COLUMNS.PROSPECT_STATUS, status)

    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) throw error

    if (count === null) {
        console.warn('listProspects: count was null — total may be inaccurate')
    }

    return { prospects: data ?? [], total: count ?? 0 }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export const getProspectStats = async () => {
    const count = async (col: string, val: string): Promise<number> => {
        const { count: n, error } = await db
            .from(Tables.PROSPECTS)
            .select('id', { count: 'exact', head: true })
            .eq(col, val)
        if (error) throw error
        if (n === null) console.warn(`getProspectStats: count was null for ${col}=${val}`)
        return n ?? 0
    }

    const getTotal = async (): Promise<number> => {
        const { count: n, error } = await db
            .from(Tables.PROSPECTS)
            .select('id', { count: 'exact', head: true })
        if (error) throw error
        if (n === null) console.warn('getProspectStats: total count was null')
        return n ?? 0
    }

    const [total, details_form, review_request, calendly_call, statusNew, contacted, qualified, closed] =
        await Promise.all([
            getTotal(),
            count(COLUMNS.PROSPECT_SOURCE, 'details_form'),
            count(COLUMNS.PROSPECT_SOURCE, 'review_request'),
            count(COLUMNS.PROSPECT_SOURCE, 'calendly_call'),
            count(COLUMNS.PROSPECT_STATUS, 'new'),
            count(COLUMNS.PROSPECT_STATUS, 'contacted'),
            count(COLUMNS.PROSPECT_STATUS, 'qualified'),
            count(COLUMNS.PROSPECT_STATUS, 'closed'),
        ])

    return {
        total,
        by_source: {
            details_form,
            review_request,
            calendly_call,
        } satisfies Record<ProspectSource, number>,
        by_status: {
            new: statusNew,
            contacted,
            qualified,
            closed,
        } satisfies Record<ProspectStatus, number>,
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
    notes?: string | null // null clears notes (column is nullable)
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
        .maybeSingle()

    if (error) throw error
    if (!data) throw { status: 404, message: 'Prospect not found' }
    return data
}
