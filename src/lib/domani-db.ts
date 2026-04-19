import { createClient, SupabaseClient } from '@supabase/supabase-js'

import 'dotenv/config'

const DOMANI_SUPABASE_URL = process.env.DOMANI_SUPABASE_URL || ''
const DOMANI_SUPABASE_SERVICE_KEY =
    process.env.DOMANI_SUPABASE_SERVICE_KEY || ''

export class DomaniConfigError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'DomaniConfigError'
    }
}

let cachedDomaniDb: SupabaseClient | null = null

export const getDomaniDb = (): SupabaseClient => {
    if (cachedDomaniDb) return cachedDomaniDb
    if (!DOMANI_SUPABASE_URL) {
        throw new DomaniConfigError('DOMANI_SUPABASE_URL is not configured')
    }
    if (!DOMANI_SUPABASE_SERVICE_KEY) {
        throw new DomaniConfigError(
            'DOMANI_SUPABASE_SERVICE_KEY is not configured'
        )
    }

    cachedDomaniDb = createClient(
        DOMANI_SUPABASE_URL,
        DOMANI_SUPABASE_SERVICE_KEY
    )

    return cachedDomaniDb
}

// Domani database tables
export const DomaniTables = {
    BETA_FEEDBACK: 'beta_feedback',
    SUPPORT_REQUESTS: 'support_requests',
    WAITLIST: 'waitlist',
    PROFILES: 'profiles',
    PROFILES_DASHBOARD: 'profiles_dashboard',
}

// Feedback categories
export const FEEDBACK_CATEGORIES = ['bug', 'feature', 'love', 'general'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

// Platform types
export const PLATFORMS = ['ios', 'android'] as const
export type Platform = (typeof PLATFORMS)[number]

// Signup cohort types
export const SIGNUP_COHORTS = [
    'friends_family',
    'early_adopter',
    'general'
] as const
export type SignupCohort = (typeof SIGNUP_COHORTS)[number]
