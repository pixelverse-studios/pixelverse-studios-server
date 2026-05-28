import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
    from: vi.fn(),
    queryResults: [] as Array<{ data: unknown; error: unknown }>,
    builders: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
}))

vi.mock('../src/lib/db', () => ({
    db: {
        from: mockState.from,
    },
    Tables: {
        WEBSITES: 'websites',
        MEDIA_R2_CONFIGS: 'media_r2_configs',
        MEDIA_CATALOG_ITEMS: 'media_catalog_items',
    },
    COLUMNS: {
        WEBSITE_SLUG: 'website_slug',
    },
}))

import mediaCatalogService from '../src/services/media-catalog'

const makeQueryBuilder = (result: { data: unknown; error: unknown }) => {
    const builder = {
        select: vi.fn(),
        eq: vi.fn(),
        is: vi.fn(),
        neq: vi.fn(),
        order: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        maybeSingle: vi.fn(),
        single: vi.fn(),
        then: vi.fn(),
    }

    builder.select.mockReturnValue(builder)
    builder.eq.mockReturnValue(builder)
    builder.is.mockReturnValue(builder)
    builder.neq.mockReturnValue(builder)
    builder.order.mockReturnValue(builder)
    builder.insert.mockReturnValue(builder)
    builder.update.mockReturnValue(builder)
    builder.maybeSingle.mockResolvedValue(result)
    builder.single.mockResolvedValue(result)
    builder.then.mockImplementation((resolve, reject) =>
        Promise.resolve(result).then(resolve, reject)
    )

    return builder
}

const publishedItem = {
    id: 1,
    website_id: 'website-1',
    client_id: 'client-1',
    key: 'events/baby-shower/baby.jpg',
    filename: 'baby.jpg',
    src: 'https://pub.example.test/events/baby-shower/baby.jpg',
    alt: 'Mother-to-be opening gifts',
    service: 'Events',
    sub_category: 'Baby Shower',
    aspect_ratio: 'portrait',
    status: 'published',
    sort_order: 0,
    created_at: '2026-05-27T12:00:00.000Z',
    updated_at: '2026-05-27T12:30:00.000Z',
    archived_at: null,
    archived_by: null,
    archived_from_status: null,
}

const archivedItem = {
    ...publishedItem,
    id: 2,
    key: 'events/baby-shower/archived.jpg',
    filename: 'archived.jpg',
    src: 'https://pub.example.test/events/baby-shower/archived.jpg',
    status: 'archived',
    archived_at: '2026-05-28T12:00:00.000Z',
    archived_by: 'admin@example.test',
    archived_from_status: 'published',
}

describe('media catalog service', () => {
    beforeEach(() => {
        mockState.from.mockReset()
        mockState.queryResults = []
        mockState.builders = []
        mockState.from.mockImplementation(() => {
            const builder = makeQueryBuilder(
                mockState.queryResults.shift() || {
                    data: null,
                    error: null,
                }
            )
            mockState.builders.push(builder)
            return builder
        })
        process.env.R2_BUCKET_NAME = 'iffers-pictures'
        process.env.R2_PUBLIC_BASE_URL = 'https://env-pub.example.test'
    })

    it('returns only published catalog items for the public catalog', async () => {
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            {
                data: {
                    bucket: 'persisted-bucket',
                    public_base_url: 'https://pub.example.test',
                    key_prefix: '',
                },
                error: null,
            },
            { data: [publishedItem], error: null },
        ]

        const catalog = await mediaCatalogService.listCatalog({
            websiteSlug: 'iffers-pictures',
            includeAdminFields: false,
        })

        expect(catalog).toEqual({
            version: 1,
            publicBaseUrl: 'https://pub.example.test',
            bucket: 'persisted-bucket',
            items: [
                {
                    id: 1,
                    key: 'events/baby-shower/baby.jpg',
                    filename: 'baby.jpg',
                    src: 'https://pub.example.test/events/baby-shower/baby.jpg',
                    alt: 'Mother-to-be opening gifts',
                    service: 'Events',
                    subCategory: 'Baby Shower',
                    aspectRatio: 'portrait',
                    status: 'published',
                    sortOrder: 0,
                },
            ],
        })
        expect(mockState.builders[2].eq).toHaveBeenCalledWith(
            'status',
            'published'
        )
        expect(catalog.items[0]).not.toHaveProperty('archivedAt')
    })

    it('returns all catalog items with archive metadata for the admin catalog', async () => {
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            {
                data: {
                    bucket: 'persisted-bucket',
                    public_base_url: 'https://pub.example.test',
                    key_prefix: '',
                },
                error: null,
            },
            { data: [publishedItem, archivedItem], error: null },
        ]

        const catalog = await mediaCatalogService.listCatalog({
            websiteSlug: 'iffers-pictures',
            includeAdminFields: true,
        })

        expect(catalog.items).toHaveLength(2)
        expect(mockState.builders[2].eq).not.toHaveBeenCalledWith(
            'status',
            'published'
        )
        expect(catalog.items[1]).toEqual(
            expect.objectContaining({
                id: 2,
                status: 'archived',
                archivedAt: '2026-05-28T12:00:00.000Z',
                archivedBy: 'admin@example.test',
                archivedFromStatus: 'published',
            })
        )
    })

    it('creates draft catalog items and derives src from R2 config', async () => {
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            {
                data: {
                    bucket: 'persisted-bucket',
                    public_base_url: 'https://pub.example.test',
                    key_prefix: '',
                },
                error: null,
            },
            { data: null, error: null },
            {
                data: {
                    ...publishedItem,
                    status: 'draft',
                    key: 'portrait/new-image.jpg',
                    filename: 'new-image.jpg',
                    src: 'https://pub.example.test/portrait/new-image.jpg',
                    alt: '',
                    service: null,
                    sub_category: null,
                    aspect_ratio: null,
                    sort_order: 0,
                },
                error: null,
            },
        ]

        const item = await mediaCatalogService.createItem({
            websiteSlug: 'iffers-pictures',
            key: 'portrait/new-image.jpg',
        })

        expect(mockState.builders[3].insert).toHaveBeenCalledWith({
            website_id: 'website-1',
            client_id: 'client-1',
            key: 'portrait/new-image.jpg',
            filename: 'new-image.jpg',
            src: 'https://pub.example.test/portrait/new-image.jpg',
            alt: '',
            service: null,
            sub_category: null,
            aspect_ratio: null,
            status: 'draft',
            sort_order: 0,
        })
        expect(item).toEqual(
            expect.objectContaining({
                key: 'portrait/new-image.jpg',
                status: 'draft',
                createdAt: '2026-05-27T12:00:00.000Z',
            })
        )
    })

    it('returns a conflict when a catalog key already exists', async () => {
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            {
                data: {
                    bucket: 'persisted-bucket',
                    public_base_url: 'https://pub.example.test',
                    key_prefix: '',
                },
                error: null,
            },
            { data: { id: 10 }, error: null },
        ]

        await expect(
            mediaCatalogService.createItem({
                websiteSlug: 'iffers-pictures',
                key: 'events/baby-shower/baby.jpg',
                filename: 'baby.jpg',
            })
        ).rejects.toMatchObject({
            status: 409,
            code: 'media.duplicate_key',
        })
    })

    it('blocks direct key changes on published catalog items', async () => {
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            {
                data: {
                    bucket: 'persisted-bucket',
                    public_base_url: 'https://pub.example.test',
                    key_prefix: '',
                },
                error: null,
            },
            { data: publishedItem, error: null },
        ]

        await expect(
            mediaCatalogService.updateItem({
                websiteSlug: 'iffers-pictures',
                id: 1,
                key: 'events/baby-shower/moved.jpg',
            })
        ).rejects.toMatchObject({
            status: 409,
            code: 'media.published_location_locked',
        })
    })
})
