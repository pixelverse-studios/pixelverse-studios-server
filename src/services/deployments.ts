import { db, Tables } from '../lib/db'

interface UrlWithStatus {
    url: string
    indexed_at: string | null
}

interface DeploymentPayload {
    website_id: string
    changed_urls: string[]
    deploy_summary: string
    internal_notes?: string
}

interface UpdateIndexedPayload {
    indexed_at: Date
}

const createDeployment = async (payload: DeploymentPayload) => {
    try {
        // Convert string array to array of objects with indexed_at
        const urlsWithStatus: UrlWithStatus[] = payload.changed_urls.map(url => ({
            url,
            indexed_at: null
        }))

        const { data, error} = await db
            .from(Tables.DEPLOYMENTS)
            .insert([
                {
                    website_id: payload.website_id,
                    changed_urls: urlsWithStatus,
                    deploy_summary: payload.deploy_summary,
                    internal_notes: payload.internal_notes
                }
            ])
            .select()
            .single()

        if (error) throw error
        return data
    } catch (error) {
        throw error
    }
}

const getDeploymentsByWebsiteId = async (
    websiteId: string,
    limit: number = 20,
    offset: number = 0
) => {
    try {
        // Calculate date 3 months ago
        const threeMonthsAgo = new Date()
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
        const threeMonthsAgoISO = threeMonthsAgo.toISOString()

        // Return unindexed deployments (any age) OR indexed deployments from past 3 months
        const { data, error, count } = await db
            .from(Tables.DEPLOYMENTS)
            .select('*', { count: 'exact' })
            .eq('website_id', websiteId)
            .or(`indexed_at.is.null,created_at.gte.${threeMonthsAgoISO}`)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (error) throw error
        return { deployments: data, total: count }
    } catch (error) {
        throw error
    }
}

const getDeploymentById = async (id: string) => {
    try {
        const { data, error } = await db
            .from(Tables.DEPLOYMENTS)
            .select('*')
            .eq('id', id)
            .single()

        if (error) throw error
        return data
    } catch (error) {
        throw error
    }
}

const markAsIndexed = async (id: string, payload: UpdateIndexedPayload) => {
    try {
        // Get the deployment
        const deployment = await getDeploymentById(id)
        if (!deployment) {
            throw new Error('Deployment not found')
        }

        // Mark all URLs as indexed
        const now = new Date().toISOString()
        const updatedUrls = (deployment.changed_urls as UrlWithStatus[]).map(
            urlObj => ({
                ...urlObj,
                indexed_at: now
            })
        )

        // Update deployment with all URLs marked and deployment itself marked
        const { data, error } = await db
            .from(Tables.DEPLOYMENTS)
            .update({
                changed_urls: updatedUrls,
                indexed_at: payload.indexed_at
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    } catch (error) {
        throw error
    }
}

const getUnindexedDeployments = async (limit: number = 50) => {
    try {
        const { data, error } = await db
            .from(Tables.DEPLOYMENTS)
            .select('*')
            .is('indexed_at', null)
            .order('created_at', { ascending: false })
            .limit(limit)

        if (error) throw error
        return data
    } catch (error) {
        throw error
    }
}

const markUrlAsIndexed = async (deploymentId: string, url: string) => {
    try {
        // Get the deployment
        const deployment = await getDeploymentById(deploymentId)
        if (!deployment) {
            throw new Error('Deployment not found')
        }

        // Update the specific URL's indexed_at
        const updatedUrls = (deployment.changed_urls as UrlWithStatus[]).map(
            urlObj =>
                urlObj.url === url
                    ? { ...urlObj, indexed_at: new Date().toISOString() }
                    : urlObj
        )

        // Check if all URLs are now indexed
        const allIndexed = updatedUrls.every(urlObj => urlObj.indexed_at !== null)

        // Update the deployment
        const { data, error } = await db
            .from(Tables.DEPLOYMENTS)
            .update({
                changed_urls: updatedUrls,
                indexed_at: allIndexed ? new Date().toISOString() : deployment.indexed_at
            })
            .eq('id', deploymentId)
            .select()
            .single()

        if (error) throw error
        return data
    } catch (error) {
        throw error
    }
}

export default {
    createDeployment,
    getDeploymentsByWebsiteId,
    getDeploymentById,
    markAsIndexed,
    markUrlAsIndexed,
    getUnindexedDeployments
}
