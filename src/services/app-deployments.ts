import { db, Tables, COLUMNS } from '../lib/db'

type DeploymentStatus =
    | 'pending'
    | 'deploying'
    | 'deployed'
    | 'failed'
    | 'rolled_back'
type Environment = 'development' | 'staging' | 'production'

interface AppDeploymentPayload {
    app_id: string
    version: string
    environment?: Environment
    deploy_summary: string
    commit_sha?: string
    commit_url?: string
    internal_notes?: string
    deployed_by?: string
}

interface AppDeploymentRecord {
    id: string
    app_id: string
    version: string
    environment: Environment
    deploy_summary: string
    commit_sha: string | null
    commit_url: string | null
    internal_notes: string | null
    status: DeploymentStatus
    deployed_by: string | null
    created_at: string
    deployed_at: string | null
    rolled_back_at: string | null
    rollback_reason: string | null
}

interface AppContext {
    id: string
    name: string
    app_slug: string
}

interface ClientContext {
    id: string
    firstname: string | null
    lastname: string | null
}

interface AppDeploymentDetailResponse extends AppDeploymentRecord {
    app: AppContext
    client: ClientContext
}

const createDeployment = async (payload: AppDeploymentPayload) => {
    const { data, error } = await db
        .from(Tables.APP_DEPLOYMENTS)
        .insert([
            {
                app_id: payload.app_id,
                version: payload.version,
                environment: payload.environment || 'production',
                deploy_summary: payload.deploy_summary,
                commit_sha: payload.commit_sha,
                commit_url: payload.commit_url,
                internal_notes: payload.internal_notes,
                deployed_by: payload.deployed_by,
                status: 'deployed',
                deployed_at: new Date().toISOString()
            }
        ])
        .select()
        .single()

    if (error) throw error
    return data
}

const getDeploymentsByAppId = async (
    appId: string,
    limit: number = 20,
    offset: number = 0,
    environment?: Environment
) => {
    let query = db
        .from(Tables.APP_DEPLOYMENTS)
        .select('*', { count: 'exact' })
        .eq(COLUMNS.APP_ID, appId)

    if (environment) {
        query = query.eq('environment', environment)
    }

    const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (error) throw error
    return { deployments: data || [], total: count }
}

const getDeploymentById = async (
    id: string
): Promise<AppDeploymentDetailResponse | null> => {
    const { data, error } = await db
        .from(Tables.APP_DEPLOYMENTS)
        .select(
            `
            *,
            apps!inner (
                id,
                name,
                app_slug,
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

    if (error) {
        if (error.code === 'PGRST116') return null
        throw error
    }

    if (!data) return null

    // Restructure response
    const { apps, ...deploymentFields } = data
    const appData = apps as {
        id: string
        name: string
        app_slug: string
        clients: {
            id: string
            firstname: string | null
            lastname: string | null
        }
    }

    return {
        ...(deploymentFields as AppDeploymentRecord),
        app: {
            id: appData.id,
            name: appData.name,
            app_slug: appData.app_slug
        },
        client: appData.clients
    }
}

const updateStatus = async (
    id: string,
    status: DeploymentStatus,
    additionalFields?: { rollback_reason?: string }
) => {
    const updatePayload: Record<string, unknown> = { status }

    if (status === 'deployed') {
        updatePayload.deployed_at = new Date().toISOString()
    } else if (status === 'rolled_back') {
        updatePayload.rolled_back_at = new Date().toISOString()
        if (additionalFields?.rollback_reason) {
            updatePayload.rollback_reason = additionalFields.rollback_reason
        }
    }

    const { data, error } = await db
        .from(Tables.APP_DEPLOYMENTS)
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

const getLatestByEnvironment = async (appId: string) => {
    const environments: Environment[] = ['development', 'staging', 'production']
    const results: Record<string, AppDeploymentRecord | null> = {}

    for (const env of environments) {
        const { data, error } = await db
            .from(Tables.APP_DEPLOYMENTS)
            .select('*')
            .eq(COLUMNS.APP_ID, appId)
            .eq('environment', env)
            .eq('status', 'deployed')
            .order('deployed_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (error) throw error
        results[env] = data
    }

    return results
}

const getActiveDeployments = async (limit: number = 50) => {
    const { data, error } = await db
        .from(Tables.APP_DEPLOYMENTS)
        .select(
            `
            *,
            apps (
                id,
                name,
                app_slug
            )
        `
        )
        .in('status', ['pending', 'deploying'])
        .order('created_at', { ascending: false })
        .limit(limit)

    if (error) throw error
    return data || []
}

export default {
    createDeployment,
    getDeploymentsByAppId,
    getDeploymentById,
    updateStatus,
    getLatestByEnvironment,
    getActiveDeployments
}

export type {
    DeploymentStatus,
    Environment,
    AppDeploymentPayload,
    AppDeploymentRecord,
    AppDeploymentDetailResponse
}
