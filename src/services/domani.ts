import {
    domaniDb,
    DomaniTables,
    FeedbackCategory,
    Platform,
    UserTier,
    SignupCohort
} from '../lib/domani-db'

// ============================================================================
// Type Definitions
// ============================================================================

export interface BetaFeedback {
    id: string
    user_id: string
    email: string
    category: FeedbackCategory
    message: string
    status: string
    platform: Platform
    app_version: string
    app_build: string
    device_brand: string
    device_model: string
    os_version: string
    created_at: string
    updated_at: string
}

export interface SupportRequest {
    id: string
    user_id: string
    email: string
    category: string
    description: string
    status: string
    platform: Platform
    app_version: string
    device_brand: string
    device_model: string
    os_version: string
    created_at: string
    updated_at: string
}

export interface WaitlistEntry {
    id: string
    email: string
    name: string | null
    status: string
    confirmed: boolean
    confirmed_at: string | null
    invited_at: string | null
    referral_type: string
    metadata: Record<string, unknown>
    created_at: string
}

export interface UserProfile {
    id: string
    email: string
    full_name: string | null
    tier: UserTier
    signup_cohort: SignupCohort
    signup_method: string
    timezone: string
    created_at: string
    deleted_at: string | null
}

// Query options
export interface PaginationOptions {
    limit?: number
    offset?: number
}

export interface FeedbackQueryOptions extends PaginationOptions {
    category?: FeedbackCategory
    status?: string
    platform?: Platform
}

export interface SupportQueryOptions extends PaginationOptions {
    category?: string
    status?: string
    platform?: Platform
}

export interface WaitlistQueryOptions extends PaginationOptions {}

export interface UsersQueryOptions extends PaginationOptions {
    tier?: UserTier
    cohort?: SignupCohort
    includeDeleted?: boolean
}

// Result types
export interface PaginatedResult<T> {
    items: T[]
    total: number
}

// ============================================================================
// Beta Feedback Service
// ============================================================================

const getFeedback = async (
    options: FeedbackQueryOptions = {}
): Promise<PaginatedResult<BetaFeedback>> => {
    const { limit = 50, offset = 0, category, status, platform } = options

    // Get total count
    let countQuery = domaniDb
        .from(DomaniTables.BETA_FEEDBACK)
        .select('*', { count: 'exact', head: true })

    if (category) countQuery = countQuery.eq('category', category)
    if (status) countQuery = countQuery.eq('status', status)
    if (platform) countQuery = countQuery.eq('platform', platform)

    const { count, error: countError } = await countQuery

    if (countError) throw countError

    // Get paginated data
    let dataQuery = domaniDb
        .from(DomaniTables.BETA_FEEDBACK)
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (category) dataQuery = dataQuery.eq('category', category)
    if (status) dataQuery = dataQuery.eq('status', status)
    if (platform) dataQuery = dataQuery.eq('platform', platform)

    const { data, error } = await dataQuery

    if (error) throw error

    return {
        items: (data || []) as BetaFeedback[],
        total: count ?? 0
    }
}

// ============================================================================
// Support Requests Service
// ============================================================================

const getSupportRequests = async (
    options: SupportQueryOptions = {}
): Promise<PaginatedResult<SupportRequest>> => {
    const { limit = 50, offset = 0, category, status, platform } = options

    // Get total count
    let countQuery = domaniDb
        .from(DomaniTables.SUPPORT_REQUESTS)
        .select('*', { count: 'exact', head: true })

    if (category) countQuery = countQuery.eq('category', category)
    if (status) countQuery = countQuery.eq('status', status)
    if (platform) countQuery = countQuery.eq('platform', platform)

    const { count, error: countError } = await countQuery

    if (countError) throw countError

    // Get paginated data
    let dataQuery = domaniDb
        .from(DomaniTables.SUPPORT_REQUESTS)
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (category) dataQuery = dataQuery.eq('category', category)
    if (status) dataQuery = dataQuery.eq('status', status)
    if (platform) dataQuery = dataQuery.eq('platform', platform)

    const { data, error } = await dataQuery

    if (error) throw error

    return {
        items: (data || []) as SupportRequest[],
        total: count ?? 0
    }
}

// ============================================================================
// Waitlist Service
// ============================================================================

const getWaitlist = async (
    options: WaitlistQueryOptions = {}
): Promise<PaginatedResult<WaitlistEntry>> => {
    const { limit = 50, offset = 0 } = options

    // Get total count
    const { count, error: countError } = await domaniDb
        .from(DomaniTables.WAITLIST)
        .select('*', { count: 'exact', head: true })

    if (countError) throw countError

    // Get paginated data
    const { data, error } = await domaniDb
        .from(DomaniTables.WAITLIST)
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (error) throw error

    return {
        items: (data || []) as WaitlistEntry[],
        total: count ?? 0
    }
}

const unsubscribeFromWaitlist = async (
    email: string
): Promise<WaitlistEntry | null> => {
    const { data, error } = await domaniDb
        .from(DomaniTables.WAITLIST)
        .update({ status: 'unsubscribed' })
        .eq('email', email.toLowerCase())
        .select()
        .single()

    if (error) {
        // PGRST116 = no rows found
        if (error.code === 'PGRST116') return null
        throw error
    }

    return data as WaitlistEntry
}

const unsubscribeUser = async (email: string): Promise<UserProfile | null> => {
    const { data, error } = await domaniDb
        .from(DomaniTables.PROFILES)
        .update({ deleted_at: new Date().toISOString() })
        .eq('email', email.toLowerCase())
        .is('deleted_at', null)
        .select()
        .single()

    if (error) {
        // PGRST116 = no rows found
        if (error.code === 'PGRST116') return null
        throw error
    }

    return data as UserProfile
}

// ============================================================================
// User Profiles Service
// ============================================================================

const getUsers = async (
    options: UsersQueryOptions = {}
): Promise<PaginatedResult<UserProfile>> => {
    const {
        limit = 50,
        offset = 0,
        tier,
        cohort,
        includeDeleted = false
    } = options

    // Get total count
    let countQuery = domaniDb
        .from(DomaniTables.PROFILES)
        .select('*', { count: 'exact', head: true })

    if (tier) countQuery = countQuery.eq('tier', tier)
    if (cohort) countQuery = countQuery.eq('signup_cohort', cohort)
    if (!includeDeleted) countQuery = countQuery.is('deleted_at', null)

    const { count, error: countError } = await countQuery

    if (countError) throw countError

    // Get paginated data
    let dataQuery = domaniDb
        .from(DomaniTables.PROFILES)
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (tier) dataQuery = dataQuery.eq('tier', tier)
    if (cohort) dataQuery = dataQuery.eq('signup_cohort', cohort)
    if (!includeDeleted) dataQuery = dataQuery.is('deleted_at', null)

    const { data, error } = await dataQuery

    if (error) throw error

    return {
        items: (data || []) as UserProfile[],
        total: count ?? 0
    }
}

export default {
    getFeedback,
    getSupportRequests,
    getWaitlist,
    unsubscribeFromWaitlist,
    unsubscribeUser,
    getUsers
}
