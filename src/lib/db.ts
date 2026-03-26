import { createClient } from '@supabase/supabase-js'

import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''

// Initialize the Supabase client
export const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

export const Tables = {
    CLIENTS: 'clients',
    CMS: 'cms',
    NEWSLETTER: 'newsletter',
    CONTACT_FORMS: 'contact_form_submissions',
    WEBSITES: 'websites',
    APPS: 'apps',
    LEADS: 'leads',
    AUDIT_REQUESTS: 'audit_requests',
    PROSPECTS: 'prospects',
    LEAD_SUBMISSIONS: 'lead_submissions',
    CALENDLY_BOOKINGS: 'calendly_bookings',
    DEPLOYMENTS: 'website_deployments',
    CLIENT_WEBSITE_SUMMARY: 'client_website_summary',
    AGENDA_ITEMS: 'agenda_items',
    V_PROSPECTS_ALL: 'v_prospects_all',
    EMAIL_CAMPAIGNS: 'email_campaigns',
    SEO_AUDITS: 'seo_audits',
    SEO_KEYWORDS: 'seo_keywords',
    SEO_COMPETITORS: 'seo_competitors',
}

// Valid project status values for websites and apps
export const PROJECT_STATUSES = [
    'lead',
    'discovery',
    'proposal',
    'negotiation',
    'won',
    'lost',
    'planning',
    'development',
    'review',
    'qa',
    'staging',
    'deployed',
    'maintenance',
    'on_hold',
    'archived'
] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const COLUMNS = {
    CLIENT_ID: 'client_id',
    CONTACT_EMAIL: 'contact_email',
    WEBSITE_SLUG: 'website_slug',
    CALENDLY_EVENT_URI: 'calendly_event_uri',
    PROSPECT_SOURCE: 'source',
    PROSPECT_STATUS: 'status',
}
