import { z } from 'zod'

export const feedbackSources = ['beta_feedback', 'support_request'] as const
export const feedbackStatuses = ['new', 'reviewed', 'resolved'] as const
export const feedbackCategories = ['bug', 'feature', 'love', 'general', 'support', 'unknown'] as const
export type FeedbackSource = typeof feedbackSources[number]

const validCalendarDate = (value: string) => {
    const date = value.slice(0, 10)
    return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
}
const dateValue = z.union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.string().datetime({ offset: true }),
]).refine(validCalendarDate, 'Use a valid calendar date')
const timestamp = dateValue.transform(value => new Date(value).toISOString())
const integer = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])

export const feedbackQuerySchema = z.object({
    user_id: z.string().uuid().transform(value => value.toLowerCase()).optional(),
    category: z.enum(feedbackCategories).optional(),
    status: z.enum([...feedbackStatuses, 'unknown']).optional(),
    platform: z.enum(['ios', 'android', 'unknown']).optional(),
    source: z.enum(feedbackSources).optional(),
    search: z.string().trim().max(200).optional(),
    start_date: timestamp.optional(),
    end_date: dateValue.optional(),
    limit: integer.pipe(z.number().int().min(1).max(100)).default(50),
    offset: integer.pipe(z.number().int().min(0).max(1000000)).default(0),
    sort_by: z.enum(['created_at', 'status']).default('created_at'),
    sort_order: z.enum(['asc', 'desc']).default('desc'),
}).strict().refine(value => {
    if (!value.start_date || !value.end_date) return true
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.end_date)
    const end = Date.parse(value.end_date) + (dateOnly ? 86400000 : 0)
    return dateOnly ? Date.parse(value.start_date) < end : Date.parse(value.start_date) <= end
}, { message: 'start_date must be before end_date', path: ['end_date'] }).transform(value => {
    if (!value.end_date) return value
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.end_date)
    return {
        ...value,
        end_date: new Date(Date.parse(value.end_date) + (dateOnly ? 86400000 : 0)).toISOString(),
        ...(dateOnly ? { end_date_exclusive: true } : {}),
    }
})

export const feedbackIdentitySchema = z.object({
    source: z.enum(feedbackSources), id: z.string().uuid(),
})
export const feedbackStatusSchema = z.object({ status: z.enum(feedbackStatuses) }).strict()
export type FeedbackQuery = z.infer<typeof feedbackQuerySchema>

export const feedbackHistorySchema = z.object({
    limit: integer.pipe(z.number().int().min(1).max(100)).default(50),
    after: z.string().uuid().optional(),
    before: z.string().uuid().optional(),
    latest: z.enum(['true', 'false']).optional(),
}).strict().refine(value => !(value.after && (value.before || value.latest === 'true')), 'Choose one pagination direction')
export const feedbackReadSchema = z.object({ message_id: z.string().uuid() }).strict()

export const feedbackReplySchema = z.object({
    subject: z.string().min(1).max(200).refine(value => !!value.trim() && !/[\r\n]/.test(value)),
    text: z.string().min(1).max(20000).refine(value => !!value.trim()),
    request_key: z.string().uuid(),
}).strict()
export const feedbackReplyKeySchema = z.object({ requestKey: z.string().uuid() })
