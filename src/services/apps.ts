import { COLUMNS, db, Tables } from '../lib/db'

interface AppInsertPayload {
    name: string
    app_slug: string
    client_id: string
    description?: string
    repository_url?: string
    tech_stack?: string[]
    contact_email?: string
    active?: boolean
}

interface AppUpdatePayload {
    name?: string
    app_slug?: string
    description?: string
    repository_url?: string
    tech_stack?: string[]
    contact_email?: string
    active?: boolean
}

const getById = async (id: string) => {
    const { data, error } = await db
        .from(Tables.APPS)
        .select('*')
        .eq('id', id)
        .single()

    if (error) {
        if (error.code === 'PGRST116') return null
        throw error
    }
    return data
}

const getByClientId = async (clientId: string) => {
    const { data, error } = await db
        .from(Tables.APPS)
        .select('*')
        .eq(COLUMNS.CLIENT_ID, clientId)
        .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
}

const getAll = async () => {
    const { data, error } = await db
        .from(Tables.APPS)
        .select(
            `
            *,
            clients (
                id,
                firstname,
                lastname
            )
        `
        )
        .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
}

const insert = async (payload: AppInsertPayload) => {
    const { data, error } = await db
        .from(Tables.APPS)
        .insert([payload])
        .select()
        .single()

    if (error) throw error
    return data
}

const update = async (id: string, payload: AppUpdatePayload) => {
    const updatePayload = {
        ...payload,
        updated_at: new Date().toISOString()
    }

    const { data, error } = await db
        .from(Tables.APPS)
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

const findBySlug = async (slug: string, excludeId?: string) => {
    let query = db.from(Tables.APPS).select('id').eq(COLUMNS.APP_SLUG, slug)

    if (excludeId) {
        query = query.neq('id', excludeId)
    }

    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return data
}

const remove = async (id: string) => {
    const { error } = await db.from(Tables.APPS).delete().eq('id', id)

    if (error) throw error
}

const getAppDetailsForEmail = async (slug: string) => {
    const { data, error } = await db
        .from(Tables.APPS)
        .select('contact_email, name, id')
        .eq(COLUMNS.APP_SLUG, slug)
        .single()

    if (error) throw error
    return data
}

const appsDB = {
    getById,
    getByClientId,
    getAll,
    insert,
    update,
    findBySlug,
    remove,
    getAppDetailsForEmail
}

export default appsDB
