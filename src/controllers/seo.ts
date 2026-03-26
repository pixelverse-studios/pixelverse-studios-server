import { Request, Response } from 'express'

import { db, Tables } from '../lib/db'
import { handleGenericError } from '../utils/http'
import seoService from '../services/seo'

const submitAudit = async (req: Request, res: Response): Promise<Response> => {
    try {
        const {
            website_id,
            audit_date,
            score,
            grade,
            auditor,
            findings_count,
            summary,
            next_audit_due,
            checklist,
            changelog,
            keywords,
            competitors,
            raw_data,
        } = req.body

        // Verify website exists
        const { data: website, error: websiteError } = await db
            .from(Tables.WEBSITES)
            .select('id')
            .eq('id', website_id)
            .single()

        if (websiteError || !website) {
            return res.status(404).json({ error: 'Website not found' })
        }

        const result = await seoService.upsertAudit({
            website_id,
            audit_date,
            score,
            grade,
            auditor,
            findings_count,
            summary,
            next_audit_due,
            checklist: checklist ?? [],
            changelog: changelog ?? [],
            keywords: keywords ?? [],
            competitors: competitors ?? [],
            raw_data,
        })

        console.log('✅ SEO audit upserted:', {
            id: result.id,
            website_id: result.website_id,
            score: result.score,
            grade: result.grade,
            keywords: result.keywords_tracked,
            competitors: result.competitors_tracked,
        })

        return res.status(201).json(result)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getOverview = async (req: Request, res: Response): Promise<Response> => {
    try {
        const status = req.query.status as string | undefined
        const result = await seoService.getOverview(status)
        return res.status(200).json(result)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getWebsiteSeo = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { websiteId } = req.params

        // Verify website exists
        const { data: website, error: websiteError } = await db
            .from(Tables.WEBSITES)
            .select('id')
            .eq('id', websiteId)
            .single()

        if (websiteError || !website) {
            return res.status(404).json({ error: 'Website not found' })
        }

        const result = await seoService.getWebsiteSeo(websiteId)
        return res.status(200).json(result)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getAuditHistory = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { websiteId } = req.params
        const limit = parseInt(req.query.limit as string) || 12
        const offset = parseInt(req.query.offset as string) || 0

        const result = await seoService.getAuditHistory(websiteId, limit, offset)
        return res.status(200).json(result)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getKeywordHistory = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { websiteId } = req.params
        const keyword = req.query.keyword as string | undefined
        const limit = parseInt(req.query.limit as string) || 12

        const result = await seoService.getKeywordHistory(websiteId, keyword, limit)
        return res.status(200).json(result)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { submitAudit, getOverview, getWebsiteSeo, getAuditHistory, getKeywordHistory }
