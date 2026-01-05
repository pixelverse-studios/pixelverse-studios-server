import { db, Tables } from '../lib/db'

// Types for agenda items
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

interface GetAllOptions {
    status?: string
    category?: string
    includeCompleted?: boolean
    limit?: number
    offset?: number
}

interface GetAllResult {
    items: AgendaItem[]
    total: number
}

/**
 * Get all agenda items with filtering and pagination
 * - status: 'pending', 'in_progress', 'completed', or 'active' (pending + in_progress)
 * - category: filter by exact category match
 * - includeCompleted: if true, include completed items (overridden by status filter)
 * - limit: max items to return (default 50)
 * - offset: pagination offset (default 0)
 */
const getAll = async (options: GetAllOptions = {}): Promise<GetAllResult> => {
    const {
        status,
        category,
        includeCompleted = false,
        limit = 50,
        offset = 0
    } = options

    let query = db.from(Tables.AGENDA_ITEMS).select('*', { count: 'exact' })

    // Apply status filter
    if (status === 'active') {
        // 'active' means pending + in_progress (excludes completed)
        query = query.in('status', ['pending', 'in_progress'])
    } else if (status === 'pending' || status === 'in_progress' || status === 'completed') {
        query = query.eq('status', status)
    } else if (!includeCompleted) {
        // Default: exclude completed unless explicitly requested
        query = query.neq('status', 'completed')
    }

    // Apply category filter
    if (category) {
        query = query.eq('category', category)
    }

    // Order by priority (0 = highest priority)
    query = query.order('priority', { ascending: true })

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) throw error

    return {
        items: (data || []) as AgendaItem[],
        total: count || 0
    }
}

export default {
    getAll
}

// Export types for use in controller
export type { AgendaStatus, AgendaItem, GetAllOptions, GetAllResult }
