import { feedbackReplyDomain } from './domani-feedback-inbound'
import { domaniDb } from '../lib/domani-db'
import { FeedbackQuery, FeedbackSource } from '../lib/domani-feedback'

export const listFeedback = async (query: FeedbackQuery, actorId: string) => {
    const { data, error } = await domaniDb.rpc('list_dashboard_domani_feedback_with_conversations', { p_query: query, p_actor_id: actorId })
    if (error) throw error
    if (query.user_id && (data?.user_id !== query.user_id || !Array.isArray(data?.items) || data.items.some((item: { user_id?: string }) => item.user_id !== query.user_id))) {
        throw Object.assign(new Error('User feedback scope unavailable'), { code: 'FEEDBACK_SCOPE_UNAVAILABLE' })
    }
    return data
}

export const getFeedback = async (source: FeedbackSource, id: string, actorId: string) => {
    const { data, error } = await domaniDb.rpc('get_dashboard_domani_feedback', {
        p_source: source, p_id: id, p_actor_id: actorId,
    })
    if (error) throw error
    return data
}

export const listMessages = async (source: FeedbackSource, id: string, actorId: string, query: { limit: number; after?: string; before?: string; latest?: string }) => {
    const latest = query.latest === 'true' || !!query.before
    const { data, error } = await domaniDb.rpc(latest ? 'list_domani_feedback_messages_latest' : 'list_domani_feedback_messages', {
        p_source: source, p_id: id, p_actor_id: actorId, p_limit: query.limit,
        ...(latest ? { p_before: query.before ?? null } : { p_after: query.after ?? null }),
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

export const submitReply = async (source: FeedbackSource, id: string, actor: { userId: string; email: string }, body: { subject: string; text: string; request_key: string }, html: string) => {
    const { data, error } = await domaniDb.rpc('submit_domani_feedback_reply', {
        p_source: source, p_id: id, p_actor_id: actor.userId, p_actor_email: actor.email,
        ...(feedbackReplyDomain() ? { p_reply_domain: feedbackReplyDomain() } : {}),
        p_subject: body.subject, p_text: body.text, p_request_key: body.request_key, p_html: html,
    })
    if (error) throw error
    return data
}
export const replyState = async (source: FeedbackSource, id: string, key: string, retry = false) => {
    const { data, error } = await domaniDb.rpc(retry ? 'retry_domani_feedback_reply' : 'domani_feedback_reply_state', {
        p_source: source, p_id: id, p_key: key,
    })
    if (error) throw error
    return data
}
