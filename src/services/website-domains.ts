import { db, Tables, COLUMNS } from '../lib/db'

export type WebsiteDomainPurpose =
    | 'dashboard'
    | 'production'
    | 'staging'
    | 'preview'

export interface WebsiteDomainRow {
    id: string
    website_id: string
    hostname: string
    purpose: WebsiteDomainPurpose
    active: boolean
    created_at: string
    updated_at: string
}

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

const normalizeHostname = (hostname: string): string =>
    hostname.toLowerCase().trim()

const findByHostname = async (
    hostname: string
): Promise<WebsiteDomainRow | null> => {
    const { data, error } = await db
        .from(Tables.WEBSITE_DOMAINS)
        .select('*')
        .eq(COLUMNS.HOSTNAME, normalizeHostname(hostname))
        .eq('active', true)
        .maybeSingle()

    if (error) throw error
    return (data as WebsiteDomainRow) || null
}

const findByHostnameWithContext = async (
    hostname: string
): Promise<WebsiteDomainContext | null> => {
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
        .eq(COLUMNS.HOSTNAME, normalizeHostname(hostname))
        .eq('active', true)
        .maybeSingle()

    if (error) throw error
    if (!data) return null

    // Supabase returns nested relations as either an object or an array
    // depending on relationship inference. Normalize to object form so
    // controllers can rely on a stable shape.
    const raw = data as unknown as {
        id: string
        hostname: string
        purpose: WebsiteDomainPurpose
        active: boolean
        website:
            | {
                  id: string
                  title: string | null
                  branding: Record<string, unknown> | null
                  client:
                      | WebsiteDomainContextClient
                      | WebsiteDomainContextClient[]
              }
            | Array<{
                  id: string
                  title: string | null
                  branding: Record<string, unknown> | null
                  client:
                      | WebsiteDomainContextClient
                      | WebsiteDomainContextClient[]
              }>
    }

    const websiteRaw = Array.isArray(raw.website) ? raw.website[0] : raw.website
    if (!websiteRaw) return null

    const clientRaw = Array.isArray(websiteRaw.client)
        ? websiteRaw.client[0]
        : websiteRaw.client
    if (!clientRaw) return null

    return {
        id: raw.id,
        hostname: raw.hostname,
        purpose: raw.purpose,
        active: raw.active,
        website: {
            id: websiteRaw.id,
            title: websiteRaw.title,
            branding: websiteRaw.branding,
            client: {
                id: clientRaw.id,
                firstname: clientRaw.firstname,
                lastname: clientRaw.lastname,
                company_name: clientRaw.company_name,
            },
        },
    }
}

export default {
    findByHostname,
    findByHostnameWithContext,
}
