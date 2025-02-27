import { createClient } from '@supabase/supabase-js'

import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_KEY || ''

// Initialize the Supabase client
export const db = createClient(SUPABASE_URL, SUPABASE_KEY)

export const Tables = {
    CLIENTS: 'clients',
    CMS: 'cms',
    NEWSLETTER: 'newsletter',
    CONTACT_FORMS: 'contact_form_submissions',
    WEBSITES: 'websites'
}

export const COLUMNS = {
    SLUG: 'client_slug',
    CLIENT_ID: 'client_id'
}
