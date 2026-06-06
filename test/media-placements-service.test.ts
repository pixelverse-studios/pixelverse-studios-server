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
        MEDIA_PLACEMENTS: 'media_placements',
    },
    COLUMNS: {
        WEBSITE_SLUG: 'website_slug',
    },
}))

import mediaPlacementsService from '../src/services/media-placements'

const makeQueryBuilder = (result: { data: unknown; error: unknown }) => {
    const builder = {
        select: vi.fn(),
        eq: vi.fn(),
        is: vi.fn(),
        in: vi.fn(),
        order: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        maybeSingle: vi.fn(),
        single: vi.fn(),
        then: vi.fn(),
    }

    builder.select.mockReturnValue(builder)
    builder.eq.mockReturnValue(builder)
    builder.is.mockReturnValue(builder)
    builder.in.mockReturnValue(builder)
    builder.order.mockReturnValue(builder)
    builder.insert.mockReturnValue(builder)
    builder.update.mockReturnValue(builder)
    builder.delete.mockReturnValue(builder)
    builder.maybeSingle.mockResolvedValue(result)
    builder.single.mockResolvedValue(result)
    builder.then.mockImplementation((resolve, reject) =>
        Promise.resolve(result).then(resolve, reject)
    )

    return builder
}

const website = { id: 'website-1', client_id: 'client-1' }

const r2Config = {
    bucket: 'iffers-pictures',
    public_base_url: 'https://media.ifferspictures.com',
    key_prefix: '',
}

const placement = {
    id: 10,
    website_id: 'website-1',
    client_id: 'client-1',
    slot_key: 'home.hero',
    media_id: 1,
    updated_by: 'jenn@example.com',
    created_at: '2026-06-06T12:00:00.000Z',
    updated_at: '2026-06-06T12:30:00.000Z',
}

const publishedMedia = {
    id: 1,
    website_id: 'website-1',
    client_id: 'client-1',
    key: 'events/baby-shower/baby.jpg',
    filename: 'baby.jpg',
    src: 'https://media.ifferspictures.com/events/baby-shower/baby.jpg',
    alt: 'Baby shower detail',
    service: 'Events',
    sub_category: 'Baby Shower',
    aspect_ratio: 'portrait',
    status: 'published',
    sort_order: 0,
    created_at: '2026-06-06T12:00:00.000Z',
    updated_at: '2026-06-06T12:00:00.000Z',
    archived_at: null,
    archived_by: null,
    archived_from_status: null,
}

const draftMedia = {
    ...publishedMedia,
    id: 2,
    key: 'draft.jpg',
    filename: 'draft.jpg',
    status: 'draft',
}

const archivedMedia = {
    ...publishedMedia,
    id: 3,
    key: 'archived.jpg',
    filename: 'archived.jpg',
    status: 'archived',
    archived_at: '2026-06-06T14:00:00.000Z',
    archived_by: 'jenn@example.com',
    archived_from_status: 'published',
}

describe('media placements service', () => {
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

    it('returns public placements backed only by published media', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: r2Config, error: null },
            {
                data: [
                    placement,
                    { ...placement, id: 11, slot_key: 'home.strip.1', media_id: 2 },
                    { ...placement, id: 12, slot_key: 'home.strip.2', media_id: 3 },
                    { ...placement, id: 13, slot_key: 'legacy.hero', media_id: 1 },
                ],
                error: null,
            },
            { data: [publishedMedia, draftMedia, archivedMedia], error: null },
        ]

        const result = await mediaPlacementsService.listPublicPlacements({
            websiteSlug: 'iffers-pictures',
        })

        expect(result).toEqual({
            version: 1,
            publicBaseUrl: 'https://media.ifferspictures.com',
            placements: [
                {
                    slotKey: 'home.hero',
                    media: {
                        id: 1,
                        key: 'events/baby-shower/baby.jpg',
                        filename: 'baby.jpg',
                        src: 'https://media.ifferspictures.com/events/baby-shower/baby.jpg',
                        alt: 'Baby shower detail',
                        service: 'Events',
                        subCategory: 'Baby Shower',
                        aspectRatio: 'portrait',
                        status: 'published',
                    },
                },
            ],
        })
        expect(mockState.builders[3].in).toHaveBeenCalledWith('id', [1, 2, 3])
    })

    it('returns all admin slots with current assignment metadata', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: r2Config, error: null },
            { data: [placement], error: null },
            { data: [publishedMedia], error: null },
        ]

        const result = await mediaPlacementsService.listAdminPlacements({
            websiteSlug: 'iffers-pictures',
        })

        expect(result.slots).toHaveLength(16)
        expect(result.slots[0]).toEqual(
            expect.objectContaining({
                slotKey: 'home.hero',
                pageLabel: 'Home',
                assignment: expect.objectContaining({
                    id: 10,
                    updatedBy: 'jenn@example.com',
                    media: expect.objectContaining({
                        id: 1,
                        status: 'published',
                    }),
                }),
            })
        )
        expect(result.slots.find(slot => slot.slotKey === 'faq.hero')).toEqual(
            expect.objectContaining({ assignment: null })
        )
    })

    it('assigns a published media item by inserting a new placement row', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: publishedMedia, error: null },
            { data: null, error: null },
            { data: placement, error: null },
        ]

        const result = await mediaPlacementsService.assignPlacement({
            websiteSlug: 'iffers-pictures',
            slotKey: 'home.hero',
            mediaId: 1,
            actor: 'jenn@example.com',
        })

        expect(mockState.builders[3].insert).toHaveBeenCalledWith({
            website_id: 'website-1',
            client_id: 'client-1',
            slot_key: 'home.hero',
            media_id: 1,
            updated_by: 'jenn@example.com',
        })
        expect(result.assignment?.media.id).toBe(1)
    })

    it('replaces an existing placement row', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: publishedMedia, error: null },
            { data: placement, error: null },
            { data: { ...placement, media_id: 1 }, error: null },
        ]

        await mediaPlacementsService.assignPlacement({
            websiteSlug: 'iffers-pictures',
            slotKey: 'home.hero',
            mediaId: 1,
            actor: 'jenn@example.com',
        })

        expect(mockState.builders[3].update).toHaveBeenCalledWith({
            website_id: 'website-1',
            client_id: 'client-1',
            slot_key: 'home.hero',
            media_id: 1,
            updated_by: 'jenn@example.com',
        })
        expect(mockState.builders[3].eq).toHaveBeenCalledWith('id', 10)
    })

    it('rejects unknown placement slots before querying Supabase', async () => {
        await expect(
            mediaPlacementsService.assignPlacement({
                websiteSlug: 'iffers-pictures',
                slotKey: 'home.unknown',
                mediaId: 1,
            })
        ).rejects.toMatchObject({
            status: 400,
            code: 'media.invalid_placement_slot',
        })
        expect(mockState.from).not.toHaveBeenCalled()
    })

    it('rejects draft and archived media assignment', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: draftMedia, error: null },
        ]

        await expect(
            mediaPlacementsService.assignPlacement({
                websiteSlug: 'iffers-pictures',
                slotKey: 'home.hero',
                mediaId: 2,
            })
        ).rejects.toMatchObject({
            status: 409,
            code: 'media.unpublished_assignment_forbidden',
        })

        mockState.queryResults = [
            { data: website, error: null },
            { data: archivedMedia, error: null },
        ]

        await expect(
            mediaPlacementsService.assignPlacement({
                websiteSlug: 'iffers-pictures',
                slotKey: 'home.hero',
                mediaId: 3,
            })
        ).rejects.toMatchObject({
            status: 409,
            code: 'media.archived_assignment_forbidden',
        })
    })

    it('rejects cross-tenant media assignment as not found', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: null, error: null },
        ]

        await expect(
            mediaPlacementsService.assignPlacement({
                websiteSlug: 'iffers-pictures',
                slotKey: 'home.hero',
                mediaId: 999,
            })
        ).rejects.toMatchObject({
            status: 404,
        })
        expect(mockState.builders[1].eq).toHaveBeenCalledWith(
            'website_id',
            'website-1'
        )
        expect(mockState.builders[1].eq).toHaveBeenCalledWith('id', 999)
    })

    it('clears an existing placement by deleting the row', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: placement, error: null },
            { data: null, error: null },
        ]

        const result = await mediaPlacementsService.clearPlacement({
            websiteSlug: 'iffers-pictures',
            slotKey: 'home.hero',
        })

        expect(result).toEqual({ cleared: true, slotKey: 'home.hero' })
        expect(mockState.builders[2].delete).toHaveBeenCalled()
        expect(mockState.builders[2].eq).toHaveBeenCalledWith('id', 10)
    })
})
