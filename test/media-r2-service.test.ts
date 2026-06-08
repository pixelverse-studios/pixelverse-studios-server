import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
    from: vi.fn(),
    getSignedUrl: vi.fn(),
    queryResults: [] as Array<{ data: unknown; error: unknown }>,
}))

vi.mock('../src/lib/db', () => ({
    db: {
        from: mockState.from,
    },
    Tables: {
        WEBSITES: 'websites',
        MEDIA_R2_CONFIGS: 'media_r2_configs',
    },
    COLUMNS: {
        WEBSITE_SLUG: 'website_slug',
    },
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: mockState.getSignedUrl,
}))

import mediaR2Service from '../src/services/media-r2'

const makeQueryBuilder = (result: { data: unknown; error: unknown }) => {
    const builder = {
        select: vi.fn(),
        eq: vi.fn(),
        is: vi.fn(),
        maybeSingle: vi.fn(),
    }

    builder.select.mockReturnValue(builder)
    builder.eq.mockReturnValue(builder)
    builder.is.mockReturnValue(builder)
    builder.maybeSingle.mockResolvedValue(result)

    return builder
}

describe('media R2 presigned upload service', () => {
    beforeEach(() => {
        mockState.from.mockReset()
        mockState.getSignedUrl.mockReset()
        mockState.queryResults = []
        mockState.from.mockImplementation(() =>
            makeQueryBuilder(
                mockState.queryResults.shift() || { data: null, error: null }
            )
        )
        mockState.getSignedUrl.mockResolvedValue(
            'https://signed.example.test/upload'
        )
        process.env.R2_ACCESS_KEY_ID = 'test-access-key'
        process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key'
        process.env.R2_ACCOUNT_ID = 'test-account'
        process.env.R2_BUCKET_NAME = 'env-bucket'
        process.env.R2_PUBLIC_BASE_URL = 'https://env-public.example.test'
        process.env.R2_PRESIGN_EXPIRES_SECONDS = '900'
        process.env.MEDIA_MAX_UPLOAD_BYTES = '1500000'
    })

    it('prefers website R2 config from Supabase when available', async () => {
        mockState.queryResults = [
            {
                data: {
                    id: 'website-1',
                    client_id: 'client-1',
                },
                error: null,
            },
            {
                data: {
                    bucket: 'persisted-bucket',
                    public_base_url: 'https://persisted.example.test',
                    key_prefix: 'portfolio',
                },
                error: null,
            },
        ]

        const result = await mediaR2Service.createPresignedUpload({
            websiteSlug: 'iffers-pictures',
            filename: 'Baby Shower.jpg',
            contentType: 'image/jpeg',
            folder: 'Events/Baby Shower',
            size: 123456,
        })

        expect(mockState.from).toHaveBeenCalledWith('websites')
        expect(mockState.from).toHaveBeenCalledWith('media_r2_configs')
        expect(mockState.getSignedUrl).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            {
                expiresIn: 900,
                signableHeaders: new Set(['content-type', 'content-length']),
            }
        )
        expect(result).toEqual(
            expect.objectContaining({
                presigned_url: 'https://signed.example.test/upload',
                public_url: expect.stringContaining(
                    'https://persisted.example.test/portfolio/events/baby-shower/'
                ),
                r2_key: expect.stringContaining(
                    'portfolio/events/baby-shower/'
                ),
            })
        )
        expect(result.expires_at).toEqual(expect.any(String))
    })

    it('falls back to env R2 config when no persisted config exists', async () => {
        mockState.queryResults = [
            {
                data: {
                    id: 'website-1',
                    client_id: 'client-1',
                },
                error: null,
            },
            { data: null, error: null },
            { data: null, error: null },
        ]

        const result = await mediaR2Service.createPresignedUpload({
            websiteSlug: 'iffers-pictures',
            filename: 'Portrait.png',
            contentType: 'image/png',
            folder: 'Portrait',
            size: 123456,
        })

        expect(result.public_url).toContain(
            'https://env-public.example.test/portrait/'
        )
        expect(result.r2_key).toContain('portrait/')
    })
})
