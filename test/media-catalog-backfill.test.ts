import { describe, expect, it } from 'vitest'

import {
    buildMediaCatalogBackfillRows,
    keyFromPublicUrl,
} from '../src/utils/media-catalog-backfill'

describe('media catalog backfill helpers', () => {
    it('derives safe R2 keys from public URLs', () => {
        expect(
            keyFromPublicUrl({
                src: 'https://pub.example.test/events/baby-shower/image-01.jpg',
                sourcePublicBaseUrl: 'https://pub.example.test',
            })
        ).toBe('events/baby-shower/image-01.jpg')
    })

    it('maps portfolio source metadata to published catalog rows', () => {
        const rows = buildMediaCatalogBackfillRows({
            websiteId: 'website-1',
            clientId: 'client-1',
            sourcePublicBaseUrl: 'https://pub.example.test',
            catalogPublicBaseUrl: 'https://media.example.test',
            items: [
                {
                    id: 42,
                    src: 'https://pub.example.test/events/baby-shower/image-01.jpg',
                    alt: 'Baby shower detail table',
                    service: 'Events',
                    subCategory: 'Baby Shower',
                    aspectRatio: 'portrait',
                },
            ],
        })

        expect(rows).toEqual([
            {
                website_id: 'website-1',
                client_id: 'client-1',
                key: 'events/baby-shower/image-01.jpg',
                filename: 'image-01.jpg',
                src: 'https://media.example.test/events/baby-shower/image-01.jpg',
                alt: 'Baby shower detail table',
                service: 'Events',
                sub_category: 'Baby Shower',
                aspect_ratio: 'portrait',
                status: 'published',
                sort_order: 0,
            },
        ])
    })

    it('rejects invalid service metadata before import', () => {
        expect(() =>
            buildMediaCatalogBackfillRows({
                websiteId: 'website-1',
                clientId: 'client-1',
                sourcePublicBaseUrl: 'https://pub.example.test',
                catalogPublicBaseUrl: 'https://pub.example.test',
                items: [
                    {
                        id: 42,
                        src: 'https://pub.example.test/image.jpg',
                        alt: 'Invalid metadata',
                        service: 'Events',
                        subCategory: 'Portrait',
                        aspectRatio: 'portrait',
                    },
                ],
            })
        ).toThrow('invalid subCategory')
    })
})
