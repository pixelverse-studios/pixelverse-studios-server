import { db, Tables } from '../lib/db'

type SeoGrade =
    | 'A+'
    | 'A'
    | 'A-'
    | 'B+'
    | 'B'
    | 'B-'
    | 'C+'
    | 'C'
    | 'C-'
    | 'D'
    | 'F'

type KeywordTrend = 'up' | 'down' | 'stable' | 'new' | 'lost'

interface ChecklistItem {
    category: string
    total: number
    completed: number
    pct: number
}

interface ChangelogEntry {
    date: string
    description: string
    category: string
    impact: string
}

interface KeywordInput {
    keyword: string
    position: number | null
    previous_position: number | null
    search_volume: number | null
    trend: KeywordTrend
    target_city?: string
    target_url?: string
}

interface CompetitorInput {
    competitor_domain: string
    da_score: number | null
    keyword_overlap: number | null
    overlap_keywords?: string[]
    notes?: string
}

interface AuditPayload {
    website_id: string
    audit_date?: string
    score: number
    grade: SeoGrade
    auditor: string
    findings_count: number
    summary?: string
    next_audit_due?: string
    checklist: ChecklistItem[]
    changelog: ChangelogEntry[]
    keywords: KeywordInput[]
    competitors: CompetitorInput[]
    raw_data?: object
}

interface AuditResult {
    id: string
    website_id: string
    audit_date: string
    score: number
    grade: string
    keywords_tracked: number
    competitors_tracked: number
}

const upsertAudit = async (payload: AuditPayload): Promise<AuditResult> => {
    const auditDate = payload.audit_date ?? new Date().toISOString().split('T')[0]

    // 1. Upsert the audit snapshot
    const { data: audit, error: auditError } = await db
        .from(Tables.SEO_AUDITS)
        .upsert(
            {
                website_id: payload.website_id,
                audit_date: auditDate,
                score: payload.score,
                grade: payload.grade,
                auditor: payload.auditor,
                findings_count: payload.findings_count,
                summary: payload.summary ?? null,
                checklist: payload.checklist,
                changelog: payload.changelog,
                next_audit_due: payload.next_audit_due ?? null,
                raw_data: payload.raw_data ?? null,
            },
            { onConflict: 'website_id,audit_date' }
        )
        .select('id, website_id, audit_date, score, grade')
        .single()

    if (auditError) throw auditError

    // 2. Delete existing keywords and competitors for this audit
    const { error: deleteKeywordsError } = await db
        .from(Tables.SEO_KEYWORDS)
        .delete()
        .eq('audit_id', audit.id)

    if (deleteKeywordsError) throw deleteKeywordsError

    const { error: deleteCompetitorsError } = await db
        .from(Tables.SEO_COMPETITORS)
        .delete()
        .eq('audit_id', audit.id)

    if (deleteCompetitorsError) throw deleteCompetitorsError

    // 3. Bulk insert keywords
    if (payload.keywords.length > 0) {
        const keywordRows = payload.keywords.map(kw => ({
            audit_id: audit.id,
            website_id: payload.website_id,
            keyword: kw.keyword,
            position: kw.position,
            previous_position: kw.previous_position,
            search_volume: kw.search_volume,
            trend: kw.trend,
            target_city: kw.target_city ?? null,
            target_url: kw.target_url ?? null,
        }))

        const { error: keywordsError } = await db
            .from(Tables.SEO_KEYWORDS)
            .insert(keywordRows)

        if (keywordsError) throw keywordsError
    }

    // 4. Bulk insert competitors
    if (payload.competitors.length > 0) {
        const competitorRows = payload.competitors.map(comp => ({
            audit_id: audit.id,
            website_id: payload.website_id,
            competitor_domain: comp.competitor_domain,
            da_score: comp.da_score,
            keyword_overlap: comp.keyword_overlap,
            overlap_keywords: comp.overlap_keywords ?? [],
            notes: comp.notes ?? null,
        }))

        const { error: competitorsError } = await db
            .from(Tables.SEO_COMPETITORS)
            .insert(competitorRows)

        if (competitorsError) throw competitorsError
    }

    return {
        id: audit.id,
        website_id: audit.website_id,
        audit_date: audit.audit_date,
        score: audit.score,
        grade: audit.grade,
        keywords_tracked: payload.keywords.length,
        competitors_tracked: payload.competitors.length,
    }
}

export default { upsertAudit }

export type {
    AuditPayload,
    AuditResult,
    SeoGrade,
    KeywordTrend,
    ChecklistItem,
    ChangelogEntry,
    KeywordInput,
    CompetitorInput,
}
