import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import { db, Tables } from '../lib/db'
import { handleGenericError } from '../utils/http'
import deploymentsService from '../services/deployments'
import pendingWebhookEvents from '../services/pending-webhook-events'
import { processEvent } from '../lib/webhook-processor'

// DEV-701: Deploy-window resilience.
// This endpoint is hit by client CI/CD with data that is generated once and
// never re-sent. Persist the payload to `pending_webhook_events` first, then
// attempt the real work (create deployment row + send email). If the inline
// attempt fails, the row is already safe — the background poller will retry.
const create = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { website_id, changed_urls, deploy_summary, internal_notes } =
            req.body

        const pendingEvent = await pendingWebhookEvents.insertPending(
            'deployment',
            { website_id, changed_urls, deploy_summary, internal_notes },
        )

        const succeeded = await processEvent(pendingEvent)

        if (succeeded) {
            const resultRef = await getResultRef(pendingEvent.id)
            const deployment = resultRef
                ? await deploymentsService.getDeploymentById(resultRef)
                : null

            if (deployment) {
                return res.status(201).json(deployment)
            }
            return res.status(201).json({
                queued: false,
                event_id: pendingEvent.id,
            })
        }

        // Inline attempt failed. The event row is safe and will be retried by
        // the background poller. Respond 202 so the client's CI/CD pipeline
        // treats this as a successful hand-off.
        return res.status(202).json({
            queued: true,
            event_id: pendingEvent.id,
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getResultRef = async (eventId: string): Promise<string | null> => {
    const { data, error } = await db
        .from(Tables.PENDING_WEBHOOK_EVENTS)
        .select('result_ref')
        .eq('id', eventId)
        .single()

    if (error || !data) return null
    return (data as { result_ref: string | null }).result_ref
}

const getByWebsite = async (req: Request, res: Response): Promise<Response> => {
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
        const updated = await deploymentsService.updateDeploymentStatus(
            id,
            status
        )

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
        const updated = await deploymentsService.updateUrlStatus(
            id,
            url,
            status
        )

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
        const updated = await deploymentsService.updateUrlsBatchStatus(
            id,
            urls,
            status
        )

        return res.status(200).json(updated)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getUnindexed = async (req: Request, res: Response): Promise<Response> => {
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
        const updated = await deploymentsService.updateDeploymentStatus(
            id,
            'indexed'
        )

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
        const updated = await deploymentsService.updateUrlStatus(
            id,
            url,
            'indexed'
        )

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
