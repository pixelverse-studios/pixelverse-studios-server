import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import { handleGenericError } from '../utils/http'
import domaniService from '../services/domani'
import {
    FeedbackCategory,
    Platform,
    UserTier,
    SignupCohort
} from '../lib/domani-db'

/**
 * GET /api/domani/feedback
 * List beta feedback submissions with filtering and pagination
 *
 * Query params:
 * - category: 'bug' | 'feature' | 'love' | 'general'
 * - status: filter by status (e.g., 'new', 'reviewed')
 * - platform: 'ios' | 'android'
 * - limit: max items (default 50, max 100)
 * - offset: pagination offset (default 0)
 */
const listFeedback = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const category = req.query.category as FeedbackCategory | undefined
        const status = req.query.status as string | undefined
        const platform = req.query.platform as Platform | undefined
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
        const offset = parseInt(req.query.offset as string) || 0

        const result = await domaniService.getFeedback({
            category,
            status,
            platform,
            limit,
            offset
        })

        return res.status(200).json({
            items: result.items,
            total: result.total,
            limit,
            offset
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

/**
 * GET /api/domani/support
 * List support requests with filtering and pagination
 *
 * Query params:
 * - category: filter by category
 * - status: filter by status
 * - platform: 'ios' | 'android'
 * - limit: max items (default 50, max 100)
 * - offset: pagination offset (default 0)
 */
const listSupportRequests = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const category = req.query.category as string | undefined
        const status = req.query.status as string | undefined
        const platform = req.query.platform as Platform | undefined
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
        const offset = parseInt(req.query.offset as string) || 0

        const result = await domaniService.getSupportRequests({
            category,
            status,
            platform,
            limit,
            offset
        })

        return res.status(200).json({
            items: result.items,
            total: result.total,
            limit,
            offset
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

/**
 * GET /api/domani/waitlist
 * List waitlist entries with filtering and pagination
 *
 * Query params:
 * - status: filter by status (e.g., 'pending', 'invited')
 * - confirmed: 'true' | 'false' to filter by confirmation status
 * - limit: max items (default 50, max 100)
 * - offset: pagination offset (default 0)
 */
const listWaitlist = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const status = req.query.status as string | undefined
        const confirmedParam = req.query.confirmed as string | undefined
        const confirmed =
            confirmedParam === 'true'
                ? true
                : confirmedParam === 'false'
                  ? false
                  : undefined
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
        const offset = parseInt(req.query.offset as string) || 0

        const result = await domaniService.getWaitlist({
            status,
            confirmed,
            limit,
            offset
        })

        return res.status(200).json({
            items: result.items,
            total: result.total,
            limit,
            offset
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

/**
 * GET /api/domani/users
 * List user profiles with filtering and pagination
 *
 * Query params:
 * - tier: 'free' | 'premium' | 'lifetime'
 * - cohort: 'friends_family' | 'early_adopter' | 'general'
 * - include_deleted: 'true' to include soft-deleted users
 * - limit: max items (default 50, max 100)
 * - offset: pagination offset (default 0)
 */
const listUsers = async (req: Request, res: Response): Promise<Response> => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const tier = req.query.tier as UserTier | undefined
        const cohort = req.query.cohort as SignupCohort | undefined
        const includeDeleted = req.query.include_deleted === 'true'
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
        const offset = parseInt(req.query.offset as string) || 0

        const result = await domaniService.getUsers({
            tier,
            cohort,
            includeDeleted,
            limit,
            offset
        })

        return res.status(200).json({
            items: result.items,
            total: result.total,
            limit,
            offset
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default {
    listFeedback,
    listSupportRequests,
    listWaitlist,
    listUsers
}
