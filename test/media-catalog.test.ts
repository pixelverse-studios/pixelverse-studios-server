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
        MEDIA_AUDIT_LOGS: 'media_audit_logs',
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
        in: vi.fn(),
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
    builder.in.mockReturnValue(builder)
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
    library: 'portfolio',
    site_category: null,
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

const publishedSiteItem = {
    ...publishedItem,
    id: 4,
    key: 'site/about/jenn-portrait.jpg',
    filename: 'jenn-portrait.jpg',
    src: 'https://pub.example.test/site/about/jenn-portrait.jpg',
    alt: 'Jenn standing near a portrait backdrop',
    library: 'site',
    site_category: 'About',
    service: null,
    sub_category: null,
    aspect_ratio: 'portrait',
}

const draftSiteItem = {
    ...publishedSiteItem,
    id: 5,
    key: 'site/home/brand-image.jpg',
    filename: 'brand-image.jpg',
    src: 'https://pub.example.test/site/home/brand-image.jpg',
    alt: '',
    site_category: 'Home',
    aspect_ratio: null,
    status: 'draft',
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

const draftItem = {
    ...publishedItem,
    id: 3,
    key: 'portrait/draft.jpg',
    filename: 'draft.jpg',
    src: 'https://pub.example.test/portrait/draft.jpg',
    alt: '',
    service: null,
    sub_category: null,
    aspect_ratio: null,
    status: 'draft',
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
                    library: 'portfolio',
                    siteCategory: null,
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
        expect(mockState.builders[2].eq).toHaveBeenCalledWith(
            'library',
            'portfolio'
        )
        expect(catalog.items[0]).not.toHaveProperty('archivedAt')
    })

    it('excludes site images from the public portfolio catalog by default', async () => {
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

        expect(catalog.items).toEqual([
            expect.objectContaining({
                id: 1,
                library: 'portfolio',
                siteCategory: null,
            }),
        ])
        expect(mockState.builders[2].eq).toHaveBeenCalledWith(
            'library',
            'portfolio'
        )
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
            {
                data: [publishedItem, publishedSiteItem, archivedItem],
                error: null,
            },
        ]

        const catalog = await mediaCatalogService.listCatalog({
            websiteSlug: 'iffers-pictures',
            includeAdminFields: true,
        })

        expect(catalog.items).toHaveLength(3)
        expect(mockState.builders[2].eq).not.toHaveBeenCalledWith(
            'status',
            'published'
        )
        expect(catalog.items[1]).toEqual(
            expect.objectContaining({
                id: 4,
                library: 'site',
                siteCategory: 'About',
                service: null,
                subCategory: null,
            })
        )
        expect(catalog.items[2]).toEqual(
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
                    library: 'portfolio',
                    site_category: null,
                    sort_order: 0,
                },
                error: null,
            },
        ]

        const item = await mediaCatalogService.createItem({
            websiteSlug: 'iffers-pictures',
            key: 'portrait/new-image.jpg',
            actor: 'jenn@example.com',
        })

        expect(mockState.builders[3].insert).toHaveBeenCalledWith({
            website_id: 'website-1',
            client_id: 'client-1',
            key: 'portrait/new-image.jpg',
            filename: 'new-image.jpg',
            src: 'https://pub.example.test/portrait/new-image.jpg',
            alt: '',
            library: 'portfolio',
            site_category: null,
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
        expect(mockState.from).toHaveBeenLastCalledWith('media_audit_logs')
        expect(mockState.builders[4].insert).toHaveBeenCalledWith(
            expect.objectContaining({
                website_id: 'website-1',
                client_id: 'client-1',
                media_id: 1,
                media_key: 'portrait/new-image.jpg',
                action: 'upload_created',
                actor: 'jenn@example.com',
                old_values: null,
                new_values: expect.objectContaining({
                    key: 'portrait/new-image.jpg',
                    library: 'portfolio',
                    status: 'draft',
                }),
            })
        )
    })

    it('creates site draft catalog items without portfolio service metadata', async () => {
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
            { data: draftSiteItem, error: null },
        ]

        const item = await mediaCatalogService.createItem({
            websiteSlug: 'iffers-pictures',
            key: 'site/home/brand-image.jpg',
            library: 'site',
            siteCategory: 'Home',
            service: 'Events',
            subCategory: 'Baby Shower',
        })

        expect(mockState.builders[3].insert).toHaveBeenCalledWith(
            expect.objectContaining({
                key: 'site/home/brand-image.jpg',
                library: 'site',
                site_category: 'Home',
                service: null,
                sub_category: null,
                status: 'draft',
            })
        )
        expect(item).toEqual(
            expect.objectContaining({
                library: 'site',
                siteCategory: 'Home',
                service: null,
                subCategory: null,
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

    it('writes a renamed/moved audit entry for draft key changes', async () => {
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
            { data: draftItem, error: null },
            { data: null, error: null },
            {
                data: {
                    ...draftItem,
                    key: 'portrait/moved-draft.jpg',
                    filename: 'moved-draft.jpg',
                    src: 'https://pub.example.test/portrait/moved-draft.jpg',
                },
                error: null,
            },
        ]

        const item = await mediaCatalogService.updateItem({
            websiteSlug: 'iffers-pictures',
            id: 3,
            key: 'portrait/moved-draft.jpg',
            actor: 'jenn@example.com',
        })

        expect(item).toEqual(
            expect.objectContaining({
                key: 'portrait/moved-draft.jpg',
                filename: 'moved-draft.jpg',
            })
        )
        expect(mockState.builders[5].insert).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'renamed_moved',
                actor: 'jenn@example.com',
                old_values: expect.objectContaining({
                    key: 'portrait/draft.jpg',
                    filename: 'draft.jpg',
                    src: 'https://pub.example.test/portrait/draft.jpg',
                }),
                new_values: expect.objectContaining({
                    key: 'portrait/moved-draft.jpg',
                    filename: 'moved-draft.jpg',
                    src: 'https://pub.example.test/portrait/moved-draft.jpg',
                }),
            })
        )
    })

    it('rejects invalid service and sub-category pairings', async () => {
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
        ]

        await expect(
            mediaCatalogService.createItem({
                websiteSlug: 'iffers-pictures',
                key: 'events/baby-shower/wrong.jpg',
                service: 'Family',
                subCategory: 'Baby Shower',
            })
        ).rejects.toMatchObject({
            status: 400,
            code: 'media.invalid_sub_category',
        })
    })

    it('blocks publishing when required public metadata is missing', async () => {
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
            { data: draftItem, error: null },
        ]

        await expect(
            mediaCatalogService.updateItem({
                websiteSlug: 'iffers-pictures',
                id: 3,
                status: 'published',
                service: 'Portrait',
                subCategory: 'Portrait',
                aspectRatio: 'portrait',
            })
        ).rejects.toMatchObject({
            status: 400,
            code: 'media.missing_alt_text',
        })
    })

    it('publishes a draft when required public metadata is present', async () => {
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
            { data: draftItem, error: null },
            {
                data: {
                    ...draftItem,
                    alt: 'Jenn photographing a portrait session',
                    service: 'Portrait',
                    sub_category: 'Portrait',
                    aspect_ratio: 'portrait',
                    status: 'published',
                },
                error: null,
            },
        ]

        const item = await mediaCatalogService.updateItem({
            websiteSlug: 'iffers-pictures',
            id: 3,
            status: 'published',
            alt: 'Jenn photographing a portrait session',
            service: 'Portrait',
            subCategory: 'Portrait',
            aspectRatio: 'portrait',
        })

        expect(mockState.builders[3].update).toHaveBeenCalledWith(
            expect.objectContaining({
                alt: 'Jenn photographing a portrait session',
                service: 'Portrait',
                sub_category: 'Portrait',
                aspect_ratio: 'portrait',
                status: 'published',
                archived_at: null,
                archived_by: null,
                archived_from_status: null,
            })
        )
        expect(item).toEqual(
            expect.objectContaining({
                status: 'published',
                alt: 'Jenn photographing a portrait session',
                service: 'Portrait',
                subCategory: 'Portrait',
                aspectRatio: 'portrait',
            })
        )
        expect(mockState.from).toHaveBeenLastCalledWith('media_audit_logs')
        expect(mockState.builders[4].insert).toHaveBeenCalledWith(
            expect.objectContaining({
                website_id: 'website-1',
                client_id: 'client-1',
                media_id: 3,
                media_key: 'portrait/draft.jpg',
                action: 'published',
                actor: null,
                old_values: expect.objectContaining({
                    status: 'draft',
                }),
                new_values: expect.objectContaining({
                    status: 'published',
                }),
            })
        )
        expect(mockState.builders[5].insert).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'metadata_edited',
                old_values: expect.objectContaining({
                    alt: '',
                    service: null,
                    subCategory: null,
                    aspectRatio: null,
                }),
                new_values: expect.objectContaining({
                    alt: 'Jenn photographing a portrait session',
                    service: 'Portrait',
                    subCategory: 'Portrait',
                    aspectRatio: 'portrait',
                }),
            })
        )
    })

    it('publishes site media without portfolio service metadata', async () => {
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
            { data: { ...draftSiteItem, site_category: null }, error: null },
            { data: publishedSiteItem, error: null },
        ]

        const item = await mediaCatalogService.updateItem({
            websiteSlug: 'iffers-pictures',
            id: 5,
            status: 'published',
            alt: 'Jenn standing near a portrait backdrop',
            library: 'site',
            siteCategory: 'About',
            aspectRatio: 'portrait',
        })

        expect(mockState.builders[3].update).toHaveBeenCalledWith(
            expect.objectContaining({
                library: 'site',
                site_category: 'About',
                service: null,
                sub_category: null,
                aspect_ratio: 'portrait',
                status: 'published',
            })
        )
        expect(item).toEqual(
            expect.objectContaining({
                library: 'site',
                siteCategory: 'About',
                service: null,
                subCategory: null,
                status: 'published',
            })
        )
    })

    it('requires site category before publishing site media', async () => {
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
            { data: { ...draftSiteItem, site_category: null }, error: null },
        ]

        await expect(
            mediaCatalogService.updateItem({
                websiteSlug: 'iffers-pictures',
                id: 5,
                status: 'published',
                alt: 'Jenn standing near a portrait backdrop',
                library: 'site',
                aspectRatio: 'portrait',
            })
        ).rejects.toMatchObject({
            status: 400,
            code: 'media.missing_site_category',
        })
    })

    it('triggers public cache revalidation after publishing media', async () => {
        process.env.MEDIA_REVALIDATION_WEBHOOK_URL =
            'https://revalidate.example.test/api/revalidate'
        vi.mocked(fetch).mockResolvedValue(new Response('ok', { status: 200 }))
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
            { data: draftItem, error: null },
            {
                data: {
                    ...draftItem,
                    alt: 'Jenn photographing a portrait session',
                    service: 'Portrait',
                    sub_category: 'Portrait',
                    aspect_ratio: 'portrait',
                    status: 'published',
                },
                error: null,
            },
        ]

        await mediaCatalogService.updateItem({
            websiteSlug: 'iffers-pictures',
            id: 3,
            status: 'published',
            alt: 'Jenn photographing a portrait session',
            service: 'Portrait',
            subCategory: 'Portrait',
            aspectRatio: 'portrait',
            actor: 'jenn@example.com',
        })
        await Promise.resolve()
        await Promise.resolve()

        expect(fetch).toHaveBeenCalledWith(
            'https://revalidate.example.test/api/revalidate',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('"reason":"published"'),
            })
        )
        const [, init] = vi.mocked(fetch).mock.calls[0]
        expect(JSON.parse(String((init as RequestInit).body))).toEqual(
            expect.objectContaining({
                website_slug: 'iffers-pictures',
                media_id: 3,
                media_key: 'portrait/draft.jpg',
                actor: 'jenn@example.com',
            })
        )
    })

    it('rejects blank status values before transition handling', async () => {
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
            { data: draftItem, error: null },
        ]

        await expect(
            mediaCatalogService.updateItem({
                websiteSlug: 'iffers-pictures',
                id: 3,
                status: '',
            })
        ).rejects.toMatchObject({
            status: 400,
            code: 'media.invalid_status',
        })
        expect(mockState.builders).toHaveLength(3)
    })

    it('archives media and preserves archive metadata', async () => {
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
            {
                data: {
                    ...publishedItem,
                    status: 'archived',
                    archived_at: '2026-05-28T01:00:00.000Z',
                    archived_by: 'jenn@example.com',
                    archived_from_status: 'published',
                },
                error: null,
            },
        ]

        const item = await mediaCatalogService.updateItem({
            websiteSlug: 'iffers-pictures',
            id: 1,
            status: 'archived',
            actor: 'jenn@example.com',
        })

        expect(mockState.builders[3].update).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'archived',
                archived_at: expect.any(String),
                archived_by: 'jenn@example.com',
                archived_from_status: 'published',
            })
        )
        expect(item).toEqual(
            expect.objectContaining({
                status: 'archived',
                archivedBy: 'jenn@example.com',
                archivedFromStatus: 'published',
            })
        )
        expect(mockState.builders[4].insert).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'archived',
                actor: 'jenn@example.com',
                old_values: expect.objectContaining({
                    status: 'published',
                    archivedAt: null,
                    archivedBy: null,
                    archivedFromStatus: null,
                }),
                new_values: expect.objectContaining({
                    status: 'archived',
                    archivedBy: 'jenn@example.com',
                    archivedFromStatus: 'published',
                }),
            })
        )
    })

    it('batch archives media with partial failures and one revalidation', async () => {
        process.env.MEDIA_REVALIDATION_WEBHOOK_URL =
            'https://revalidate.example.test/api/revalidate'
        vi.mocked(fetch).mockResolvedValue(new Response('ok', { status: 200 }))
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            { data: [publishedItem, archivedItem], error: null },
            {
                data: [
                    {
                    ...publishedItem,
                    status: 'archived',
                    archived_at: '2026-05-28T01:00:00.000Z',
                    archived_by: 'jenn@example.com',
                    archived_from_status: 'published',
                    },
                ],
                error: null,
            },
            {
                data: null,
                error: null,
            },
        ]

        const result = await mediaCatalogService.batchUpdateItems({
            websiteSlug: 'iffers-pictures',
            ids: [1, 2],
            status: 'archived',
            actor: 'jenn@example.com',
        })
        await Promise.resolve()
        await Promise.resolve()

        expect(result.summary).toEqual({
            requested: 2,
            succeeded: 1,
            failed: 1,
        })
        expect(result.items[0]).toEqual(
            expect.objectContaining({
                id: 1,
                ok: true,
                item: expect.objectContaining({
                    status: 'archived',
                    archivedBy: 'jenn@example.com',
                    archivedFromStatus: 'published',
                }),
            })
        )
        expect(result.items[1]).toEqual(
            expect.objectContaining({
                id: 2,
                ok: false,
                error: expect.objectContaining({
                    status: 409,
                    code: 'media.archived_locked',
                }),
            })
        )
        expect(mockState.builders[1].in).toHaveBeenCalledWith('id', [1, 2])
        expect(mockState.builders[2].update).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'archived',
                archived_by: 'jenn@example.com',
                archived_from_status: 'published',
            })
        )
        expect(mockState.builders[2].in).toHaveBeenCalledWith('id', [1])
        expect(mockState.builders[3].insert).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'archived',
                actor: 'jenn@example.com',
                media_id: 1,
            })
        )
        expect(fetch).toHaveBeenCalledTimes(1)
        const [, init] = vi.mocked(fetch).mock.calls[0]
        expect(JSON.parse(String((init as RequestInit).body))).toEqual(
            expect.objectContaining({
                website_slug: 'iffers-pictures',
                reason: 'archived',
                actor: 'jenn@example.com',
            })
        )
        expect(JSON.parse(String((init as RequestInit).body))).not.toHaveProperty(
            'media_id'
        )
    })

    it('batch archives mixed portfolio and site images together', async () => {
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            { data: [publishedItem, publishedSiteItem], error: null },
            {
                data: [
                    {
                        ...publishedItem,
                        status: 'archived',
                        archived_at: '2026-05-28T01:00:00.000Z',
                        archived_by: 'jenn@example.com',
                        archived_from_status: 'published',
                    },
                    {
                        ...publishedSiteItem,
                        status: 'archived',
                        archived_at: '2026-05-28T01:00:00.000Z',
                        archived_by: 'jenn@example.com',
                        archived_from_status: 'published',
                    },
                ],
                error: null,
            },
            { data: null, error: null },
            { data: null, error: null },
        ]

        const result = await mediaCatalogService.batchUpdateItems({
            websiteSlug: 'iffers-pictures',
            ids: [1, 4],
            status: 'archived',
            actor: 'jenn@example.com',
        })

        expect(result.summary).toEqual({
            requested: 2,
            succeeded: 2,
            failed: 0,
        })
        expect(result.items).toEqual([
            expect.objectContaining({
                id: 1,
                ok: true,
                item: expect.objectContaining({ library: 'portfolio' }),
            }),
            expect.objectContaining({
                id: 4,
                ok: true,
                item: expect.objectContaining({ library: 'site' }),
            }),
        ])
        expect(mockState.builders[2].in).toHaveBeenCalledWith('id', [1, 4])
    })

    it('batch archives multiple published images in one grouped update', async () => {
        const secondPublishedItem = {
            ...publishedItem,
            id: 4,
            key: 'events/baby-shower/second.jpg',
            filename: 'second.jpg',
            src: 'https://pub.example.test/events/baby-shower/second.jpg',
        }
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            { data: [publishedItem, secondPublishedItem], error: null },
            {
                data: [
                    {
                        ...publishedItem,
                        status: 'archived',
                        archived_at: '2026-05-28T01:00:00.000Z',
                        archived_by: 'jenn@example.com',
                        archived_from_status: 'published',
                    },
                    {
                        ...secondPublishedItem,
                        status: 'archived',
                        archived_at: '2026-05-28T01:00:00.000Z',
                        archived_by: 'jenn@example.com',
                        archived_from_status: 'published',
                    },
                ],
                error: null,
            },
            { data: null, error: null },
            { data: null, error: null },
        ]

        const result = await mediaCatalogService.batchUpdateItems({
            websiteSlug: 'iffers-pictures',
            ids: [1, 4],
            status: 'archived',
            actor: 'jenn@example.com',
        })

        expect(result.summary).toEqual({
            requested: 2,
            succeeded: 2,
            failed: 0,
        })
        expect(result.items).toEqual([
            expect.objectContaining({ id: 1, ok: true }),
            expect.objectContaining({ id: 4, ok: true }),
        ])
        expect(mockState.builders[1].in).toHaveBeenCalledWith('id', [1, 4])
        expect(mockState.builders[2].in).toHaveBeenCalledWith('id', [1, 4])
    })

    it('deduplicates batch archive ids before querying or updating', async () => {
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            { data: [publishedItem], error: null },
            {
                data: [
                    {
                        ...publishedItem,
                        status: 'archived',
                        archived_at: '2026-05-28T01:00:00.000Z',
                        archived_by: 'jenn@example.com',
                        archived_from_status: 'published',
                    },
                ],
                error: null,
            },
            { data: null, error: null },
        ]

        const result = await mediaCatalogService.batchUpdateItems({
            websiteSlug: 'iffers-pictures',
            ids: [1, 1, 1],
            status: 'archived',
            actor: 'jenn@example.com',
        })

        expect(result.summary).toEqual({
            requested: 1,
            succeeded: 1,
            failed: 0,
        })
        expect(result.items).toHaveLength(1)
        expect(mockState.builders[1].in).toHaveBeenCalledWith('id', [1])
        expect(mockState.builders[2].in).toHaveBeenCalledWith('id', [1])
    })

    it('returns not found per-item failures in batch archive responses', async () => {
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            { data: [publishedItem], error: null },
            {
                data: [
                    {
                        ...publishedItem,
                        status: 'archived',
                        archived_at: '2026-05-28T01:00:00.000Z',
                        archived_by: 'jenn@example.com',
                        archived_from_status: 'published',
                    },
                ],
                error: null,
            },
            { data: null, error: null },
        ]

        const result = await mediaCatalogService.batchUpdateItems({
            websiteSlug: 'iffers-pictures',
            ids: [1, 99],
            status: 'archived',
            actor: 'jenn@example.com',
        })

        expect(result.summary).toEqual({
            requested: 2,
            succeeded: 1,
            failed: 1,
        })
        expect(result.items[1]).toEqual({
            id: 99,
            ok: false,
            error: {
                status: 404,
                code: 'media.not_found',
                message: 'Media catalog item not found',
            },
        })
    })

    it('rejects unsupported batch statuses', async () => {
        await expect(
            mediaCatalogService.batchUpdateItems({
                websiteSlug: 'iffers-pictures',
                ids: [1],
                status: 'published',
                actor: 'jenn@example.com',
            })
        ).rejects.toMatchObject({
            status: 400,
            code: 'media.invalid_status',
        })
        expect(mockState.from).not.toHaveBeenCalled()
    })

    it('does not query R2 config or objects during batch archive', async () => {
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            { data: [publishedItem], error: null },
            {
                data: [
                    {
                        ...publishedItem,
                        status: 'archived',
                        archived_at: '2026-05-28T01:00:00.000Z',
                        archived_by: 'jenn@example.com',
                        archived_from_status: 'published',
                    },
                ],
                error: null,
            },
            { data: null, error: null },
        ]

        await mediaCatalogService.batchUpdateItems({
            websiteSlug: 'iffers-pictures',
            ids: [1],
            status: 'archived',
            actor: 'jenn@example.com',
        })

        expect(mockState.from).not.toHaveBeenCalledWith('media_r2_configs')
    })

    it('response shape matches the frontend batch archive contract', async () => {
        mockState.queryResults = [
            { data: { id: 'website-1', client_id: 'client-1' }, error: null },
            { data: [publishedItem], error: null },
            {
                data: [
                    {
                        ...publishedItem,
                        status: 'archived',
                        archived_at: '2026-05-28T01:00:00.000Z',
                        archived_by: 'jenn@example.com',
                        archived_from_status: 'published',
                    },
                ],
                error: null,
            },
            { data: null, error: null },
        ]

        const result = await mediaCatalogService.batchUpdateItems({
            websiteSlug: 'iffers-pictures',
            ids: [1],
            status: 'archived',
            actor: 'jenn@example.com',
        })

        expect(result).toEqual({
            items: [
                {
                    id: 1,
                    ok: true,
                    item: expect.objectContaining({
                        id: 1,
                        key: 'events/baby-shower/baby.jpg',
                        filename: 'baby.jpg',
                        src: 'https://pub.example.test/events/baby-shower/baby.jpg',
                        alt: 'Mother-to-be opening gifts',
                        service: 'Events',
                        subCategory: 'Baby Shower',
                        aspectRatio: 'portrait',
                        status: 'archived',
                        sortOrder: 0,
                    }),
                },
            ],
            summary: {
                requested: 1,
                succeeded: 1,
                failed: 0,
            },
        })
    })

    it('rethrows unexpected shared failures during batch archive', async () => {
        const dbError = new Error('database unavailable')
        mockState.queryResults = [{ data: null, error: dbError }]

        await expect(
            mediaCatalogService.batchUpdateItems({
                websiteSlug: 'iffers-pictures',
                ids: [1],
                status: 'archived',
                actor: 'jenn@example.com',
            })
        ).rejects.toBe(dbError)
    })

    it('restores archived media to its previous status and clears archive metadata', async () => {
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
            { data: archivedItem, error: null },
            {
                data: {
                    ...archivedItem,
                    status: 'published',
                    archived_at: null,
                    archived_by: null,
                    archived_from_status: null,
                },
                error: null,
            },
        ]

        const item = await mediaCatalogService.updateItem({
            websiteSlug: 'iffers-pictures',
            id: 2,
            status: 'draft',
        })

        expect(mockState.builders[3].update).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'published',
                archived_at: null,
                archived_by: null,
                archived_from_status: null,
            })
        )
        expect(item).toEqual(
            expect.objectContaining({
                status: 'published',
                archivedAt: null,
                archivedBy: null,
                archivedFromStatus: null,
            })
        )
        expect(mockState.builders[4].insert).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'restored',
                old_values: expect.objectContaining({
                    status: 'archived',
                    archivedBy: 'admin@example.test',
                    archivedFromStatus: 'published',
                }),
                new_values: expect.objectContaining({
                    status: 'published',
                    archivedBy: null,
                    archivedFromStatus: null,
                }),
            })
        )
    })

    it('triggers restored revalidation when archived media returns to published', async () => {
        process.env.MEDIA_REVALIDATION_WEBHOOK_URL =
            'https://revalidate.example.test/api/revalidate'
        vi.mocked(fetch).mockResolvedValue(new Response('ok', { status: 200 }))
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
            { data: archivedItem, error: null },
            {
                data: {
                    ...archivedItem,
                    status: 'published',
                    archived_at: null,
                    archived_by: null,
                    archived_from_status: null,
                },
                error: null,
            },
        ]

        await mediaCatalogService.updateItem({
            websiteSlug: 'iffers-pictures',
            id: 2,
            status: 'draft',
            actor: 'jenn@example.com',
        })
        await Promise.resolve()
        await Promise.resolve()

        const [, init] = vi.mocked(fetch).mock.calls[0]
        expect(JSON.parse(String((init as RequestInit).body))).toEqual(
            expect.objectContaining({
                website_slug: 'iffers-pictures',
                reason: 'restored',
                media_id: 2,
                media_key: 'events/baby-shower/archived.jpg',
                actor: 'jenn@example.com',
            })
        )
    })

    it('blocks metadata edits while media is archived', async () => {
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
            { data: archivedItem, error: null },
        ]

        await expect(
            mediaCatalogService.updateItem({
                websiteSlug: 'iffers-pictures',
                id: 2,
                status: 'published',
                alt: 'Updated alt text',
            })
        ).rejects.toMatchObject({
            status: 409,
            code: 'media.archived_locked',
        })
    })

    it('logs audit failures without blocking successful catalog mutations', async () => {
        const auditError = new Error('audit unavailable')
        const consoleErrorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined)
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
                    ...draftItem,
                    key: 'portrait/audit-failure.jpg',
                    filename: 'audit-failure.jpg',
                    src: 'https://pub.example.test/portrait/audit-failure.jpg',
                },
                error: null,
            },
            { data: null, error: auditError },
        ]

        try {
            await expect(
                mediaCatalogService.createItem({
                    websiteSlug: 'iffers-pictures',
                    key: 'portrait/audit-failure.jpg',
                })
            ).resolves.toEqual(
                expect.objectContaining({
                    key: 'portrait/audit-failure.jpg',
                    status: 'draft',
                })
            )
            await Promise.resolve()
            await Promise.resolve()
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Failed to write media audit log for upload_created: portrait/audit-failure.jpg',
                auditError
            )
        } finally {
            consoleErrorSpy.mockRestore()
        }
    })
})
