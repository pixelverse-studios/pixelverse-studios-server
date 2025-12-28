import { Request, Response } from 'express'

import websitesDB from '../services/websites'
import appsDB from '../services/apps'
import { handleGenericError } from '../utils/http'

interface ReorderItem {
    id: string
    type: 'website' | 'app'
    priority: number
}

const reorder = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { items } = req.body as { items: ReorderItem[] }

        // Validate all items have required fields
        for (const item of items) {
            if (!item.id || !item.type || typeof item.priority !== 'number') {
                return res.status(400).json({
                    error: 'Invalid item',
                    message:
                        'Each item must have id (UUID), type (website or app), and priority (number)'
                })
            }
            if (!['website', 'app'].includes(item.type)) {
                return res.status(400).json({
                    error: 'Invalid type',
                    message: 'Type must be "website" or "app"'
                })
            }
        }

        // Separate items by type
        const websiteItems = items.filter(item => item.type === 'website')
        const appItems = items.filter(item => item.type === 'app')

        // Verify all websites exist
        for (const item of websiteItems) {
            const existing = await websitesDB.findById(item.id)
            if (!existing) {
                return res.status(404).json({
                    error: 'Website not found',
                    message: `Website with id ${item.id} not found`
                })
            }
        }

        // Verify all apps exist
        for (const item of appItems) {
            const existing = await appsDB.findById(item.id)
            if (!existing) {
                return res.status(404).json({
                    error: 'App not found',
                    message: `App with id ${item.id} not found`
                })
            }
        }

        // Update all priorities
        const results: {
            websites: any[]
            apps: any[]
        } = {
            websites: [],
            apps: []
        }

        for (const item of websiteItems) {
            const updated = await websitesDB.updatePriority(
                item.id,
                item.priority
            )
            results.websites.push(updated)
        }

        for (const item of appItems) {
            const updated = await appsDB.updatePriority(item.id, item.priority)
            results.apps.push(updated)
        }

        return res.status(200).json({
            message: 'Priorities updated successfully',
            updated: {
                websites: results.websites.length,
                apps: results.apps.length
            },
            items: results
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { reorder }
