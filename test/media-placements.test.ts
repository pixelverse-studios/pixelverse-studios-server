import { describe, expect, it } from 'vitest'

import {
    IFFERS_MEDIA_PLACEMENT_SLOT_KEYS,
    IFFERS_PICTURES_WEBSITE_SLUG,
    assertValidMediaPlacementSlot,
    getMediaPlacementSlot,
    getMediaPlacementSlotsForWebsite,
    isValidMediaPlacementSlot,
} from '../src/lib/media-placements'
import { MediaValidationError } from '../src/lib/media-r2'

describe('media placement slot registry', () => {
    it('only exposes keys accepted by the database slot_key check', () => {
        const dbSafeSlotKeyPattern = /^[a-z0-9]+([._-][a-z0-9]+)*$/

        IFFERS_MEDIA_PLACEMENT_SLOT_KEYS.forEach(slotKey => {
            expect(slotKey).toMatch(dbSafeSlotKeyPattern)
        })
    })

    it('exposes the allowed Iffers placement keys', () => {
        expect(IFFERS_MEDIA_PLACEMENT_SLOT_KEYS).toEqual([
            'home.hero',
            'home.strip.1',
            'home.strip.2',
            'home.meet_jenn',
            'home.quote_image',
            'about.hero',
            'services.hero',
            'services.events.hero',
            'services.family.hero',
            'services.maternity.hero',
            'services.couples-engagement.hero',
            'services.portrait.hero',
            'portfolio.hero',
            'investment.hero',
            'investment.detail',
            'faq.hero',
        ])
    })

    it('returns slot metadata for admin display and revalidation targeting', () => {
        const slot = getMediaPlacementSlot({
            websiteSlug: IFFERS_PICTURES_WEBSITE_SLUG,
            slotKey: 'services.maternity.hero',
        })

        expect(slot).toEqual(
            expect.objectContaining({
                key: 'services.maternity.hero',
                pageLabel: 'Maternity',
                sectionLabel: 'Hero',
                affectedPaths: ['/services/maternity'],
            })
        )
    })

    it('validates known slots for the configured website', () => {
        expect(
            isValidMediaPlacementSlot({
                websiteSlug: IFFERS_PICTURES_WEBSITE_SLUG,
                slotKey: 'home.hero',
            })
        ).toBe(true)
        expect(
            getMediaPlacementSlotsForWebsite(IFFERS_PICTURES_WEBSITE_SLUG)
        ).toHaveLength(16)
    })

    it('rejects unknown placement slots with a structured media error', () => {
        expect(() =>
            assertValidMediaPlacementSlot({
                websiteSlug: IFFERS_PICTURES_WEBSITE_SLUG,
                slotKey: 'home.unknown',
            })
        ).toThrow(MediaValidationError)

        try {
            assertValidMediaPlacementSlot({
                websiteSlug: IFFERS_PICTURES_WEBSITE_SLUG,
                slotKey: 'home.unknown',
            })
        } catch (err) {
            expect(err).toMatchObject({
                status: 400,
                code: 'media.invalid_placement_slot',
            })
        }
    })
})
