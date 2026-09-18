import { domaniDb } from '../lib/domani-db'
import { FeedbackQuery, FeedbackSource } from '../lib/domani-feedback'

export const listFeedback = async (query: FeedbackQuery, actorId: string) => {
    const { data, error } = await domaniDb.rpc('list_dashboard_domani_feedback_with_conversations', { p_query: query, p_actor_id: actorId })
    if (error) throw error
    return data
}

export const getFeedback = async (source: FeedbackSource, id: string, actorId: string) => {
    const { data, error } = await domaniDb.rpc('get_dashboard_domani_feedback', {
        p_source: source, p_id: id, p_actor_id: actorId,
    })
    if (error) throw error
    return data
}

export const listMessages = async (source: FeedbackSource, id: string, actorId: string, query: { limit: number; after?: string }) => {
    const { data, error } = await domaniDb.rpc('list_domani_feedback_messages', {
        p_source: source, p_id: id, p_actor_id: actorId, p_limit: query.limit, p_after: query.after ?? null,
    })
    if (error) throw error
    return data
}

export const markRead = async (source: FeedbackSource, id: string, actorId: string, messageId: string) => {
    const { data, error } = await domaniDb.rpc('mark_domani_feedback_read', {
        p_source: source, p_id: id, p_actor_id: actorId, p_message_id: messageId,
    })
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
