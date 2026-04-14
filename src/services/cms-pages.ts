import { db, Tables, COLUMNS } from '../lib/db'
import { CmsTemplateRow } from './cms-templates'

export type CmsPublishStatus = 'draft' | 'published' | 'archived'

export const VALID_PUBLISH_STATUSES: CmsPublishStatus[] = [
    'draft',
    'published',
    'archived',
]

export interface CmsPageRow {
    id: string
    client_id: string
    template_id: string
    slug: string
    content: Record<string, unknown>
    status: CmsPublishStatus
    template_version: number
    published_at: string | null
    published_by: string | null
    last_edited_by: string | null
    created_at: string
    updated_at: string
}

export interface CmsPageWithTemplate extends CmsPageRow {
    template: CmsTemplateRow
}

export interface CmsPageInsertPayload {
    client_id: string
    template_id: string
    slug: string
    content: Record<string, unknown>
    status?: CmsPublishStatus
    template_version: number
    last_edited_by?: string | null
}

export interface CmsPageUpdatePayload {
    slug?: string
    content?: Record<string, unknown>
    status?: CmsPublishStatus
    last_edited_by?: string | null
    template_version?: number
}

const findByClientId = async (
    clientId: string,
    options: {
        status?: CmsPublishStatus
        limit?: number
        offset?: number
    } = {}
): Promise<CmsPageRow[]> => {
    const { status, limit = 50, offset = 0 } = options
    let query = db
        .from(Tables.CMS_PAGES)
        .select('*')
        .eq(COLUMNS.CLIENT_ID, clientId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (status) {
        query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) throw error
    return (data || []) as CmsPageRow[]
}

const findById = async (id: string): Promise<CmsPageRow | null> => {
    const { data, error } = await db
        .from(Tables.CMS_PAGES)
        .select('*')
        .eq('id', id)
        .maybeSingle()

    if (error) throw error
    return (data as CmsPageRow) || null
}

const findByIdWithTemplate = async (
    id: string
): Promise<CmsPageWithTemplate | null> => {
    // Uses !inner join — orphaned pages (whose template was deleted) will
    // return null. The cms_pages.template_id FK uses ON DELETE RESTRICT
    // (see migration 20260406) which prevents template deletion while any
    // pages reference it, so orphaned rows should not exist in practice.
    const { data, error } = await db
        .from(Tables.CMS_PAGES)
        .select(
            `
            *,
            template:cms_templates!inner (*)
        `
        )
        .eq('id', id)
        .maybeSingle()

    if (error) throw error
    if (!data) return null

    // Supabase nested select may return an object or array depending on
    // relationship inference. Single FK should return an object.
    const raw = data as unknown as CmsPageRow & {
        template: CmsTemplateRow | CmsTemplateRow[] | null
    }
    const template = Array.isArray(raw.template)
        ? raw.template[0]
        : raw.template
    if (!template) return null

    return { ...raw, template } as CmsPageWithTemplate
}

const findByClientAndSlug = async (
    clientId: string,
    slug: string
): Promise<CmsPageRow | null> => {
    const { data, error } = await db
        .from(Tables.CMS_PAGES)
        .select('*')
        .eq(COLUMNS.CLIENT_ID, clientId)
        .eq(COLUMNS.CMS_SLUG, slug)
        .maybeSingle()

    if (error) throw error
    return (data as CmsPageRow) || null
}

/**
 * Looks up a published page by client + slug with its template joined.
 * Used by the public endpoint that client websites consume.
 * Only returns rows where status = 'published'. Returns null for
 * missing pages, draft pages, or archived pages.
 *
 * Uses !inner on cms_templates — ON DELETE RESTRICT on template_id
 * prevents orphaned pages from existing.
 */
const findPublishedByClientAndSlug = async (
    clientId: string,
    slug: string
): Promise<CmsPageWithTemplate | null> => {
    const { data, error } = await db
        .from(Tables.CMS_PAGES)
        .select(
            `
            *,
            template:cms_templates!inner (*)
        `
        )
        .eq(COLUMNS.CLIENT_ID, clientId)
        .eq(COLUMNS.CMS_SLUG, slug)
        .eq('status', 'published')
        .maybeSingle()

    if (error) throw error
    if (!data) return null

    const raw = data as unknown as CmsPageRow & {
        template: CmsTemplateRow | CmsTemplateRow[] | null
    }
    const template = Array.isArray(raw.template)
        ? raw.template[0]
        : raw.template
    if (!template) return null

    return { ...raw, template } as CmsPageWithTemplate
}

const insert = async (payload: CmsPageInsertPayload): Promise<CmsPageRow> => {
    const row = {
        client_id: payload.client_id,
        template_id: payload.template_id,
        slug: payload.slug,
        content: payload.content,
        status: payload.status ?? 'draft',
        template_version: payload.template_version,
        last_edited_by: payload.last_edited_by ?? null,
    }

    const { data, error } = await db
        .from(Tables.CMS_PAGES)
        .insert([row])
        .select('*')
        .single()

    if (error) {
        // Unique constraint violation on (client_id, slug)
        if ((error as { code?: string }).code === '23505') {
            throw {
                status: 409,
                message: 'Page slug already exists for this client',
            }
        }
        throw error
    }
    return data as CmsPageRow
}

const update = async (
    id: string,
    payload: CmsPageUpdatePayload
): Promise<CmsPageRow> => {
    const patch: Record<string, unknown> = {}
    if (payload.slug !== undefined) patch.slug = payload.slug
    if (payload.content !== undefined) patch.content = payload.content
    if (payload.status !== undefined) patch.status = payload.status
    if (payload.last_edited_by !== undefined) {
        patch.last_edited_by = payload.last_edited_by
    }
    if (payload.template_version !== undefined) {
        patch.template_version = payload.template_version
    }

    const { data, error } = await db
        .from(Tables.CMS_PAGES)
        .update(patch)
        .eq('id', id)
        .select('*')
        .single()

    if (error) {
        if ((error as { code?: string }).code === '23505') {
            throw {
                status: 409,
                message: 'Page slug already exists for this client',
            }
        }
        throw error
    }
    return data as CmsPageRow
}

const publish = async (
    id: string,
    authUid: string
): Promise<CmsPageRow> => {
    const now = new Date().toISOString()
    const { data, error } = await db
        .from(Tables.CMS_PAGES)
        .update({
            status: 'published',
            published_at: now,
            published_by: authUid,
            last_edited_by: authUid,
        })
        .eq('id', id)
        .select('*')
        .single()

    if (error) throw error
    return data as CmsPageRow
}

const remove = async (id: string): Promise<void> => {
    const { error } = await db.from(Tables.CMS_PAGES).delete().eq('id', id)
    if (error) throw error
}

export default {
    findByClientId,
    findById,
    findByIdWithTemplate,
    findByClientAndSlug,
    findPublishedByClientAndSlug,
    insert,
    update,
    publish,
    remove,
}
