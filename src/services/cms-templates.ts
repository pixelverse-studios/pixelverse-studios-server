import { db, Tables, COLUMNS } from '../lib/db'

export type FieldType =
    | 'text'
    | 'richtext'
    | 'image'
    | 'number'
    | 'boolean'
    | 'select'
    | 'array'
    | 'json'
    | 'image_gallery'

export interface FieldDefinition {
    key: string
    label: string
    type: FieldType
    required?: boolean
    default?: unknown
    description?: string
    max_length?: number
    min?: number
    max?: number
    options?: string[]
    config?: Record<string, unknown>
}

export interface CmsTemplateRow {
    id: string
    client_id: string
    slug: string
    label: string
    description: string | null
    fields: FieldDefinition[]
    version: number
    active: boolean
    created_by: string | null
    created_at: string
    updated_at: string
}

export interface CmsTemplateInsertPayload {
    client_id: string
    slug: string
    label: string
    description?: string | null
    fields: FieldDefinition[]
    active?: boolean
    created_by?: string | null
}

export interface CmsTemplateUpdatePayload {
    slug?: string
    label?: string
    description?: string | null
    fields?: FieldDefinition[]
    active?: boolean
}

const findByClientId = async (clientId: string): Promise<CmsTemplateRow[]> => {
    const { data, error } = await db
        .from(Tables.CMS_TEMPLATES)
        .select('*')
        .eq(COLUMNS.CLIENT_ID, clientId)
        .eq('active', true)
        .order('created_at', { ascending: false })

    if (error) throw error
    return (data || []) as CmsTemplateRow[]
}

const findById = async (id: string): Promise<CmsTemplateRow | null> => {
    const { data, error } = await db
        .from(Tables.CMS_TEMPLATES)
        .select('*')
        .eq('id', id)
        .maybeSingle()

    if (error) throw error
    return (data as CmsTemplateRow) || null
}

const findByClientAndSlug = async (
    clientId: string,
    slug: string
): Promise<CmsTemplateRow | null> => {
    const { data, error } = await db
        .from(Tables.CMS_TEMPLATES)
        .select('*')
        .eq(COLUMNS.CLIENT_ID, clientId)
        .eq(COLUMNS.CMS_SLUG, slug)
        .maybeSingle()

    if (error) throw error
    return (data as CmsTemplateRow) || null
}

const insert = async (
    payload: CmsTemplateInsertPayload
): Promise<CmsTemplateRow> => {
    const row = {
        client_id: payload.client_id,
        slug: payload.slug,
        label: payload.label,
        description: payload.description ?? null,
        fields: payload.fields,
        active: payload.active ?? true,
        created_by: payload.created_by ?? null,
    }

    const { data, error } = await db
        .from(Tables.CMS_TEMPLATES)
        .insert([row])
        .select('*')
        .single()

    if (error) throw error
    return data as CmsTemplateRow
}

const update = async (
    id: string,
    payload: CmsTemplateUpdatePayload
): Promise<CmsTemplateRow> => {
    const existing = await findById(id)
    if (!existing) {
        throw { status: 404, message: 'Template not found' }
    }

    const patch: Record<string, unknown> = {}
    if (payload.slug !== undefined) patch.slug = payload.slug
    if (payload.label !== undefined) patch.label = payload.label
    if (payload.description !== undefined) patch.description = payload.description
    if (payload.active !== undefined) patch.active = payload.active
    if (payload.fields !== undefined) {
        patch.fields = payload.fields
        patch.version = (existing.version || 1) + 1
    }

    const { data, error } = await db
        .from(Tables.CMS_TEMPLATES)
        .update(patch)
        .eq('id', id)
        .select('*')
        .single()

    if (error) throw error
    return data as CmsTemplateRow
}

const remove = async (id: string): Promise<void> => {
    const { error } = await db
        .from(Tables.CMS_TEMPLATES)
        .delete()
        .eq('id', id)

    if (error) {
        // FK ON DELETE RESTRICT violation — pages reference this template
        if (error.code === '23503') {
            throw {
                status: 409,
                message: 'Cannot delete: pages reference this template',
            }
        }
        throw error
    }
}

export default {
    findByClientId,
    findById,
    findByClientAndSlug,
    insert,
    update,
    remove,
}
