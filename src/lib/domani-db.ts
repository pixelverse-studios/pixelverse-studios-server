import { createClient } from '@supabase/supabase-js'

import 'dotenv/config'

const DOMANI_SUPABASE_URL = process.env.DOMANI_SUPABASE_URL || ''
const DOMANI_SUPABASE_SERVICE_KEY =
    process.env.DOMANI_SUPABASE_SERVICE_KEY || ''

// Initialize the Domani Supabase client
export const domaniDb = createClient(
    DOMANI_SUPABASE_URL,
    DOMANI_SUPABASE_SERVICE_KEY
)

// Domani database tables
export const DomaniTables = {
    BETA_FEEDBACK: 'beta_feedback',
    SUPPORT_REQUESTS: 'support_requests',
    WAITLIST: 'waitlist',
    PROFILES: 'profiles'
}

// Feedback categories
export const FEEDBACK_CATEGORIES = ['bug', 'feature', 'love', 'general'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

// Platform types
export const PLATFORMS = ['ios', 'android'] as const
export type Platform = (typeof PLATFORMS)[number]

// User tier types
export const USER_TIERS = ['free', 'premium', 'lifetime'] as const
export type UserTier = (typeof USER_TIERS)[number]

// Signup cohort types
export const SIGNUP_COHORTS = [
    'friends_family',
    'early_adopter',
    'general'
] as const
export type SignupCohort = (typeof SIGNUP_COHORTS)[number]
