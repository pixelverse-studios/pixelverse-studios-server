import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import { db, Tables } from '../lib/db'
import { handleGenericError } from '../utils/http'
import appDeploymentsService from '../services/app-deployments'
import type { Environment } from '../services/app-deployments'

const create = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const {
            app_id,
            version,
            environment,
            deploy_summary,
            commit_sha,
            commit_url,
            internal_notes,
            deployed_by
        } = req.body

        // Verify app exists
        const { data: app, error: appError } = await db
            .from(Tables.APPS)
            .select('id, name, contact_email, client_id')
            .eq('id', app_id)
            .single()

        if (appError || !app) {
            return res.status(404).json({ error: 'App not found' })
        }

        // Create deployment record
        const deployment = await appDeploymentsService.createDeployment({
            app_id,
            version,
            environment,
            deploy_summary,
            commit_sha,
            commit_url,
            internal_notes,
            deployed_by
        })

        return res.status(201).json(deployment)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getByApp = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { appId } = req.params
        const limit = parseInt(req.query.limit as string) || 20
        const offset = parseInt(req.query.offset as string) || 0
        const environment = req.query.environment as Environment | undefined

        // Verify app exists
        const { data: app, error: appError } = await db
            .from(Tables.APPS)
            .select('id, name')
            .eq('id', appId)
            .single()

        if (appError || !app) {
            return res.status(404).json({ error: 'App not found' })
        }

        const { deployments, total } =
            await appDeploymentsService.getDeploymentsByAppId(
                appId,
                limit,
                offset,
                environment
            )

        return res.status(200).json({
            app_id: appId,
            app_name: app.name,
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
        const deployment = await appDeploymentsService.getDeploymentById(id)

        if (!deployment) {
            return res.status(404).json({ error: 'Deployment not found' })
        }

        return res.status(200).json(deployment)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getLatest = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { appId } = req.params

        // Verify app exists
        const { data: app, error: appError } = await db
            .from(Tables.APPS)
            .select('id, name')
            .eq('id', appId)
            .single()

        if (appError || !app) {
            return res.status(404).json({ error: 'App not found' })
        }

        const latest = await appDeploymentsService.getLatestByEnvironment(appId)

        return res.status(200).json({
            app_id: appId,
            app_name: app.name,
            latest
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const updateStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { id } = req.params
        const { status, rollback_reason } = req.body

        // Verify deployment exists
        const existing = await appDeploymentsService.getDeploymentById(id)
        if (!existing) {
            return res.status(404).json({ error: 'Deployment not found' })
        }

        const updated = await appDeploymentsService.updateStatus(id, status, {
            rollback_reason
        })

        return res.status(200).json(updated)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const getActive = async (req: Request, res: Response): Promise<Response> => {
    try {
        const limit = parseInt(req.query.limit as string) || 50

        const deployments =
            await appDeploymentsService.getActiveDeployments(limit)

        return res.status(200).json({
            total: deployments.length,
            deployments
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default {
    create,
    getByApp,
    getById,
    getLatest,
    updateStatus,
    getActive
}
