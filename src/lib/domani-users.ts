import { z } from 'zod'
const integer = z.union([
    z.number(),
    z.string().regex(/^\d+$/).transform(Number)
])
const date = z
    .union([
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        z.string().datetime({ offset: true })
    ])
    .refine(
        v =>
            Number.isFinite(Date.parse(v)) &&
            (v.length !== 10 || new Date(v).toISOString().slice(0, 10) === v),
        'Invalid date'
    )
export const userQuerySchema = z
    .object({
        search: z.string().trim().max(200).optional(),
        cohort: z
            .enum(['friends_family', 'early_adopter', 'general'])
            .optional(),
        include_deleted: z
            .enum(['true', 'false'])
            .default('false')
            .transform(v => v === 'true'),
        provider: z
            .string()
            .min(1)
            .max(50)
            .regex(/^[a-zA-Z0-9_-]+$/)
            .optional(),
        account_status: z
            .enum([
                'active',
                'deletion_pending',
                'deleted',
                'banned',
                'unknown'
            ])
            .optional(),
        verification: z.enum(['verified', 'unverified', 'unknown']).optional(),
        platform: z.enum(['ios', 'android', 'unknown']).optional(),
        app_version: z.string().trim().min(1).max(100).optional(),
        activity: z.enum(['recent', 'older', 'unknown']).optional(),
        start_date: date.optional(),
        end_date: date.optional(),
        sort_by: z
            .enum([
                'joined_at',
                'created_at',
                'last_sign_in_at',
                'last_active_at',
                'email',
                'full_name',
                'account_status'
            ])
            .default('joined_at'),
        sort_order: z.enum(['asc', 'desc']).default('desc'),
        limit: integer.pipe(z.number().int().min(1).max(100)).default(50),
        offset: integer.pipe(z.number().int().min(0).max(1000000)).default(0)
    })
    .strict()
    .transform(v => ({
        ...v,
        start_date: v.start_date
            ? new Date(v.start_date).toISOString()
            : undefined,
        end_date: v.end_date
            ? new Date(
                  Date.parse(v.end_date) +
                      (v.end_date.length === 10 ? 86400000 : 0)
              ).toISOString()
            : undefined
    }))
    .refine(
        v =>
            !v.start_date ||
            !v.end_date ||
            Date.parse(v.start_date) < Date.parse(v.end_date),
        'Invalid date range'
    )
export type UserQuery = z.infer<typeof userQuerySchema>
