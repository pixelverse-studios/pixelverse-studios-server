import { db, Tables, ProjectStatus } from '../lib/db'

interface AppInsertPayload {
    name: string
    app_slug: string
    client_id: string
    description?: string
    repository_url?: string
    tech_stack?: object
    contact_email?: string
    status?: ProjectStatus
    priority?: number
}

interface AppUpdatePayload {
    name?: string
    app_slug?: string
    description?: string
    repository_url?: string
    tech_stack?: object
    contact_email?: string
    active?: boolean
    status?: ProjectStatus
    priority?: number
}

const findById = async (id: string) => {
    const { data, error } = await db
        .from(Tables.APPS)
        .select('id')
        .eq('id', id)
        .maybeSingle()

    if (error) throw error
    return data
}

const findBySlug = async (slug: string, excludeId?: string) => {
    let query = db.from(Tables.APPS).select('id').eq('app_slug', slug)

    if (excludeId) {
        query = query.neq('id', excludeId)
    }

    const { data, error } = await query.maybeSingle()
    if (error) throw error
    return data
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

const updateStatus = async (id: string, status: ProjectStatus) => {
    const { data, error } = await db
        .from(Tables.APPS)
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

const updatePriority = async (id: string, priority: number) => {
    const { data, error } = await db
        .from(Tables.APPS)
        .update({ priority, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

const appsDB = {
    findById,
    findBySlug,
    insert,
    update,
    updateStatus,
    updatePriority
}

export default appsDB
