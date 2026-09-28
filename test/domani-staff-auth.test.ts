import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'

const { verifyPvsAccessToken } = vi.hoisted(() => ({ verifyPvsAccessToken: vi.fn() }))
vi.mock('../src/lib/pvs-auth', async importOriginal => ({
    ...(await importOriginal<typeof import('../src/lib/pvs-auth')>()),
    verifyPvsAccessToken
}))
import { PvsAuthRequestError } from '../src/lib/pvs-auth'
import { requireDomaniStaff } from '../src/middleware/domani-staff-auth'

const run = async (headers: Record<string, string> = { authorization: 'Bearer token' }) => {
    const req = { get: (name: string) => headers[name] } as Request
    const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() } as unknown as Response
    vi.mocked(res.status).mockReturnValue(res)
    const next = vi.fn()
    await requireDomaniStaff(req, res, next)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    return { req, res, next }
}

beforeEach(() => {
    verifyPvsAccessToken.mockReset()
    process.env.DOMANI_DASHBOARD_STAFF_EMAILS = ' Staff@pvs.test, second@pvs.test '
    delete process.env.PVS_DASHBOARD_ORIGINS
    verifyPvsAccessToken.mockResolvedValue({ id: 'staff-id', email: 'STAFF@pvs.test' })
})

describe('Domani staff authorization', () => {
    it('authorizes a verified PVS identity against a case-normalized explicit allowlist', async () => {
        const { req, next } = await run()
        expect(verifyPvsAccessToken).toHaveBeenCalledWith('token')
        expect(req.dashboardActor).toEqual({ userId: 'staff-id', email: 'staff@pvs.test', role: 'admin' })
        expect(next).toHaveBeenCalledOnce()
    })
    it.each([undefined, '', ' , '])('fails closed when the staff allowlist is empty (%s)', async value => {
        if (value === undefined) delete process.env.DOMANI_DASHBOARD_STAFF_EMAILS
        else process.env.DOMANI_DASHBOARD_STAFF_EMAILS = value
        const { res, next } = await run()
        expect(res.status).toHaveBeenCalledWith(503)
        expect(verifyPvsAccessToken).not.toHaveBeenCalled()
        expect(next).not.toHaveBeenCalled()
    })
    it.each([{}, { authorization: 'Basic token' }, { authorization: 'Bearer token extra' }])('rejects absent or malformed authentication', async headers => {
        const { res, next } = await run(headers)
        expect(res.status).toHaveBeenCalledWith(401)
        expect(verifyPvsAccessToken).not.toHaveBeenCalled()
        expect(next).not.toHaveBeenCalled()
    })
    it('rejects invalid or expired tokens with a structured error', async () => {
        verifyPvsAccessToken.mockRejectedValue(new PvsAuthRequestError(401))
        const { res, next } = await run()
        expect(res.status).toHaveBeenCalledWith(401)
        expect(res.json).toHaveBeenCalledWith({ error: { code: 'AUTH_INVALID', message: 'Access token is invalid or expired' }, message: 'Access token is invalid or expired' })
        expect(next).not.toHaveBeenCalled()
    })
    it('does not authorize a nonstaff user through user-editable metadata', async () => {
        verifyPvsAccessToken.mockResolvedValue({ id: 'other', email: 'other@pvs.test' })
        const { req, res, next } = await run()
        expect(res.status).toHaveBeenCalledWith(403)
        expect(req.dashboardActor).toBeUndefined()
        expect(next).not.toHaveBeenCalled()
    })
    it('rejects a token without an active verified user', async () => {
        verifyPvsAccessToken.mockResolvedValue(null)
        const { res, next } = await run()
        expect(res.status).toHaveBeenCalledWith(401)
        expect(next).not.toHaveBeenCalled()
    })
    it('fails closed when the identity service is unavailable', async () => {
        verifyPvsAccessToken.mockRejectedValue(new Error('private upstream information'))
        const { res, next } = await run()
        expect(res.status).toHaveBeenCalledWith(503)
        expect(res.json).toHaveBeenCalledWith({ error: { code: 'AUTH_UNAVAILABLE', message: 'Unable to verify dashboard access' }, message: 'Unable to verify dashboard access' })
        expect(next).not.toHaveBeenCalled()
    })
    it('returns a structured service error when token verification times out', async () => {
        verifyPvsAccessToken.mockRejectedValue(new PvsAuthRequestError(503))
        const { res, next } = await run()
        expect(res.status).toHaveBeenCalledWith(503)
        expect(res.json).toHaveBeenCalledWith({
            error: { code: 'AUTH_UNAVAILABLE', message: 'Unable to verify dashboard access' },
            message: 'Unable to verify dashboard access',
        })
        expect(next).not.toHaveBeenCalled()
    })
    it.each(['https://evil.test', 'null', 'https://dashboard.pvs.test.evil.test'])('rejects disallowed browser origin %s before verification', async origin => {
        process.env.PVS_DASHBOARD_ORIGINS = 'https://dashboard.pvs.test'
        const { res, next } = await run({ authorization: 'Bearer token', origin })
        expect(res.status).toHaveBeenCalledWith(403)
        expect(verifyPvsAccessToken).not.toHaveBeenCalled()
        expect(next).not.toHaveBeenCalled()
    })
    it('denies browser origins when no origin allowlist is configured', async () => {
        const { res } = await run({ authorization: 'Bearer token', origin: 'https://dashboard.pvs.test' })
        expect(res.status).toHaveBeenCalledWith(403)
    })
    it('accepts an explicitly configured browser origin', async () => {
        process.env.PVS_DASHBOARD_ORIGINS = 'https://other.test, https://dashboard.pvs.test '
        const { next } = await run({ authorization: 'bearer token', origin: 'https://dashboard.pvs.test' })
        expect(next).toHaveBeenCalledOnce()
    })
})
