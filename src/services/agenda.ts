import { db, Tables } from '../lib/db'

type AgendaStatus = 'pending' | 'in_progress' | 'completed'

interface AgendaItem {
    id: string
    name: string
    description: string | null
    status: AgendaStatus
    priority: number
    category: string | null
    due_date: string | null
    created_at: string
    updated_at: string
    completed_at: string | null
}

interface AgendaInsertPayload {
    name: string
    description?: string
    category?: string
    due_date?: string
    priority?: number
}

interface AgendaUpdatePayload {
    name?: string
    description?: string
    category?: string
    due_date?: string | null
}

interface GetAllOptions {
    status?: string
    category?: string
    includeCompleted?: boolean
    limit?: number
    offset?: number
}

const getAll = async (options: GetAllOptions = {}): Promise<{
    items: AgendaItem[]
    total: number
}> => {
    const {
        status,
        category,
        includeCompleted = false,
        limit = 50,
        offset = 0
    } = options

    let query = db
        .from(Tables.AGENDA_ITEMS)
        .select('*', { count: 'exact' })

    // Filter by status
    if (status === 'active') {
        // Active = not completed
        query = query.neq('status', 'completed')
    } else if (status && ['pending', 'in_progress', 'completed'].includes(status)) {
        query = query.eq('status', status)
    } else if (!includeCompleted) {
        // Default: exclude completed items
        query = query.neq('status', 'completed')
    }

    // Filter by category
    if (category) {
        query = query.eq('category', category)
    }

    const { data, error, count } = await query
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (error) throw error
    return { items: data || [], total: count || 0 }
}

const getById = async (id: string): Promise<AgendaItem | null> => {
    const { data, error } = await db
        .from(Tables.AGENDA_ITEMS)
        .select('*')
        .eq('id', id)
        .single()

    if (error) {
        if (error.code === 'PGRST116') return null
        throw error
    }
    return data
}

const insert = async (payload: AgendaInsertPayload): Promise<AgendaItem> => {
    const insertPayload: Record<string, unknown> = {
        name: payload.name,
        status: 'pending'
    }

    if (payload.description !== undefined)
        insertPayload.description = payload.description
    if (payload.category !== undefined) insertPayload.category = payload.category
    if (payload.due_date !== undefined) insertPayload.due_date = payload.due_date
    if (payload.priority !== undefined) insertPayload.priority = payload.priority

    const { data, error } = await db
        .from(Tables.AGENDA_ITEMS)
        .insert([insertPayload])
        .select()
        .single()

    if (error) throw error
    return data
}

const update = async (
    id: string,
    payload: AgendaUpdatePayload
): Promise<AgendaItem> => {
    const { data, error } = await db
        .from(Tables.AGENDA_ITEMS)
        .update(payload)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

const updateStatus = async (
    id: string,
    status: AgendaStatus
): Promise<AgendaItem> => {
    const updatePayload: Record<string, unknown> = { status }

    // Set completed_at when marking as completed
    if (status === 'completed') {
        updatePayload.completed_at = new Date().toISOString()
    } else {
        // Clear completed_at if reopening
        updatePayload.completed_at = null
    }

    const { data, error } = await db
        .from(Tables.AGENDA_ITEMS)
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

const updatePriority = async (
    id: string,
    priority: number
): Promise<AgendaItem> => {
    const { data, error } = await db
        .from(Tables.AGENDA_ITEMS)
        .update({ priority })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

const reorder = async (
    itemIds: string[]
): Promise<{ updated: number; items: AgendaItem[] }> => {
    const updates: AgendaItem[] = []

    // Update priority based on array index
    for (let i = 0; i < itemIds.length; i++) {
        const { data, error } = await db
            .from(Tables.AGENDA_ITEMS)
            .update({ priority: i })
            .eq('id', itemIds[i])
            .select()
            .single()

        if (error) throw error
        if (data) updates.push(data)
    }

    return { updated: updates.length, items: updates }
}

const remove = async (id: string): Promise<void> => {
    const { error } = await db.from(Tables.AGENDA_ITEMS).delete().eq('id', id)

    if (error) throw error
}

const agendaDB = {
    getAll,
    getById,
    insert,
    update,
    updateStatus,
    updatePriority,
    reorder,
    remove
}

export default agendaDB
export type { AgendaItem, AgendaStatus, AgendaInsertPayload, AgendaUpdatePayload }
