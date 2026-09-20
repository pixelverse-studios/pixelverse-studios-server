import { domaniDb } from '../lib/domani-db'
import { UserQuery } from '../lib/domani-users'
export async function listUsers(query: Partial<UserQuery> & { id?: string }) {
    const { data, error } = await domaniDb.rpc('list_dashboard_domani_users', {
        p_query: query
    })
    if (error) throw error
    return data
}
