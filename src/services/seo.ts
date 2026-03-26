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
    impact: 'positive' | 'negative' | 'neutral'
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

/**
 * Get SEO overview for all websites (dashboard table)
 */
const getOverview = async (status?: string) => {
    // Get all websites with client info
    let websiteQuery = db
        .from(Tables.WEBSITES)
        .select('id, title, domain, status, clients(firstname, lastname)')

    if (status) {
        websiteQuery = websiteQuery.eq('status', status)
    }

    const { data: websites, error: websiteError } = await websiteQuery
    if (websiteError) throw websiteError
    if (!websites || websites.length === 0) return { total: 0, websites: [] }

    const websiteIds = websites.map((w: any) => w.id)

    // Get latest 2 audits per website for trend calculation
    const { data: audits, error: auditsError } = await db
        .from(Tables.SEO_AUDITS)
        .select('id, website_id, audit_date, score, grade, auditor, findings_count, checklist, next_audit_due')
        .in('website_id', websiteIds)
        .order('audit_date', { ascending: false })

    if (auditsError) throw auditsError

    // Get keyword counts per audit
    const latestAuditIds = new Set<string>()
    const auditsByWebsite = new Map<string, any[]>()
    for (const audit of audits || []) {
        const existing = auditsByWebsite.get(audit.website_id) || []
        if (existing.length < 2) {
            existing.push(audit)
            auditsByWebsite.set(audit.website_id, existing)
            if (existing.length === 1) latestAuditIds.add(audit.id)
        }
    }

    // Get keyword stats for latest audits only
    const keywordStats = new Map<string, { tracked: number; ranking: number }>()
    if (latestAuditIds.size > 0) {
        const { data: keywords, error: kwError } = await db
            .from(Tables.SEO_KEYWORDS)
            .select('audit_id, position')
            .in('audit_id', Array.from(latestAuditIds))

        if (kwError) throw kwError

        for (const kw of keywords || []) {
            const stats = keywordStats.get(kw.audit_id) || { tracked: 0, ranking: 0 }
            stats.tracked++
            if (kw.position !== null) stats.ranking++
            keywordStats.set(kw.audit_id, stats)
        }
    }

    // Build response
    const result = websites.map((website: any) => {
        const siteAudits = auditsByWebsite.get(website.id) || []
        const latest = siteAudits[0] || null
        const previous = siteAudits[1] || null

        const checklist = latest?.checklist as ChecklistItem[] | null
        const checklistPct = checklist && checklist.length > 0
            ? Math.round(
                checklist.reduce((sum: number, c: ChecklistItem) => sum + c.pct, 0) / checklist.length
            )
            : null

        const kwStats = latest ? keywordStats.get(latest.id) : null

        let scoreTrend: 'up' | 'down' | 'stable' | null = null
        let scoreDelta: number | null = null
        if (latest && previous) {
            scoreDelta = latest.score - previous.score
            scoreTrend = scoreDelta > 0 ? 'up' : scoreDelta < 0 ? 'down' : 'stable'
        }

        const client = website.clients as { firstname: string | null; lastname: string | null }

        return {
            website_id: website.id,
            website_title: website.title,
            domain: website.domain,
            client_name: [client.firstname, client.lastname].filter(Boolean).join(' ') || null,
            project_status: website.status,
            seo_score: latest?.score ?? null,
            seo_grade: latest?.grade ?? null,
            last_audit_date: latest?.audit_date ?? null,
            auditor: latest?.auditor ?? null,
            findings_count: latest?.findings_count ?? null,
            keywords_tracked: kwStats?.tracked ?? 0,
            keywords_ranking: kwStats?.ranking ?? 0,
            checklist_pct: checklistPct,
            next_audit_due: latest?.next_audit_due ?? null,
            score_trend: scoreTrend,
            score_delta: scoreDelta,
        }
    })

    return { total: result.length, websites: result }
}

/**
 * Get full SEO summary for a single website
 */
const getWebsiteSeo = async (websiteId: string) => {
    // Latest audit
    const { data: latestAudit, error: auditError } = await db
        .from(Tables.SEO_AUDITS)
        .select('*')
        .eq('website_id', websiteId)
        .order('audit_date', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (auditError) throw auditError

    if (!latestAudit) {
        return {
            website_id: websiteId,
            latest_audit: null,
            keywords: { total: 0, ranking: 0, avg_position: null, top_keywords: [] },
            competitors: [],
            trend: { dates: [], scores: [] },
        }
    }

    // Keywords for latest audit
    const { data: keywords, error: kwError } = await db
        .from(Tables.SEO_KEYWORDS)
        .select('*')
        .eq('audit_id', latestAudit.id)
        .order('position', { ascending: true, nullsFirst: false })

    if (kwError) throw kwError

    const rankingKeywords = (keywords || []).filter((k: any) => k.position !== null)
    const avgPosition = rankingKeywords.length > 0
        ? Math.round(
            (rankingKeywords.reduce((sum: number, k: any) => sum + k.position, 0) / rankingKeywords.length) * 10
        ) / 10
        : null

    // Competitors for latest audit
    const { data: competitors, error: compError } = await db
        .from(Tables.SEO_COMPETITORS)
        .select('*')
        .eq('audit_id', latestAudit.id)

    if (compError) throw compError

    // Score trend (last 6 audits, returned in chronological order)
    const { data: trendAudits, error: trendError } = await db
        .from(Tables.SEO_AUDITS)
        .select('audit_date, score')
        .eq('website_id', websiteId)
        .order('audit_date', { ascending: false })
        .limit(6)

    if (trendError) throw trendError

    // Reverse to chronological order for chart display
    const trendChronological = (trendAudits || []).reverse()

    return {
        website_id: websiteId,
        latest_audit: {
            id: latestAudit.id,
            audit_date: latestAudit.audit_date,
            score: latestAudit.score,
            grade: latestAudit.grade,
            auditor: latestAudit.auditor,
            findings_count: latestAudit.findings_count,
            summary: latestAudit.summary,
            next_audit_due: latestAudit.next_audit_due,
            checklist: latestAudit.checklist,
            changelog: latestAudit.changelog,
        },
        keywords: {
            total: (keywords || []).length,
            ranking: rankingKeywords.length,
            avg_position: avgPosition,
            top_keywords: (keywords || []).slice(0, 10),
        },
        competitors: competitors || [],
        trend: {
            dates: trendChronological.map((a: any) => a.audit_date),
            scores: trendChronological.map((a: any) => a.score),
        },
    }
}

/**
 * Get paginated audit history for a website
 */
const getAuditHistory = async (
    websiteId: string,
    limit: number = 12,
    offset: number = 0,
) => {
    const { data: audits, error, count } = await db
        .from(Tables.SEO_AUDITS)
        .select('id, audit_date, score, grade, auditor, findings_count, summary, checklist, next_audit_due, created_at', { count: 'exact' })
        .eq('website_id', websiteId)
        .order('audit_date', { ascending: false })
        .range(offset, offset + limit - 1)

    if (error) throw error

    // Get keyword counts per audit
    const auditIds = (audits || []).map((a: any) => a.id)
    const keywordCounts = new Map<string, number>()
    if (auditIds.length > 0) {
        const { data: kwData, error: kwError } = await db
            .from(Tables.SEO_KEYWORDS)
            .select('audit_id')
            .in('audit_id', auditIds)

        if (kwError) throw kwError

        for (const kw of kwData || []) {
            keywordCounts.set(kw.audit_id, (keywordCounts.get(kw.audit_id) || 0) + 1)
        }
    }

    const results = (audits || []).map((audit: any) => {
        const checklist = audit.checklist as ChecklistItem[]
        const checklistPct = checklist && checklist.length > 0
            ? Math.round(
                checklist.reduce((sum: number, c: ChecklistItem) => sum + c.pct, 0) / checklist.length
            )
            : null

        return {
            id: audit.id,
            audit_date: audit.audit_date,
            score: audit.score,
            grade: audit.grade,
            auditor: audit.auditor,
            findings_count: audit.findings_count,
            summary: audit.summary,
            checklist_pct: checklistPct,
            keywords_tracked: keywordCounts.get(audit.id) || 0,
            next_audit_due: audit.next_audit_due,
            created_at: audit.created_at,
        }
    })

    return {
        website_id: websiteId,
        total: count,
        limit,
        offset,
        audits: results,
    }
}

/**
 * Get keyword position history for trend charts
 */
const getKeywordHistory = async (
    websiteId: string,
    keyword?: string,
    limit: number = 12,
) => {
    // Get recent audits for this website
    const { data: audits, error: auditError } = await db
        .from(Tables.SEO_AUDITS)
        .select('id, audit_date')
        .eq('website_id', websiteId)
        .order('audit_date', { ascending: false })
        .limit(limit)

    if (auditError) throw auditError
    if (!audits || audits.length === 0) {
        return { website_id: websiteId, keywords: [] }
    }

    const auditIds = audits.map((a: any) => a.id)
    const auditDateMap = new Map(audits.map((a: any) => [a.id, a.audit_date]))

    // Get keywords across those audits
    let kwQuery = db
        .from(Tables.SEO_KEYWORDS)
        .select('audit_id, keyword, position, search_volume, trend, target_city')
        .in('audit_id', auditIds)

    if (keyword) {
        kwQuery = kwQuery.eq('keyword', keyword)
    }

    const { data: keywords, error: kwError } = await kwQuery
    if (kwError) throw kwError

    // Group by keyword
    const keywordMap = new Map<string, {
        keyword: string
        target_city: string | null
        history: { audit_date: string; position: number | null; search_volume: number | null; trend: string }[]
    }>()

    for (const kw of keywords || []) {
        if (!keywordMap.has(kw.keyword)) {
            keywordMap.set(kw.keyword, {
                keyword: kw.keyword,
                target_city: kw.target_city,
                history: [],
            })
        }
        keywordMap.get(kw.keyword)!.history.push({
            audit_date: auditDateMap.get(kw.audit_id) || '',
            position: kw.position,
            search_volume: kw.search_volume,
            trend: kw.trend,
        })
    }

    // Sort history chronologically within each keyword
    for (const entry of keywordMap.values()) {
        entry.history.sort((a, b) => a.audit_date.localeCompare(b.audit_date))
    }

    return {
        website_id: websiteId,
        keywords: Array.from(keywordMap.values()),
    }
}

export default { upsertAudit, getOverview, getWebsiteSeo, getAuditHistory, getKeywordHistory }

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
