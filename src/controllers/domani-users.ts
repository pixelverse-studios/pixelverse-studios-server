import { Request, Response } from 'express'
import { z, ZodError } from 'zod'
import { userQuerySchema } from '../lib/domani-users'
import { listUsers } from '../services/domani-users'
const fail = (res: Response, error: unknown) => {
    if (error instanceof ZodError)
        return res
            .status(400)
            .json({
                error: {
                    code: 'INVALID_REQUEST',
                    message: 'Invalid user query'
                }
            })
    console.error('Domani user insights unavailable', {
        code: (error as { code?: string })?.code || 'UNKNOWN'
    })
    return res
        .status(503)
        .json({
            error: {
                code: 'USERS_UNAVAILABLE',
                message: 'User insights unavailable'
            }
        })
}
export async function list(req: Request, res: Response) {
    try {
        return res.json(await listUsers(userQuerySchema.parse(req.query)))
    } catch (e) {
        return fail(res, e)
    }
}
export async function stats(req: Request, res: Response) {
    try {
        const r = await listUsers({
            ...userQuerySchema.parse(req.query),
            include_deleted: true,
            limit: 1,
            offset: 0
        })
        return res.json({ ...r.stats, data_as_of: r.data_as_of })
    } catch (e) {
        return fail(res, e)
    }
}
export async function detail(req: Request, res: Response) {
    try {
        const id = z.string().uuid().parse(req.params.id)
        const r = await listUsers({
            id,
            include_deleted: true,
            limit: 1,
            offset: 0
        })
        return r.items[0]
            ? res.json({ ...r.items[0], data_as_of: r.data_as_of })
            : res
                  .status(404)
                  .json({
                      error: {
                          code: 'USER_NOT_FOUND',
                          message: 'User not found'
                      }
                  })
    } catch (e) {
        return fail(res, e)
    }
}
