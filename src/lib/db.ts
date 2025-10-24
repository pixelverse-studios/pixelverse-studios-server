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
    LEADS: 'leads'
}

export const COLUMNS = {
    CLIENT_ID: 'client_id',
    CONTACT_EMAIL: 'contact_email',
    SLUG: 'client_slug',
    WEBSITE_SLUG: 'website_slug'
}
