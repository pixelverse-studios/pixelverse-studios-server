import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import websiteDomainsService from '../services/website-domains'
import { normalizeHostname } from '../utils/hostname'
import { handleGenericError } from '../utils/http'

const SUCCESS_CACHE_MAX_AGE = 300 // 5 minutes
const NOT_FOUND_CACHE_MAX_AGE = 60 // 1 minute (blunts enumeration scans)

const resolveHostname = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const rawHostname = req.query.hostname as string
        const hostname = normalizeHostname(rawHostname)

        if (!hostname) {
            return res
                .status(400)
                .json({ error: 'hostname query parameter is required' })
        }

        const context =
            await websiteDomainsService.findByHostnameWithContext(hostname)
        if (!context) {
            res.setHeader(
                'Cache-Control',
                `public, max-age=${NOT_FOUND_CACHE_MAX_AGE}`
            )
            return res.status(404).json({ error: 'Hostname not recognized' })
        }

        // Cache for 5 minutes at the edge / browser. Hostname mappings change
        // rarely, so this dramatically reduces load on the unauthenticated
        // resolution endpoint without staleness concerns.
        res.setHeader(
            'Cache-Control',
            `public, max-age=${SUCCESS_CACHE_MAX_AGE}`
        )

        return res.status(200).json({
            website_id: context.website.id,
            website_title: context.website.title,
            client: {
                id: context.website.client.id,
                firstname: context.website.client.firstname,
                lastname: context.website.client.lastname,
                company_name: context.website.client.company_name,
            },
            // NOTE: r2_config is intentionally NEVER returned here — it is
            // operational config and must not leak from a public endpoint.
            // See migration 20260408_add_website_branding_and_domains.sql.
            branding: context.website.branding ?? null,
            purpose: context.purpose,
        })
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default {
    resolveHostname,
}
