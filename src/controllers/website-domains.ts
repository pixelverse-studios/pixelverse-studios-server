import { Request, Response } from 'express'
import { validationResult } from 'express-validator'

import websiteDomainsService from '../services/website-domains'
import { handleGenericError } from '../utils/http'

/**
 * Strip an optional port suffix from a hostname (e.g.
 * `dashboard.example.com:8080` -> `dashboard.example.com`) and lowercase/trim.
 * IPv6 hostnames are not expected for the dashboard use case.
 */
const normalizeHostname = (raw: string): string => {
    const trimmed = raw.trim().toLowerCase()
    const withoutPort = trimmed.split(':')[0] || ''
    return withoutPort
}

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
            return res.status(404).json({ error: 'Hostname not recognized' })
        }

        // Cache for 5 minutes at the edge / browser. Hostname mappings change
        // rarely, so this dramatically reduces load on the unauthenticated
        // resolution endpoint without staleness concerns.
        res.setHeader('Cache-Control', 'public, max-age=300')

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
