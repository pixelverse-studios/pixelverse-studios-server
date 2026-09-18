import { describe, expect, it, vi } from 'vitest'
import { adminReleaseCors } from '../src/middleware/admin-release-cors'

function preflight(origin: string, method: string) {
    const headers: Record<string, string> = {}
    const next = vi.fn()
    const res = {
        setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value },
        getHeader: (name: string) => headers[name.toLowerCase()],
        end: vi.fn(),
        statusCode: 0
    }
    adminReleaseCors({ method: 'OPTIONS', headers: { origin,
        'access-control-request-method': method,
        'access-control-request-headers': 'authorization,content-type,if-match'
    }} as any, res as any, next)
    return { headers, res, next }
}

describe('shared Releases CORS', () => {
    it.each(['GET', 'POST', 'PATCH'])('allows authenticated dashboard %s preflights', method => {
        const { headers, res, next } = preflight('https://pixelversestudios.io', method)
        expect(res.statusCode).toBe(204)
        expect(res.end).toHaveBeenCalledOnce()
        expect(next).not.toHaveBeenCalled()
        expect(headers['access-control-allow-origin']).toBe('https://pixelversestudios.io')
        expect(headers['access-control-allow-methods'].split(',')).toContain(method)
        expect(headers['access-control-allow-headers']).toContain('If-Match')
        expect(headers['access-control-allow-credentials']).toBeUndefined()
    })
    it('does not allow unrelated origins or suffix matches', () => {
        for (const origin of ['https://example.com', 'https://pixelversestudios.io.example.com']) {
            const { headers, next } = preflight(origin, 'PATCH')
            expect(headers['access-control-allow-origin']).toBeUndefined()
            expect(next).toHaveBeenCalledOnce()
        }
    })
})
