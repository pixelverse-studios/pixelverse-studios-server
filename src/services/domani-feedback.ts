import { domaniDb, DomaniTables } from '../lib/domani-db'
import { FeedbackQuery, FeedbackSource } from '../lib/domani-feedback'

export const listFeedback = async (query: FeedbackQuery) => {
    const { data, error } = await domaniDb.rpc('list_dashboard_domani_feedback', { p_query: query })
    if (error) throw error
    return data
}

export const getFeedback = async (source: FeedbackSource, id: string) => {
    const { data, error } = await domaniDb.from(DomaniTables.DASHBOARD_FEEDBACK)
        .select('*').eq('source', source).eq('id', id).maybeSingle()
    if (error) throw error
    return data
}

export const changeFeedbackStatus = async (
    source: FeedbackSource, id: string, status: string,
    actor: { userId: string; email: string },
) => {
    const { data, error } = await domaniDb.rpc('set_dashboard_domani_feedback_status', {
        p_source: source, p_id: id, p_status: status,
        p_actor_id: actor.userId, p_actor_email: actor.email,
    })
    if (error) throw error
    return data
}
