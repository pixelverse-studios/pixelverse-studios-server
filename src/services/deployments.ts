import { db, Tables } from '../lib/db'

// Types for three-state indexing system
type IndexingStatus = 'pending' | 'requested' | 'indexed'

interface ChangedUrl {
    url: string
    indexing_status: IndexingStatus
    indexing_requested_at: string | null
    indexed_at: string | null
}

// Legacy format for backward compatibility
interface LegacyUrlFormat {
    url: string
    indexed_at: string | null
}

interface DeploymentPayload {
    website_id: string
    changed_urls: string[]
    deploy_summary: string
    internal_notes?: string
}

interface DeploymentRecord {
    id: string
    website_id: string
    changed_urls: ChangedUrl[] | LegacyUrlFormat[]
    deploy_summary: string
    internal_notes?: string
    created_at: string
    indexing_status: IndexingStatus
    indexing_requested_at: string | null
    indexed_at: string | null
}

// Enhanced response with website and client context
interface WebsiteContext {
    id: string
    title: string
    domain: string
}

interface ClientContext {
    id: string
    firstname: string | null
    lastname: string | null
}

interface DeploymentDetailResponse extends DeploymentRecord {
    website: WebsiteContext
    client: ClientContext
}

/**
 * Normalize legacy URL format to new three-state format
 * Handles both old format (just indexed_at) and new format (full three-state)
 */
const normalizeChangedUrls = (
    urls: (ChangedUrl | LegacyUrlFormat)[]
): ChangedUrl[] => {
    return urls.map(urlObj => {
        // Check if already in new format
        if ('indexing_status' in urlObj) {
            return urlObj as ChangedUrl
        }

        // Convert legacy format
        const legacy = urlObj as LegacyUrlFormat
        return {
            url: legacy.url,
            indexing_status: legacy.indexed_at ? 'indexed' : 'pending',
            indexing_requested_at: null,
            indexed_at: legacy.indexed_at
        } as ChangedUrl
    })
}

/**
 * Calculate deployment-level status from URL statuses
 * - 'pending' if ANY URL is pending
 * - 'requested' if no pending URLs but ANY URL is requested
 * - 'indexed' only if ALL URLs are indexed
 */
const calculateDeploymentStatus = (urls: ChangedUrl[]): IndexingStatus => {
    const hasPending = urls.some(u => u.indexing_status === 'pending')
    if (hasPending) return 'pending'

    const hasRequested = urls.some(u => u.indexing_status === 'requested')
    if (hasRequested) return 'requested'

    return 'indexed'
}

/**
 * Calculate deployment-level timestamps from URLs
 */
const calculateDeploymentTimestamps = (
    urls: ChangedUrl[]
): {
    indexing_requested_at: string | null
    indexed_at: string | null
} => {
    const requestedDates = urls
        .map(u => u.indexing_requested_at)
        .filter((d): d is string => d !== null)
        .sort()

    const indexedDates = urls
        .map(u => u.indexed_at)
        .filter((d): d is string => d !== null)
        .sort()

    const allIndexed = urls.every(u => u.indexing_status === 'indexed')

    return {
        // First requested timestamp
        indexing_requested_at: requestedDates[0] || null,
        // Only set indexed_at if ALL URLs are indexed, use latest timestamp
        indexed_at:
            allIndexed && indexedDates.length > 0
                ? indexedDates[indexedDates.length - 1]
                : null
    }
}

/**
 * Normalize a deployment record from the database
 * Ensures changed_urls are in the new format and deployment-level fields are present
 */
const normalizeDeployment = (
    deployment: DeploymentRecord
): DeploymentRecord => {
    const normalizedUrls = normalizeChangedUrls(deployment.changed_urls)
    const status = calculateDeploymentStatus(normalizedUrls)
    const timestamps = calculateDeploymentTimestamps(normalizedUrls)

    return {
        ...deployment,
        changed_urls: normalizedUrls,
        indexing_status: deployment.indexing_status || status,
        indexing_requested_at:
            deployment.indexing_requested_at ||
            timestamps.indexing_requested_at,
        indexed_at: deployment.indexed_at || timestamps.indexed_at
    }
}

const createDeployment = async (payload: DeploymentPayload) => {
    // Convert string array to array of objects with three-state tracking
    const urlsWithStatus: ChangedUrl[] = payload.changed_urls.map(url => ({
        url,
        indexing_status: 'pending',
        indexing_requested_at: null,
        indexed_at: null
    }))

    const { data, error } = await db
        .from(Tables.DEPLOYMENTS)
        .insert([
            {
                website_id: payload.website_id,
                changed_urls: urlsWithStatus,
                deploy_summary: payload.deploy_summary,
                internal_notes: payload.internal_notes,
                indexing_status: 'pending',
                indexing_requested_at: null,
                indexed_at: null
            }
        ])
        .select()
        .single()

    if (error) throw error
    return data
}

const getDeploymentsByWebsiteId = async (
    websiteId: string,
    limit: number = 20,
    offset: number = 0
) => {
    // Calculate date 3 months ago
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    const threeMonthsAgoISO = threeMonthsAgo.toISOString()

    // Return non-indexed deployments (any age) OR indexed deployments from past 3 months
    const { data, error, count } = await db
        .from(Tables.DEPLOYMENTS)
        .select('*', { count: 'exact' })
        .eq('website_id', websiteId)
        .or(`indexing_status.neq.indexed,created_at.gte.${threeMonthsAgoISO}`)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (error) throw error

    // Normalize all deployments for backward compatibility
    const normalizedDeployments = (data || []).map(normalizeDeployment)

    return { deployments: normalizedDeployments, total: count }
}

const getDeploymentById = async (
    id: string
): Promise<DeploymentDetailResponse | null> => {
    const { data, error } = await db
        .from(Tables.DEPLOYMENTS)
        .select(
            `
            *,
            websites!inner (
                id,
                title,
                domain,
                clients!inner (
                    id,
                    firstname,
                    lastname
                )
            )
        `
        )
        .eq('id', id)
        .single()

    // Handle "no rows returned" as null, not an error
    if (error) {
        if (error.code === 'PGRST116') {
            return null
        }
        throw error
    }
    if (!data) return null

    // Extract nested data from Supabase response
    const { websites, ...deploymentFields } = data
    const websiteData = websites as {
        id: string
        title: string
        domain: string
        clients: {
            id: string
            firstname: string | null
            lastname: string | null
        }
    }

    // Normalize deployment and add website/client context
    const normalizedDeployment = normalizeDeployment(
        deploymentFields as DeploymentRecord
    )

    return {
        ...normalizedDeployment,
        website: {
            id: websiteData.id,
            title: websiteData.title,
            domain: websiteData.domain
        },
        client: {
            id: websiteData.clients.id,
            firstname: websiteData.clients.firstname,
            lastname: websiteData.clients.lastname
        }
    }
}

/**
 * Update deployment status (bulk update all URLs)
 * @param id Deployment ID
 * @param status Target status ('requested' or 'indexed')
 */
const updateDeploymentStatus = async (
    id: string,
    status: 'requested' | 'indexed'
) => {
    const deployment = await getDeploymentById(id)
    if (!deployment) {
        throw new Error('Deployment not found')
    }

    const now = new Date().toISOString()
    const urls = normalizeChangedUrls(deployment.changed_urls)

    // Update all URLs to the target status
    const updatedUrls: ChangedUrl[] = urls.map(urlObj => {
        // Validate status progression
        if (urlObj.indexing_status === 'indexed') {
            // Cannot go backward from indexed
            return urlObj
        }
        if (urlObj.indexing_status === 'requested' && status === 'requested') {
            // Already requested, no change needed
            return urlObj
        }

        if (status === 'requested') {
            return {
                ...urlObj,
                indexing_status: 'requested',
                indexing_requested_at: urlObj.indexing_requested_at || now
            }
        } else {
            // status === 'indexed'
            return {
                ...urlObj,
                indexing_status: 'indexed',
                indexing_requested_at: urlObj.indexing_requested_at || now,
                indexed_at: now
            }
        }
    })

    const deploymentStatus = calculateDeploymentStatus(updatedUrls)
    const timestamps = calculateDeploymentTimestamps(updatedUrls)

    const { data, error } = await db
        .from(Tables.DEPLOYMENTS)
        .update({
            changed_urls: updatedUrls,
            indexing_status: deploymentStatus,
            indexing_requested_at: timestamps.indexing_requested_at,
            indexed_at: timestamps.indexed_at
        })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return normalizeDeployment(data)
}

/**
 * Update a single URL's status within a deployment
 * @param deploymentId Deployment ID
 * @param url URL to update
 * @param status Target status ('requested' or 'indexed')
 */
const updateUrlStatus = async (
    deploymentId: string,
    url: string,
    status: 'requested' | 'indexed'
) => {
    const deployment = await getDeploymentById(deploymentId)
    if (!deployment) {
        throw new Error('Deployment not found')
    }

    const now = new Date().toISOString()
    const urls = normalizeChangedUrls(deployment.changed_urls)

    // Find the URL
    const urlIndex = urls.findIndex(u => u.url === url)
    if (urlIndex === -1) {
        throw { status: 404, message: 'URL not found in deployment' }
    }

    const currentUrl = urls[urlIndex]

    // Validate status progression
    if (currentUrl.indexing_status === 'indexed') {
        throw {
            status: 400,
            message: 'Cannot change status: URL is already indexed'
        }
    }
    if (currentUrl.indexing_status === 'requested' && status === 'requested') {
        // Already requested, return current state
        return normalizeDeployment(deployment)
    }

    // Update the specific URL
    const updatedUrls = [...urls]
    if (status === 'requested') {
        updatedUrls[urlIndex] = {
            ...currentUrl,
            indexing_status: 'requested',
            indexing_requested_at: currentUrl.indexing_requested_at || now
        }
    } else {
        // status === 'indexed'
        updatedUrls[urlIndex] = {
            ...currentUrl,
            indexing_status: 'indexed',
            indexing_requested_at: currentUrl.indexing_requested_at || now,
            indexed_at: now
        }
    }

    const deploymentStatus = calculateDeploymentStatus(updatedUrls)
    const timestamps = calculateDeploymentTimestamps(updatedUrls)

    const { data, error } = await db
        .from(Tables.DEPLOYMENTS)
        .update({
            changed_urls: updatedUrls,
            indexing_status: deploymentStatus,
            indexing_requested_at: timestamps.indexing_requested_at,
            indexed_at: timestamps.indexed_at
        })
        .eq('id', deploymentId)
        .select()
        .single()

    if (error) throw error
    return normalizeDeployment(data)
}

/**
 * Batch update multiple URLs' status within a deployment
 * @param deploymentId Deployment ID
 * @param urls Array of URLs to update
 * @param status Target status ('requested' or 'indexed')
 */
const updateUrlsBatchStatus = async (
    deploymentId: string,
    urls: string[],
    status: 'requested' | 'indexed'
) => {
    const deployment = await getDeploymentById(deploymentId)
    if (!deployment) {
        throw new Error('Deployment not found')
    }

    const now = new Date().toISOString()
    const currentUrls = normalizeChangedUrls(deployment.changed_urls)
    const urlSet = new Set(urls)

    // Validate all URLs exist
    const existingUrls = new Set(currentUrls.map(u => u.url))
    const missingUrls = urls.filter(u => !existingUrls.has(u))
    if (missingUrls.length > 0) {
        throw {
            status: 404,
            message: `URLs not found in deployment: ${missingUrls.join(', ')}`
        }
    }

    // Update the specified URLs
    const updatedUrls: ChangedUrl[] = currentUrls.map(urlObj => {
        if (!urlSet.has(urlObj.url)) {
            return urlObj
        }

        // Skip if already indexed (can't go backward)
        if (urlObj.indexing_status === 'indexed') {
            return urlObj
        }

        if (status === 'requested') {
            return {
                ...urlObj,
                indexing_status: 'requested',
                indexing_requested_at: urlObj.indexing_requested_at || now
            }
        } else {
            return {
                ...urlObj,
                indexing_status: 'indexed',
                indexing_requested_at: urlObj.indexing_requested_at || now,
                indexed_at: now
            }
        }
    })

    const deploymentStatus = calculateDeploymentStatus(updatedUrls)
    const timestamps = calculateDeploymentTimestamps(updatedUrls)

    const { data, error } = await db
        .from(Tables.DEPLOYMENTS)
        .update({
            changed_urls: updatedUrls,
            indexing_status: deploymentStatus,
            indexing_requested_at: timestamps.indexing_requested_at,
            indexed_at: timestamps.indexed_at
        })
        .eq('id', deploymentId)
        .select()
        .single()

    if (error) throw error
    return normalizeDeployment(data)
}

/**
 * Get deployments that are not fully indexed
 * Returns deployments with indexing_status of 'pending' or 'requested'
 */
const getUnindexedDeployments = async (limit: number = 50) => {
    const { data, error } = await db
        .from(Tables.DEPLOYMENTS)
        .select('*')
        .neq('indexing_status', 'indexed')
        .order('created_at', { ascending: false })
        .limit(limit)

    if (error) throw error

    // Normalize all deployments for backward compatibility
    return (data || []).map(normalizeDeployment)
}

// Legacy function names for backward compatibility during migration
const markAsIndexed = async (id: string, _payload: { indexed_at: Date }) => {
    return updateDeploymentStatus(id, 'indexed')
}

const markUrlAsIndexed = async (deploymentId: string, url: string) => {
    return updateUrlStatus(deploymentId, url, 'indexed')
}

export default {
    createDeployment,
    getDeploymentsByWebsiteId,
    getDeploymentById,
    updateDeploymentStatus,
    updateUrlStatus,
    updateUrlsBatchStatus,
    getUnindexedDeployments,
    // Legacy exports for backward compatibility
    markAsIndexed,
    markUrlAsIndexed
}

// Export types for use in controller
export type {
    IndexingStatus,
    ChangedUrl,
    DeploymentRecord,
    DeploymentDetailResponse
}
