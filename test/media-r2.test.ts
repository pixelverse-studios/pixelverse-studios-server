import { Request, Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import mediaController from '../src/controllers/media'
import {
    buildR2ObjectKey,
    joinPublicUrl,
    MediaOperationError,
    validateUploadInput,
} from '../src/lib/media-r2'
import mediaCatalogService from '../src/services/media-catalog'
import mediaR2Service from '../src/services/media-r2'
import mediaRevalidationService from '../src/services/media-revalidation'

vi.mock('../src/services/media-r2', () => ({
    default: {
        createPresignedUpload: vi.fn(),
        checkDestination: vi.fn(),
    },
}))

vi.mock('../src/services/media-catalog', () => ({
    default: {
        listCatalog: vi.fn(),
        createItem: vi.fn(),
        updateItem: vi.fn(),
    },
}))

vi.mock('../src/services/media-placements', () => ({
    default: {
        listPublicPlacements: vi.fn(),
        listAdminPlacements: vi.fn(),
        assignPlacement: vi.fn(),
        clearPlacement: vi.fn(),
    },
}))

vi.mock('../src/services/media-revalidation', () => ({
    default: {
        publicCatalogCacheControl: vi.fn(),
        triggerMediaRevalidation: vi.fn(),
    },
}))

const createResponse = () => {
    const res = {
        set: vi.fn(),
        status: vi.fn(),
        json: vi.fn(),
    }
    res.set.mockReturnValue(res)
    res.status.mockReturnValue(res)
    res.json.mockReturnValue(res)
    return res as unknown as Response & {
        set: ReturnType<typeof vi.fn>
        status: ReturnType<typeof vi.fn>
        json: ReturnType<typeof vi.fn>
    }
}

const createRequest = ({
    params = { websiteSlug: 'iffers-pictures' },
    body = {},
    headers = {},
}: {
    params?: Record<string, string>
    body?: unknown
    headers?: Record<string, string>
}): Request =>
    ({
        params,
        body,
        headers,
    }) as unknown as Request

describe('media R2 key and upload validation helpers', () => {
    beforeEach(() => {
        process.env.MEDIA_MAX_UPLOAD_BYTES = '1500000'
    })

    it('generates safe collision-resistant R2 keys', () => {
        const key = buildR2ObjectKey({
            filename: '../Baby Shower 15.JPG',
            contentType: 'image/jpeg',
            folder: 'Events/Baby Shower',
            keyPrefix: '/iffers uploads/',
            now: 1712345678000,
            uniqueSuffix: 'abc123',
        })

        expect(key).toBe(
            'iffers-uploads/events/baby-shower/1712345678000-abc123-baby-shower-15.jpg'
        )
        expect(key).not.toContain('..')
        expect(key).not.toContain('//')
    })

    it('uses the validated content type for the stored file extension', () => {
        const key = buildR2ObjectKey({
            filename: 'Portrait Final.gif',
            contentType: 'image/webp',
            folder: 'Portrait',
            now: 1712345678000,
            uniqueSuffix: 'abc123',
        })

        expect(key).toBe(
            'portrait/1712345678000-abc123-portrait-final.webp'
        )
    })

    it('rejects invalid content types', () => {
        expect(() =>
            validateUploadInput({
                contentType: 'image/gif',
                size: 1000,
            })
        ).toThrow('Unsupported upload content type.')
    })

    it('rejects oversized uploads', () => {
        expect(() =>
            validateUploadInput({
                contentType: 'image/jpeg',
                size: 1500001,
            })
        ).toThrow('Upload exceeds the configured maximum size.')
    })

    it('joins public URLs without duplicate slashes', () => {
        expect(joinPublicUrl('https://pub.example.test/', 'events/test.jpg')).toBe(
            'https://pub.example.test/events/test.jpg'
        )
    })
})

describe('media presigned upload controller', () => {
    beforeEach(() => {
        vi.mocked(mediaR2Service.createPresignedUpload).mockReset()
        vi.mocked(mediaR2Service.checkDestination).mockReset()
        vi.mocked(mediaRevalidationService.triggerMediaRevalidation).mockReset()
        vi.mocked(mediaCatalogService.createItem).mockReset()
        vi.mocked(mediaR2Service.createPresignedUpload).mockResolvedValue({
            presigned_url: 'https://signed.example.test/upload',
            public_url:
                'https://pub.example.test/events/baby-shower/1712345678000-abc123-baby.jpg',
            r2_key: 'events/baby-shower/1712345678000-abc123-baby.jpg',
            expires_at: '2026-05-27T12:00:00.000Z',
        })
    })

    it('returns the presigned upload response shape', async () => {
        const res = createResponse()

        await mediaController.presignUpload(
            createRequest({
                body: {
                    filename: 'Baby.jpg',
                    content_type: 'image/jpeg',
                    folder: 'events/baby-shower',
                    size: 123456,
                },
            }),
            res
        )

        expect(mediaR2Service.createPresignedUpload).toHaveBeenCalledWith({
            websiteSlug: 'iffers-pictures',
            filename: 'Baby.jpg',
            contentType: 'image/jpeg',
            folder: 'events/baby-shower',
            size: 123456,
        })
        expect(res.status).toHaveBeenCalledWith(200)
        expect(res.json).toHaveBeenCalledWith({
            presigned_url: 'https://signed.example.test/upload',
            public_url:
                'https://pub.example.test/events/baby-shower/1712345678000-abc123-baby.jpg',
            r2_key: 'events/baby-shower/1712345678000-abc123-baby.jpg',
            expires_at: '2026-05-27T12:00:00.000Z',
            request_id: expect.any(String),
        })
    })

    it('returns a retryable timeout envelope for upload provider timeouts', async () => {
        vi.mocked(mediaR2Service.createPresignedUpload).mockRejectedValue(
            new MediaOperationError({
                status: 504,
                code: 'media.upload_timeout',
                message: 'Media storage request timed out.',
                retryable: true,
                details: { provider: 'r2', operation: 'presign_upload' },
            })
        )
        const res = createResponse()

        await mediaController.presignUpload(
            createRequest({
                headers: { 'x-request-id': 'req-upload-timeout' },
                body: {
                    filename: 'Baby.jpg',
                    content_type: 'image/jpeg',
                    folder: 'events/baby-shower',
                    size: 123456,
                },
            }),
            res
        )

        expect(res.status).toHaveBeenCalledWith(504)
        expect(res.json).toHaveBeenCalledWith({
            error: expect.objectContaining({
                code: 'media.upload_timeout',
                request_id: 'req-upload-timeout',
                retryable: true,
            }),
        })
    })

    it('returns retryable upload codes from destination checks', async () => {
        vi.mocked(mediaR2Service.checkDestination).mockRejectedValue(
            new MediaOperationError({
                status: 503,
                code: 'media.upload_temporary_unavailable',
                message: 'Media storage is temporarily busy.',
                retryable: true,
            })
        )
        const res = createResponse()

        await mediaController.checkDestination(
            createRequest({
                headers: { 'x-request-id': 'req-check-busy' },
                body: {
                    destination_key: 'events/baby-shower/new.jpg',
                },
            }),
            res
        )

        expect(res.status).toHaveBeenCalledWith(503)
        expect(res.json).toHaveBeenCalledWith({
            error: expect.objectContaining({
                code: 'media.upload_temporary_unavailable',
                request_id: 'req-check-busy',
                retryable: true,
            }),
        })
    })

    it('returns a consistent error envelope for invalid payloads', async () => {
        const res = createResponse()

        await mediaController.presignUpload(
            createRequest({
                body: {
                    filename: '',
                    content_type: 'image/jpeg',
                    size: 123456,
                },
            }),
            res
        )

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.objectContaining({
                    code: 'media.invalid_payload',
                    retryable: false,
                }),
            })
        )
    })
})

describe('media catalog upload completion controller', () => {
    beforeEach(() => {
        vi.mocked(mediaCatalogService.createItem).mockReset()
        vi.mocked(mediaCatalogService.createItem).mockResolvedValue({
            id: 1,
            key: 'events/baby-shower/one.jpg',
            filename: 'one.jpg',
            src: 'https://pub.example.test/events/baby-shower/one.jpg',
            alt: '',
            library: 'portfolio',
            siteCategory: null,
            service: null,
            subCategory: null,
            aspectRatio: null,
            status: 'draft',
            sortOrder: 0,
        })
    })

    it('creates uploaded catalog drafts as a batch with per-file success', async () => {
        const res = createResponse()

        await mediaController.batchCreateCatalogItems(
            createRequest({
                headers: { 'x-request-id': 'req-batch-success' },
                body: {
                    items: [
                        {
                            key: 'events/baby-shower/one.jpg',
                            filename: 'one.jpg',
                        },
                    ],
                },
            }),
            res
        )

        expect(mediaCatalogService.createItem).toHaveBeenCalledWith(
            expect.objectContaining({
                websiteSlug: 'iffers-pictures',
                key: 'events/baby-shower/one.jpg',
                filename: 'one.jpg',
            })
        )
        expect(res.status).toHaveBeenCalledWith(201)
        expect(res.json).toHaveBeenCalledWith({
            request_id: 'req-batch-success',
            status: 'completed',
            items: [
                expect.objectContaining({
                    index: 0,
                    key: 'events/baby-shower/one.jpg',
                    ok: true,
                }),
            ],
            summary: {
                requested: 1,
                succeeded: 1,
                failed: 0,
            },
        })
    })

    it('preserves batch partial success with per-file failure codes', async () => {
        vi.mocked(mediaCatalogService.createItem)
            .mockResolvedValueOnce({
                id: 1,
                key: 'events/baby-shower/one.jpg',
                filename: 'one.jpg',
                src: 'https://pub.example.test/events/baby-shower/one.jpg',
                alt: '',
                library: 'portfolio',
                siteCategory: null,
                service: null,
                subCategory: null,
                aspectRatio: null,
                status: 'draft',
                sortOrder: 0,
            })
            .mockRejectedValueOnce(
                new MediaOperationError({
                    status: 503,
                    code: 'media.upload_temporary_unavailable',
                    message: 'Media storage is temporarily busy.',
                    retryable: true,
                })
            )
        const res = createResponse()

        await mediaController.batchCreateCatalogItems(
            createRequest({
                headers: { 'x-request-id': 'req-batch-partial' },
                body: {
                    items: [
                        { key: 'events/baby-shower/one.jpg' },
                        { key: 'events/baby-shower/two.jpg' },
                    ],
                },
            }),
            res
        )

        expect(res.status).toHaveBeenCalledWith(207)
        expect(res.json).toHaveBeenCalledWith({
            request_id: 'req-batch-partial',
            status: 'partial_success',
            items: [
                expect.objectContaining({
                    index: 0,
                    key: 'events/baby-shower/one.jpg',
                    ok: true,
                }),
                {
                    index: 1,
                    key: 'events/baby-shower/two.jpg',
                    ok: false,
                    error: {
                        code: 'media.upload_temporary_unavailable',
                        message: 'Media storage is temporarily busy.',
                        status: 503,
                        retryable: true,
                    },
                },
            ],
            summary: {
                requested: 2,
                succeeded: 1,
                failed: 1,
            },
        })
    })

    it('returns the stable media envelope for malformed batch payloads', async () => {
        const res = createResponse()

        await mediaController.batchCreateCatalogItems(
            createRequest({
                headers: { 'x-request-id': 'req-batch-invalid' },
                body: {},
            }),
            res
        )

        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({
            error: expect.objectContaining({
                code: 'media.invalid_payload',
                request_id: 'req-batch-invalid',
                retryable: false,
            }),
        })
        expect(mediaCatalogService.createItem).not.toHaveBeenCalled()
    })
})

describe('media revalidation controller', () => {
    beforeEach(() => {
        vi.mocked(mediaRevalidationService.triggerMediaRevalidation).mockReset()
        vi.mocked(mediaRevalidationService.triggerMediaRevalidation).mockResolvedValue({
            configured: true,
            triggered: true,
            skipped: false,
            reason: 'placement_replaced',
            website_slug: 'iffers-pictures',
            affected_paths: ['/'],
            triggered_at: '2026-06-06T12:00:00.000Z',
            status: 202,
        })
    })

    it('accepts placement-specific manual revalidation reasons', async () => {
        const res = createResponse()

        await mediaController.revalidateCatalog(
            createRequest({
                body: {
                    reason: 'placement_replaced',
                    media_id: 123,
                    media_key: 'events/baby-shower/baby.jpg',
                },
            }),
            res
        )

        expect(mediaRevalidationService.triggerMediaRevalidation).toHaveBeenCalledWith({
            websiteSlug: 'iffers-pictures',
            reason: 'placement_replaced',
            mediaId: 123,
            mediaKey: 'events/baby-shower/baby.jpg',
            actor: undefined,
        })
        expect(res.status).toHaveBeenCalledWith(200)
    })
})
