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

vi.mock('../src/services/media-audit', () => ({
    default: {
        tryCreateLog: vi.fn(),
    },
}))

vi.mock('../src/services/media-revalidation', () => ({
    tryTriggerMediaRevalidation: vi.fn(),
}))

import mediaPlacementsService from '../src/services/media-placements'
import mediaAuditService from '../src/services/media-audit'
import { tryTriggerMediaRevalidation } from '../src/services/media-revalidation'

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
    library: 'portfolio',
    site_category: null,
    service: 'Events',
    sub_category: 'Baby Shower',
    aspect_ratio: 'portrait',
    crop_position: 'center bottom',
    status: 'published',
    sort_order: 0,
    created_at: '2026-06-06T12:00:00.000Z',
    updated_at: '2026-06-06T12:00:00.000Z',
    archived_at: null,
    archived_by: null,
    archived_from_status: null,
}

const publishedSiteMedia = {
    ...publishedMedia,
    id: 4,
    key: 'site/about/jenn-portrait.jpg',
    filename: 'jenn-portrait.jpg',
    src: 'https://media.ifferspictures.com/site/about/jenn-portrait.jpg',
    alt: 'Jenn portrait for the about page',
    library: 'site',
    site_category: 'About',
    service: null,
    sub_category: null,
    aspect_ratio: 'portrait',
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

const newPlacementSlots = [
    { slotKey: 'about.beyond_camera', affectedPaths: ['/about'] },
    { slotKey: 'services.card.events', affectedPaths: ['/services'] },
    { slotKey: 'services.card.family', affectedPaths: ['/services'] },
    { slotKey: 'services.card.maternity', affectedPaths: ['/services'] },
    {
        slotKey: 'services.card.couples-engagement',
        affectedPaths: ['/services'],
    },
    { slotKey: 'services.card.portrait', affectedPaths: ['/services'] },
    { slotKey: 'services.card.custom_request', affectedPaths: ['/services'] },
    { slotKey: 'inquire.what_happens_next', affectedPaths: ['/contact'] },
]

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
        vi.mocked(mediaAuditService.tryCreateLog).mockReset()
        vi.mocked(tryTriggerMediaRevalidation).mockReset()
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
                        library: 'portfolio',
                        siteCategory: null,
                        service: 'Events',
                        subCategory: 'Baby Shower',
                        aspectRatio: 'portrait',
                        aspect_ratio: 'portrait',
                        cropPosition: 'center bottom',
                        status: 'published',
                    },
                },
            ],
        })
        expect(mockState.builders[3].in).toHaveBeenCalledWith('id', [1, 2, 3])
    })

    it('returns published site media through public placement assignments', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: r2Config, error: null },
            {
                data: [{ ...placement, slot_key: 'about.hero', media_id: 4 }],
                error: null,
            },
            { data: [publishedSiteMedia], error: null },
        ]

        const result = await mediaPlacementsService.listPublicPlacements({
            websiteSlug: 'iffers-pictures',
        })

        expect(result.placements).toEqual([
            {
                slotKey: 'about.hero',
                media: expect.objectContaining({
                    id: 4,
                    key: 'site/about/jenn-portrait.jpg',
                    library: 'site',
                    siteCategory: 'About',
                    service: null,
                    subCategory: null,
                    status: 'published',
                    cropPosition: 'center bottom',
                }),
            },
        ])
    })

    it('returns assignments for new about and services card placement slots', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: r2Config, error: null },
            {
                data: newPlacementSlots.map((slot, index) => ({
                    ...placement,
                    id: 20 + index,
                    slot_key: slot.slotKey,
                    media_id: 1,
                })),
                error: null,
            },
            { data: [publishedMedia], error: null },
        ]

        const result = await mediaPlacementsService.listPublicPlacements({
            websiteSlug: 'iffers-pictures',
        })

        expect(result.placements.map(item => item.slotKey)).toEqual(
            newPlacementSlots.map(slot => slot.slotKey)
        )
        expect(result.placements).toEqual(
            newPlacementSlots.map(slot =>
                expect.objectContaining({
                    slotKey: slot.slotKey,
                    media: expect.objectContaining({
                        id: 1,
                        status: 'published',
                    }),
                })
            )
        )
    })

    it('allows one published media item to back multiple public placement slots', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: r2Config, error: null },
            {
                data: [
                    placement,
                    { ...placement, id: 11, slot_key: 'about.hero', media_id: 1 },
                ],
                error: null,
            },
            { data: [publishedMedia], error: null },
        ]

        const result = await mediaPlacementsService.listPublicPlacements({
            websiteSlug: 'iffers-pictures',
        })

        expect(result.placements).toEqual([
            expect.objectContaining({
                slotKey: 'home.hero',
                media: expect.objectContaining({ id: 1 }),
            }),
            expect.objectContaining({
                slotKey: 'about.hero',
                media: expect.objectContaining({ id: 1 }),
            }),
        ])
        expect(mockState.builders[3].in).toHaveBeenCalledWith('id', [1, 1])
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

        expect(result.slots).toHaveLength(24)
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
        expect(
            result.slots.find(slot => slot.slotKey === 'about.beyond_camera')
        ).toEqual(
            expect.objectContaining({
                pageLabel: 'About',
                sectionLabel: 'Beyond the Camera',
                affectedPaths: ['/about'],
                assignment: null,
            })
        )
        expect(
            result.slots.find(
                slot => slot.slotKey === 'inquire.what_happens_next'
            )
        ).toEqual(
            expect.objectContaining({
                pageLabel: 'Inquire',
                sectionLabel: 'What Happens Next',
                affectedPaths: ['/contact'],
                assignment: null,
            })
        )
        expect(
            result.slots.find(
                slot => slot.slotKey === 'services.card.couples-engagement'
            )
        ).toEqual(
            expect.objectContaining({
                pageLabel: 'Services',
                sectionLabel: 'Couples & Engagement Card',
                affectedPaths: ['/services'],
                assignment: null,
            })
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
        expect(mediaAuditService.tryCreateLog).toHaveBeenCalledWith({
            websiteId: 'website-1',
            clientId: 'client-1',
            mediaId: 1,
            mediaKey: 'events/baby-shower/baby.jpg',
            action: 'placement_assigned',
            actor: 'jenn@example.com',
            oldValues: null,
            newValues: expect.objectContaining({
                slotKey: 'home.hero',
                placementId: 10,
                mediaId: 1,
                mediaKey: 'events/baby-shower/baby.jpg',
            }),
        })
        expect(tryTriggerMediaRevalidation).toHaveBeenCalledWith({
            websiteSlug: 'iffers-pictures',
            reason: 'placement_assigned',
            mediaId: 1,
            mediaKey: 'events/baby-shower/baby.jpg',
            actor: 'jenn@example.com',
            affectedPaths: ['/'],
        })
    })

    it('allows assigning published site media to placement slots', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: publishedSiteMedia, error: null },
            { data: null, error: null },
            {
                data: { ...placement, slot_key: 'about.hero', media_id: 4 },
                error: null,
            },
        ]

        const result = await mediaPlacementsService.assignPlacement({
            websiteSlug: 'iffers-pictures',
            slotKey: 'about.hero',
            mediaId: 4,
            actor: 'jenn@example.com',
        })

        expect(result.assignment?.media).toEqual(
            expect.objectContaining({
                id: 4,
                library: 'site',
                siteCategory: 'About',
                service: null,
                subCategory: null,
            })
        )
        expect(mediaAuditService.tryCreateLog).toHaveBeenCalledWith(
            expect.objectContaining({
                mediaId: 4,
                mediaKey: 'site/about/jenn-portrait.jpg',
                action: 'placement_assigned',
                newValues: expect.objectContaining({
                    library: 'site',
                    siteCategory: 'About',
                }),
            })
        )
    })

    it.each(newPlacementSlots)(
        'assigns a published media item to $slotKey',
        async ({ slotKey, affectedPaths }) => {
            mockState.queryResults = [
                { data: website, error: null },
                { data: publishedMedia, error: null },
                { data: null, error: null },
                { data: { ...placement, slot_key: slotKey }, error: null },
            ]

            const result = await mediaPlacementsService.assignPlacement({
                websiteSlug: 'iffers-pictures',
                slotKey,
                mediaId: 1,
                actor: 'jenn@example.com',
            })

            expect(mockState.builders[3].insert).toHaveBeenCalledWith({
                website_id: 'website-1',
                client_id: 'client-1',
                slot_key: slotKey,
                media_id: 1,
                updated_by: 'jenn@example.com',
            })
            expect(result).toEqual(
                expect.objectContaining({
                    slotKey,
                    assignment: expect.objectContaining({
                        media: expect.objectContaining({ id: 1 }),
                    }),
                })
            )
            expect(tryTriggerMediaRevalidation).toHaveBeenCalledWith(
                expect.objectContaining({
                    reason: 'placement_assigned',
                    affectedPaths,
                })
            )
        }
    )

    it('replaces an existing placement row', async () => {
        const replacementMedia = {
            ...publishedMedia,
            id: 4,
            key: 'events/replacement.jpg',
            filename: 'replacement.jpg',
            src: 'https://media.ifferspictures.com/events/replacement.jpg',
        }
        mockState.queryResults = [
            { data: website, error: null },
            { data: replacementMedia, error: null },
            { data: placement, error: null },
            { data: publishedMedia, error: null },
            { data: { ...placement, media_id: 4 }, error: null },
        ]

        await mediaPlacementsService.assignPlacement({
            websiteSlug: 'iffers-pictures',
            slotKey: 'home.hero',
            mediaId: 4,
            actor: 'jenn@example.com',
        })

        expect(mockState.builders[4].update).toHaveBeenCalledWith({
            website_id: 'website-1',
            client_id: 'client-1',
            slot_key: 'home.hero',
            media_id: 4,
            updated_by: 'jenn@example.com',
        })
        expect(mockState.builders[4].eq).toHaveBeenCalledWith('id', 10)
        expect(mediaAuditService.tryCreateLog).toHaveBeenCalledWith({
            websiteId: 'website-1',
            clientId: 'client-1',
            mediaId: 4,
            mediaKey: 'events/replacement.jpg',
            action: 'placement_replaced',
            actor: 'jenn@example.com',
            oldValues: expect.objectContaining({
                slotKey: 'home.hero',
                mediaId: 1,
                mediaKey: 'events/baby-shower/baby.jpg',
            }),
            newValues: expect.objectContaining({
                slotKey: 'home.hero',
                mediaId: 4,
                mediaKey: 'events/replacement.jpg',
            }),
        })
        expect(tryTriggerMediaRevalidation).toHaveBeenCalledWith({
            websiteSlug: 'iffers-pictures',
            reason: 'placement_replaced',
            mediaId: 4,
            mediaKey: 'events/replacement.jpg',
            actor: 'jenn@example.com',
            affectedPaths: ['/'],
        })
    })

    it('does not audit or revalidate when assigning the same media id again', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: publishedMedia, error: null },
            { data: placement, error: null },
            { data: placement, error: null },
        ]

        await mediaPlacementsService.assignPlacement({
            websiteSlug: 'iffers-pictures',
            slotKey: 'home.hero',
            mediaId: 1,
            actor: 'jenn@example.com',
        })

        expect(mediaAuditService.tryCreateLog).not.toHaveBeenCalled()
        expect(tryTriggerMediaRevalidation).not.toHaveBeenCalled()
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

    it('rejects missing media assignment without audit or revalidation side effects', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: null, error: null },
        ]

        await expect(
            mediaPlacementsService.assignPlacement({
                websiteSlug: 'iffers-pictures',
                slotKey: 'home.hero',
                mediaId: 404,
            })
        ).rejects.toMatchObject({
            status: 404,
        })
        expect(mediaAuditService.tryCreateLog).not.toHaveBeenCalled()
        expect(tryTriggerMediaRevalidation).not.toHaveBeenCalled()
    })

    it('targets placement revalidation paths from the assigned slot metadata', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: publishedMedia, error: null },
            { data: null, error: null },
            { data: { ...placement, slot_key: 'about.hero' }, error: null },
        ]

        await mediaPlacementsService.assignPlacement({
            websiteSlug: 'iffers-pictures',
            slotKey: 'about.hero',
            mediaId: 1,
            actor: 'jenn@example.com',
        })

        expect(tryTriggerMediaRevalidation).toHaveBeenCalledWith(
            expect.objectContaining({
                reason: 'placement_assigned',
                affectedPaths: ['/about'],
            })
        )
    })

    it('clears an existing placement by deleting the row', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: placement, error: null },
            { data: publishedMedia, error: null },
            { data: null, error: null },
        ]

        const result = await mediaPlacementsService.clearPlacement({
            websiteSlug: 'iffers-pictures',
            slotKey: 'home.hero',
        })

        expect(result).toEqual({ cleared: true, slotKey: 'home.hero' })
        expect(mockState.builders[3].delete).toHaveBeenCalled()
        expect(mockState.builders[3].eq).toHaveBeenCalledWith('id', 10)
        expect(mediaAuditService.tryCreateLog).toHaveBeenCalledWith({
            websiteId: 'website-1',
            clientId: 'client-1',
            mediaId: 1,
            mediaKey: 'events/baby-shower/baby.jpg',
            action: 'placement_cleared',
            actor: undefined,
            oldValues: expect.objectContaining({
                slotKey: 'home.hero',
                mediaId: 1,
                mediaKey: 'events/baby-shower/baby.jpg',
            }),
            newValues: null,
        })
        expect(tryTriggerMediaRevalidation).toHaveBeenCalledWith({
            websiteSlug: 'iffers-pictures',
            reason: 'placement_cleared',
            mediaId: 1,
            mediaKey: 'events/baby-shower/baby.jpg',
            actor: undefined,
            affectedPaths: ['/'],
        })
    })

    it.each(newPlacementSlots)(
        'clears $slotKey placement assignments',
        async ({ slotKey, affectedPaths }) => {
            mockState.queryResults = [
                { data: website, error: null },
                { data: { ...placement, slot_key: slotKey }, error: null },
                { data: publishedMedia, error: null },
                { data: null, error: null },
            ]

            const result = await mediaPlacementsService.clearPlacement({
                websiteSlug: 'iffers-pictures',
                slotKey,
            })

            expect(result).toEqual({ cleared: true, slotKey })
            expect(mockState.builders[3].delete).toHaveBeenCalled()
            expect(mockState.builders[3].eq).toHaveBeenCalledWith('id', 10)
            expect(tryTriggerMediaRevalidation).toHaveBeenCalledWith(
                expect.objectContaining({
                    reason: 'placement_cleared',
                    affectedPaths,
                })
            )
        }
    )

    it('does not audit or revalidate when clearing an empty placement slot', async () => {
        mockState.queryResults = [
            { data: website, error: null },
            { data: null, error: null },
        ]

        const result = await mediaPlacementsService.clearPlacement({
            websiteSlug: 'iffers-pictures',
            slotKey: 'home.hero',
        })

        expect(result).toEqual({ cleared: false, slotKey: 'home.hero' })
        expect(mediaAuditService.tryCreateLog).not.toHaveBeenCalled()
        expect(tryTriggerMediaRevalidation).not.toHaveBeenCalled()
    })
})
