import { db, Tables, COLUMNS } from '../lib/db'
import { normalizeHostname } from '../utils/hostname'

export type WebsiteDomainPurpose =
    | 'dashboard'
    | 'production'
    | 'staging'
    | 'preview'

export interface WebsiteDomainContextClient {
    id: string
    firstname: string | null
    lastname: string | null
    company_name: string | null
}

export interface WebsiteDomainContextWebsite {
    id: string
    title: string | null
    branding: Record<string, unknown> | null
    client: WebsiteDomainContextClient
}

export interface WebsiteDomainContext {
    id: string
    hostname: string
    purpose: WebsiteDomainPurpose
    active: boolean
    website: WebsiteDomainContextWebsite
}

interface RawJoinedRow {
    id: string
    hostname: string
    purpose: WebsiteDomainPurpose
    active: boolean
    website: {
        id: string
        title: string | null
        branding: Record<string, unknown> | null
        client: WebsiteDomainContextClient
    } | null
}

/**
 * Looks up a website_domain by hostname with joined website + client context.
 * Uses the partial unique index on (hostname) WHERE active = true for
 * efficient lookup. Returns null if no active domain matches.
 */
const findByHostnameWithContext = async (
    hostname: string
): Promise<WebsiteDomainContext | null> => {
    const normalized = normalizeHostname(hostname)
    if (!normalized) return null

    const { data, error } = await db
        .from(Tables.WEBSITE_DOMAINS)
        .select(
            `
            id,
            hostname,
            purpose,
            active,
            website:websites!inner (
                id,
                title,
                branding,
                client:clients!inner (
                    id,
                    firstname,
                    lastname,
                    company_name
                )
            )
        `
        )
        .eq(COLUMNS.HOSTNAME, normalized)
        .eq('active', true)
        .maybeSingle()

    if (error) throw error
    if (!data) return null

    const row = data as unknown as RawJoinedRow
    if (!row.website || !row.website.client) return null

    return {
        id: row.id,
        hostname: row.hostname,
        purpose: row.purpose,
        active: row.active,
        website: {
            id: row.website.id,
            title: row.website.title,
            branding: row.website.branding,
            client: {
                id: row.website.client.id,
                firstname: row.website.client.firstname,
                lastname: row.website.client.lastname,
                company_name: row.website.client.company_name,
            },
        },
    }
}

export default {
    findByHostnameWithContext,
}
