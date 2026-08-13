import express, { NextFunction, Request, Response } from 'express'
import { request as httpRequest } from 'http'
import { AddressInfo } from 'net'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
    getUser: vi.fn(),
    rpc: vi.fn()
}))

vi.mock('../src/lib/db', () => ({
    db: { auth: { getUser: mockState.getUser } }
}))

vi.mock('../src/lib/domani-db', () => ({
    domaniDb: { rpc: mockState.rpc }
}))

import { importMarkdown } from '../src/controllers/admin-release-import'
import {
    normalizeImportMarkdownRequest,
    parseIfMatch
} from '../src/lib/admin-releases'
import { requireDashboardActor } from '../src/middleware/admin-release-auth'
import adminReleaseImportRouter, {
    parseImportBody
} from '../src/routes/admin-release-import'

const actorId = '71000000-0000-4000-8000-000000000001'
const releaseId = '72000000-0000-4000-8000-000000000001'

const importedResult = (duplicate = false) => ({
    release: {
        id: releaseId,
        version: '1.2.0',
        slug: 'domani-1-2',
        title: 'Domani 1.2',
        releaseType: 'minor',
        lifecycleStatus: 'draft',
        visibility: 'private',
        publicSummary: null,
        internalSummary: null,
        targetMonth: null,
        targetDate: null,
        confirmedDate: null,
        releasedAt: null,
        ownerUserId: null,
        rowVersion: duplicate ? 1 : 2,
        createdAt: '2026-08-07T14:00:00Z',
        updatedAt: '2026-08-07T14:01:00Z',
        archivedAt: null
    },
    source: {
        id: '73000000-0000-4000-8000-000000000001',
        releaseId,
        rawMarkdown: '# Domani',
        originalFilename: 'domani.md',
        sourceType: 'linear_epic',
        sourceReference: 'DEV-1004',
        sourceContentSha256: 'a'.repeat(64),
        intendedSurface: 'changelog',
        conversionStatus: 'raw',
        latestConversionRunId: null,
        conversionErrorCode: null,
        conversionErrorMessage: null,
        rowVersion: 1,
        createdAt: '2026-08-07T14:01:00Z',
        updatedAt: '2026-08-07T14:01:00Z'
    },
    duplicate
})

const request = ({
    body = {},
    contentType = 'application/json',
    authorization = 'Bearer valid-token',
    ifMatch,
    file
}: {
    body?: Record<string, unknown>
    contentType?: string
    authorization?: string
    ifMatch?: string
    file?: Express.Multer.File
} = {}): Request => {
    const headers: Record<string, string | undefined> = {
        authorization,
        'content-type': contentType,
        'if-match': ifMatch
    }
    return {
        body,
        file,
        headers,
        requestId: 'request-1008',
        get: vi.fn((name: string) => headers[name.toLowerCase()]),
        is: vi.fn((type: string) => {
            const actual = contentType.split(';')[0]
            return actual === type ? type : false
        })
    } as unknown as Request
}

const response = () => {
    const headers: Record<string, string> = {}
    const res = {
        statusCode: 200,
        payload: undefined as any,
        setHeader: vi.fn((name: string, value: string) => {
            headers[name.toLowerCase()] = value
            return res
        }),
        getHeader: vi.fn((name: string) => headers[name.toLowerCase()]),
        status: vi.fn((status: number) => {
            res.statusCode = status
            return res
        }),
        json: vi.fn((payload: unknown) => {
            res.payload = payload
            return res
        }),
        headers
    }
    return res as unknown as Response & typeof res
}

const markdownFile = (
    filename: string,
    buffer: Buffer,
    mimetype = 'application/octet-stream'
): Express.Multer.File => ({
    fieldname: 'file',
    originalname: filename,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
    destination: '',
    filename,
    path: '',
    stream: undefined as never
})

beforeEach(() => {
    mockState.getUser.mockReset().mockResolvedValue({
        data: { user: { id: actorId, email: 'Editor@Example.com' } },
        error: null
    })
    mockState.rpc
        .mockReset()
        .mockResolvedValue({ data: importedResult(), error: null })
})

describe('DEV-1008 admin release authentication', () => {
    it('reuses the PVS dashboard token and normalizes the verified identity', async () => {
        const req = request()
        const res = response()
        const next = vi.fn()
        await requireDashboardActor(req, res, next)

        expect(next).toHaveBeenCalledOnce()
        expect(req.dashboardActor).toEqual({
            userId: actorId,
            email: 'editor@example.com',
            role: 'admin'
        })
        expect(mockState.getUser).toHaveBeenCalledWith('valid-token')
    })

    it('rejects missing or invalid PVS dashboard tokens', async () => {
        const missingRes = response()
        await requireDashboardActor(
            request({ authorization: '' }),
            missingRes,
            vi.fn()
        )
        expect(missingRes.statusCode).toBe(401)
        expect(missingRes.payload.error.code).toBe('AUTH_REQUIRED')

        mockState.getUser.mockResolvedValueOnce({
            data: { user: null },
            error: new Error('bad')
        })
        const invalidRes = response()
        await requireDashboardActor(request(), invalidRes, vi.fn())
        expect(invalidRes.payload.error.code).toBe('AUTH_INVALID')
    })
})

describe('DEV-1008 Markdown input validation', () => {
    it('accepts a real authenticated multipart request through Express and Multer', async () => {
        const app = express()
        app.use((req, _res, next) => {
            req.requestId = 'request-1008-http'
            next()
        })
        app.use(adminReleaseImportRouter)

        const server = app.listen(0, '127.0.0.1')
        await new Promise<void>((resolve, reject) => {
            server.once('listening', resolve)
            server.once('error', reject)
        })

        try {
            const address = server.address() as AddressInfo
            const boundary = 'dev-1008-boundary'
            const field = (name: string, value: string) =>
                `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
            const multipartBody = Buffer.from(
                `--${boundary}\r\n` +
                    'Content-Disposition: form-data; name="file"; filename="domani.md"\r\n' +
                    'Content-Type: text/plain\r\n\r\n' +
                    '# Domani multipart\r\n' +
                    field('releaseVersion', '1.2.0') +
                    field('releaseTitle', 'Domani 1.2') +
                    field('releaseSlug', 'domani-1-2') +
                    field('sourceType', 'linear_epic') +
                    field('sourceReference', 'DEV-1004') +
                    `--${boundary}--\r\n`
            )
            const httpResponse = await new Promise<{
                status: number
                body: string
            }>((resolve, reject) => {
                const outgoing = httpRequest(
                    {
                        host: '127.0.0.1',
                        port: address.port,
                        path: '/api/admin/releases/import-markdown',
                        method: 'POST',
                        headers: {
                            Authorization: 'Bearer valid-token',
                            'Content-Type': `multipart/form-data; boundary=${boundary}`,
                            'Content-Length': multipartBody.length
                        }
                    },
                    incoming => {
                        const chunks: Buffer[] = []
                        incoming.on('data', chunk =>
                            chunks.push(Buffer.from(chunk))
                        )
                        incoming.on('end', () =>
                            resolve({
                                status: incoming.statusCode || 0,
                                body: Buffer.concat(chunks).toString('utf8')
                            })
                        )
                    }
                )
                outgoing.on('error', reject)
                outgoing.end(multipartBody)
            })
            const payload = JSON.parse(httpResponse.body) as {
                data: { duplicate: boolean }
            }

            expect(httpResponse.status).toBe(201)
            expect(payload.data.duplicate).toBe(false)
            expect(mockState.getUser).toHaveBeenCalledWith('valid-token')
            expect(mockState.rpc).toHaveBeenCalledWith(
                'import_domani_release_markdown',
                expect.objectContaining({
                    p_raw_markdown: '# Domani multipart',
                    p_original_filename: 'domani.md',
                    p_source_type: 'linear_epic',
                    p_source_reference: 'DEV-1004'
                })
            )
        } finally {
            await new Promise<void>((resolve, reject) => {
                server.close(error => (error ? reject(error) : resolve()))
            })
        }
    })

    it('normalizes JSON create fields, defaults conversion settings, and parses If-Match', () => {
        const normalized = normalizeImportMarkdownRequest(
            request({
                body: {
                    markdown: '# Domani',
                    filename: 'folder/domani.md',
                    releaseVersion: '1.2.0',
                    releaseTitle: 'Domani 1.2',
                    releaseSlug: 'domani-1-2',
                    sourceType: 'linear_epic',
                    sourceReference: ' DEV-1004 '
                }
            })
        )
        expect(normalized).toMatchObject({
            markdown: '# Domani',
            filename: 'domani.md',
            releaseVersion: '1.2.0',
            releaseType: 'minor',
            sourceReference: 'DEV-1004',
            intendedSurface: 'changelog',
            ifMatch: null
        })
        expect(parseIfMatch('"12"')).toBe(12)
        expect(() => parseIfMatch('12')).toThrowError(
            expect.objectContaining({ code: 'VALIDATION_ERROR' })
        )
    })

    it('accepts a MIME-agnostic .md upload at the exact byte limit', () => {
        const normalized = normalizeImportMarkdownRequest(
            request({
                contentType: 'multipart/form-data; boundary=test',
                ifMatch: '"1"',
                body: {
                    releaseId,
                    sourceType: 'manual',
                    sourceReference: 'upload'
                },
                file: markdownFile(
                    'DOMANI.MD',
                    Buffer.alloc(1_048_576, 97),
                    'text/plain'
                )
            })
        )
        expect(Buffer.byteLength(normalized.markdown)).toBe(1_048_576)
        expect(normalized.filename).toBe('DOMANI.MD')
        expect(normalized.ifMatch).toBe(1)
    })

    it('rejects conversion, identity injection, missing preconditions, bad files, UTF-8, NUL, and size', () => {
        const base = {
            markdown: '# Domani',
            releaseVersion: '1.2.0',
            sourceType: 'manual',
            sourceReference: 'upload'
        }
        expect(() =>
            normalizeImportMarkdownRequest(
                request({ body: { ...base, convert: true } })
            )
        ).toThrowError(
            expect.objectContaining({ code: 'IMPORT_CONVERSION_NOT_SUPPORTED' })
        )
        expect(() =>
            normalizeImportMarkdownRequest(
                request({ body: { ...base, role: 'admin' } })
            )
        ).toThrowError(
            expect.objectContaining({
                fieldErrors: { role: ['Field is not allowed'] }
            })
        )
        expect(() =>
            normalizeImportMarkdownRequest(
                request({
                    body: { ...base, releaseVersion: undefined, releaseId }
                })
            )
        ).toThrowError(
            expect.objectContaining({ code: 'PRECONDITION_REQUIRED' })
        )

        const multipartBase = {
            contentType: 'multipart/form-data; boundary=test',
            ifMatch: '"1"',
            body: { releaseId, sourceType: 'manual', sourceReference: 'upload' }
        }
        expect(() =>
            normalizeImportMarkdownRequest(
                request({
                    ...multipartBase,
                    file: markdownFile('domani.txt', Buffer.from('ok'))
                })
            )
        ).toThrowError(
            expect.objectContaining({ code: 'MARKDOWN_FILE_TYPE_INVALID' })
        )
        expect(() =>
            normalizeImportMarkdownRequest(
                request({
                    ...multipartBase,
                    file: markdownFile('domani.md', Buffer.from([0xff]))
                })
            )
        ).toThrowError(
            expect.objectContaining({ code: 'MARKDOWN_INVALID_UTF8' })
        )
        expect(() =>
            normalizeImportMarkdownRequest(
                request({ body: { ...base, markdown: 'a\0b' } })
            )
        ).toThrowError(
            expect.objectContaining({ code: 'MARKDOWN_INVALID_UTF8' })
        )
        expect(() =>
            normalizeImportMarkdownRequest(
                request({
                    ...multipartBase,
                    file: markdownFile('domani.md', Buffer.alloc(1_048_577, 97))
                })
            )
        ).toThrowError(expect.objectContaining({ code: 'MARKDOWN_TOO_LARGE' }))
    })

    it('rejects unsupported content types before body parsing', () => {
        const req = request({ contentType: 'text/plain' })
        const res = response()
        parseImportBody(req, res, vi.fn() as NextFunction)
        expect(res.statusCode).toBe(415)
        expect(res.payload.error.code).toBe('MARKDOWN_FILE_TYPE_INVALID')
    })
})

describe('DEV-1008 Markdown import controller', () => {
    it('returns the locked 201 envelope, ETag, and verified actor RPC arguments', async () => {
        const req = request({
            body: {
                markdown: '# Domani',
                filename: 'domani.md',
                releaseVersion: '1.2.0',
                releaseTitle: 'Domani 1.2',
                releaseSlug: 'domani-1-2',
                sourceType: 'linear_epic',
                sourceReference: 'DEV-1004'
            }
        })
        req.dashboardActor = {
            userId: actorId,
            email: 'editor@example.com',
            role: 'editor'
        }
        const res = response()
        await importMarkdown(req, res)

        expect(res.statusCode).toBe(201)
        expect(res.headers.etag).toBe('"2"')
        expect(res.payload).toMatchObject({
            data: { duplicate: false },
            meta: {
                apiVersion: '2026-08-05',
                requestId: 'request-1008',
                nextCursor: null
            }
        })
        expect(mockState.rpc).toHaveBeenCalledWith(
            'import_domani_release_markdown',
            expect.objectContaining({
                p_actor_user_id: actorId,
                p_actor_email: 'editor@example.com',
                p_actor_role: 'editor',
                p_raw_markdown: '# Domani',
                p_if_match: null
            })
        )
    })

    it('returns 200 for duplicates and maps safe conflicts without leaking RPC errors', async () => {
        const req = request({
            ifMatch: '"1"',
            body: {
                markdown: '# Domani',
                releaseId,
                sourceType: 'linear_epic',
                sourceReference: 'DEV-1004'
            }
        })
        req.dashboardActor = {
            userId: actorId,
            email: 'editor@example.com',
            role: 'editor'
        }

        mockState.rpc.mockResolvedValueOnce({
            data: importedResult(true),
            error: null
        })
        const duplicateRes = response()
        await importMarkdown(req, duplicateRes)
        expect(duplicateRes.statusCode).toBe(200)
        expect(duplicateRes.payload.data.duplicate).toBe(true)

        mockState.rpc.mockResolvedValueOnce({
            data: null,
            error: { message: 'DEV1008_VERSION_CONFLICT' }
        })
        const conflictRes = response()
        await importMarkdown(req, conflictRes)
        expect(conflictRes.statusCode).toBe(409)
        expect(conflictRes.payload.error.code).toBe('VERSION_CONFLICT')
        expect(JSON.stringify(conflictRes.payload)).not.toContain('DEV1008')
    })
})
