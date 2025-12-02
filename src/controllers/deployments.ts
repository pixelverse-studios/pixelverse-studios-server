import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import { db, Tables } from '../lib/db'
import { handleGenericError } from '../utils/http'
import deploymentsService from '../services/deployments'
import { sendDeploymentEmail } from '../lib/nylas-mailer'

const create = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { website_id, changed_urls, deploy_summary, internal_notes } = req.body

        // 1. Verify website exists
        const { data: website, error: websiteError } = await db
            .from(Tables.WEBSITES)
            .select('id, title, contact_email, client_id')
            .eq('id', website_id)
            .single()

        if (websiteError || !website) {
            return res.status(404).json({ error: 'Website not found' })
        }

        // 2. Create deployment record
        const deployment = await deploymentsService.createDeployment({
            website_id,
            changed_urls,
            deploy_summary,
            internal_notes
        })

        // 3. Send email notification (if contact email exists)
        if (website.contact_email) {
            try {
                await sendDeploymentEmail({
                    to: website.contact_email,
                    websiteTitle: website.title,
                    deploymentDate: new Date(deployment.created_at).toLocaleDateString(),
                    summaryMarkdown: deploy_summary
                })
                console.log(
                    '✅ Deployment email sent:',
                    website.contact_email,
                    'for',
                    website.title
                )
            } catch (emailError) {
                console.error('❌ Error sending deployment email:', emailError)
                // Don't fail the request if email fails
            }
        }

        // 4. Return deployment record
        return res.status(201).json(deployment)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getByWebsite = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { websiteId } = req.params
        const limit = parseInt(req.query.limit as string) || 20
        const offset = parseInt(req.query.offset as string) || 0

        // Get website info
        const { data: website, error: websiteError } = await db
            .from(Tables.WEBSITES)
            .select('id, title')
            .eq('id', websiteId)
            .single()

        if (websiteError || !website) {
            return res.status(404).json({ error: 'Website not found' })
        }

        const { deployments, total } =
            await deploymentsService.getDeploymentsByWebsiteId(
                websiteId,
                limit,
                offset
            )

        return res.status(200).json({
            website_id: websiteId,
            website_title: website.title,
            total,
            limit,
            offset,
            deployments
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getById = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const deployment = await deploymentsService.getDeploymentById(id)

        if (!deployment) {
            return res.status(404).json({ error: 'Deployment not found' })
        }

        return res.status(200).json(deployment)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

/**
 * Update deployment status (bulk update all URLs)
 * PATCH /api/deployments/:id/status
 * Body: { status: 'requested' | 'indexed' }
 */
const updateDeploymentStatus = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const { status } = req.body

        // Verify deployment exists
        const existing = await deploymentsService.getDeploymentById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Deployment not found' })
        }

        // Update deployment status
        const updated = await deploymentsService.updateDeploymentStatus(id, status)

        return res.status(200).json(updated)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

/**
 * Update a single URL's status within a deployment
 * PATCH /api/deployments/:id/urls/status
 * Body: { url: string, status: 'requested' | 'indexed' }
 */
const updateUrlStatus = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const { url, status } = req.body

        // Verify deployment exists
        const existing = await deploymentsService.getDeploymentById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Deployment not found' })
        }

        // Update URL status
        const updated = await deploymentsService.updateUrlStatus(id, url, status)

        return res.status(200).json(updated)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

/**
 * Batch update multiple URLs' status within a deployment
 * PATCH /api/deployments/:id/urls/batch
 * Body: { urls: string[], status: 'requested' | 'indexed' }
 */
const updateUrlsBatch = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const { urls, status } = req.body

        // Verify deployment exists
        const existing = await deploymentsService.getDeploymentById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Deployment not found' })
        }

        // Batch update URL statuses
        const updated = await deploymentsService.updateUrlsBatchStatus(id, urls, status)

        return res.status(200).json(updated)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getUnindexed = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const limit = parseInt(req.query.limit as string) || 50

        const deployments =
            await deploymentsService.getUnindexedDeployments(limit)

        return res.status(200).json({
            total: deployments.length,
            deployments
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

// Legacy endpoints - redirect to new ones for backward compatibility
const markAsIndexed = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params

        // Verify deployment exists
        const existing = await deploymentsService.getDeploymentById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Deployment not found' })
        }

        // Mark all URLs as indexed
        const updated = await deploymentsService.updateDeploymentStatus(id, 'indexed')

        return res.status(200).json(updated)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const markUrlAsIndexed = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const { url } = req.body

        // Verify deployment exists
        const existing = await deploymentsService.getDeploymentById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Deployment not found' })
        }

        // Mark specific URL as indexed
        const updated = await deploymentsService.updateUrlStatus(id, url, 'indexed')

        return res.status(200).json(updated)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default {
    create,
    getByWebsite,
    getById,
    updateDeploymentStatus,
    updateUrlStatus,
    updateUrlsBatch,
    getUnindexed,
    // Legacy endpoints for backward compatibility
    markAsIndexed,
    markUrlAsIndexed
}
