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
            'home.strip.3',
            'home.meet_jenn',
            'home.quote_image',
            'about.hero',
            'about.beyond_camera',
            'services.hero',
            'services.card.events',
            'services.card.family',
            'services.card.maternity',
            'services.card.couples-engagement',
            'services.card.portrait',
            'services.card.custom_request',
            'services.events.hero',
            'services.family.hero',
            'services.maternity.hero',
            'services.couples-engagement.hero',
            'services.portrait.hero',
            'portfolio.hero',
            'investment.hero',
            'investment.detail',
            'inquire.what_happens_next',
            'faq.hero',
            'faq.cta',
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

    it('returns metadata for new about and services card slots', () => {
        expect(
            getMediaPlacementSlot({
                websiteSlug: IFFERS_PICTURES_WEBSITE_SLUG,
                slotKey: 'about.beyond_camera',
            })
        ).toEqual(
            expect.objectContaining({
                key: 'about.beyond_camera',
                pageLabel: 'About',
                sectionLabel: 'Beyond the Camera',
                expectedAspectRatios: ['landscape', 'portrait'],
                affectedPaths: ['/about'],
            })
        )

        expect(
            getMediaPlacementSlot({
                websiteSlug: IFFERS_PICTURES_WEBSITE_SLUG,
                slotKey: 'services.card.couples-engagement',
            })
        ).toEqual(
            expect.objectContaining({
                key: 'services.card.couples-engagement',
                pageLabel: 'Services',
                sectionLabel: 'Couples & Engagement Card',
                expectedAspectRatios: ['landscape'],
                affectedPaths: ['/services'],
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
        ).toHaveLength(26)
    })

    it('returns metadata for all homepage image strip slots', () => {
        expect(
            getMediaPlacementSlot({
                websiteSlug: IFFERS_PICTURES_WEBSITE_SLUG,
                slotKey: 'home.strip.3',
            })
        ).toEqual(
            expect.objectContaining({
                key: 'home.strip.3',
                pageLabel: 'Home',
                sectionLabel: 'Image Strip 3',
                description:
                    'Third supporting image in the homepage image strip.',
                expectedAspectRatios: ['portrait', 'landscape'],
                affectedPaths: ['/'],
            })
        )
    })

    it('returns metadata for the Inquire page image slot', () => {
        expect(
            getMediaPlacementSlot({
                websiteSlug: IFFERS_PICTURES_WEBSITE_SLUG,
                slotKey: 'inquire.what_happens_next',
            })
        ).toEqual(
            expect.objectContaining({
                key: 'inquire.what_happens_next',
                pageLabel: 'Inquire',
                sectionLabel: 'What Happens Next',
                description:
                    'Image used beside the What Happens Next steps on the inquire page.',
                expectedAspectRatios: ['landscape', 'portrait'],
                affectedPaths: ['/inquire'],
            })
        )
    })

    it('returns metadata for the FAQ bottom CTA image slot', () => {
        expect(
            getMediaPlacementSlot({
                websiteSlug: IFFERS_PICTURES_WEBSITE_SLUG,
                slotKey: 'faq.cta',
            })
        ).toEqual(
            expect.objectContaining({
                key: 'faq.cta',
                pageLabel: 'FAQ',
                sectionLabel: 'Still Have Questions',
                description: 'Image paired with the FAQ page bottom CTA.',
                expectedAspectRatios: ['portrait', 'landscape'],
                affectedPaths: ['/faq'],
            })
        )
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
