import { COLUMNS, db, Tables, ProjectStatus } from '../lib/db'

const getWebsiteEmail = async (id: string) => {
    try {
        const { data, error } = await db
            .from(Tables.WEBSITES)
            .select(COLUMNS.CONTACT_EMAIL)
            .eq('id', id)
            .single()

        if (error) throw new Error(error.message)

        return data ?? ''
    } catch (error) {
        throw error
    }
}

const getWebsiteDetailsForEmail = async (slug: string) => {
    try {
        const {
            data: { contact_email, title, id },
            error
        } = await db
            .from(Tables.WEBSITES)
            .select()
            .eq(COLUMNS.WEBSITE_SLUG, slug)
            .single()

        if (error) throw new Error(error.message)

        return { contact_email, title, id }
    } catch (error) {
        throw error
    }
}

const updateSeoFocus = async (id: string, seo_focus: string) => {
    const { data, error } = await db
        .from(Tables.WEBSITES)
        .update({ seo_focus })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

interface WebsiteUpdatePayload {
    title?: string
    domain?: string
    website_slug?: string
    type?: string
    features?: string
    contact_email?: string
    seo_focus?: object
    status?: ProjectStatus
    priority?: number
}

interface WebsiteInsertPayload {
    title: string
    domain: string
    website_slug: string
    client_id: string
    type?: string
    features?: string
    contact_email?: string
    seo_focus?: object
    status?: ProjectStatus
    priority?: number
}

const insert = async (payload: WebsiteInsertPayload) => {
    const { data, error } = await db
        .from(Tables.WEBSITES)
        .insert([payload])
        .select()
        .single()

    if (error) throw error
    return data
}

const update = async (id: string, payload: WebsiteUpdatePayload) => {
    const { data, error } = await db
        .from(Tables.WEBSITES)
        .update(payload)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

const findByDomain = async (domain: string, excludeId?: string) => {
    let query = db.from(Tables.WEBSITES).select('id').eq('domain', domain)

    if (excludeId) {
        query = query.neq('id', excludeId)
    }

    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return data
}

const findBySlug = async (slug: string, excludeId?: string) => {
    let query = db
        .from(Tables.WEBSITES)
        .select('id')
        .eq(COLUMNS.WEBSITE_SLUG, slug)

    if (excludeId) {
        query = query.neq('id', excludeId)
    }

    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return data
}

const findById = async (id: string) => {
    const { data, error } = await db
        .from(Tables.WEBSITES)
        .select('id')
        .eq('id', id)
        .maybeSingle()

    if (error) throw error
    return data
}

const updateStatus = async (id: string, status: ProjectStatus) => {
    const { data, error } = await db
        .from(Tables.WEBSITES)
        .update({ status })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

const updatePriority = async (id: string, priority: number) => {
    const { data, error } = await db
        .from(Tables.WEBSITES)
        .update({ priority })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

const websitesDB = {
    getWebsiteEmail,
    getWebsiteDetailsForEmail,
    updateSeoFocus,
    update,
    insert,
    findByDomain,
    findBySlug,
    findById,
    updateStatus,
    updatePriority
}
export default websitesDB
