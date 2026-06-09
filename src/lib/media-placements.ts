import { MediaAspectRatio } from './media-catalog'
import { MediaValidationError } from './media-r2'

export const MEDIA_PLACEMENTS_VERSION = 1

export interface MediaPlacementSlot {
    key: string
    pageLabel: string
    sectionLabel: string
    description: string
    expectedAspectRatios?: MediaAspectRatio[]
    affectedPaths: string[]
}

export const IFFERS_PICTURES_WEBSITE_SLUG = 'iffers-pictures'

export const IFFERS_MEDIA_PLACEMENT_SLOTS = [
    {
        key: 'home.hero',
        pageLabel: 'Home',
        sectionLabel: 'Hero',
        description: 'Primary homepage hero image.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/'],
    },
    {
        key: 'home.strip.1',
        pageLabel: 'Home',
        sectionLabel: 'Image Strip 1',
        description: 'First supporting image in the homepage image strip.',
        expectedAspectRatios: ['portrait', 'landscape'],
        affectedPaths: ['/'],
    },
    {
        key: 'home.strip.2',
        pageLabel: 'Home',
        sectionLabel: 'Image Strip 2',
        description: 'Second supporting image in the homepage image strip.',
        expectedAspectRatios: ['portrait', 'landscape'],
        affectedPaths: ['/'],
    },
    {
        key: 'home.meet_jenn',
        pageLabel: 'Home',
        sectionLabel: 'Meet Jenn',
        description: 'Image used beside the homepage introduction to Jenn.',
        expectedAspectRatios: ['portrait'],
        affectedPaths: ['/'],
    },
    {
        key: 'home.quote_image',
        pageLabel: 'Home',
        sectionLabel: 'Quote Image',
        description: 'Image paired with the homepage quote/testimonial section.',
        expectedAspectRatios: ['portrait', 'landscape'],
        affectedPaths: ['/'],
    },
    {
        key: 'about.hero',
        pageLabel: 'About',
        sectionLabel: 'Hero',
        description: 'Primary about page hero image.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/about'],
    },
    {
        key: 'about.beyond_camera',
        pageLabel: 'About',
        sectionLabel: 'Beyond the Camera',
        description:
            'Image used beside the Beyond the Camera section on the about page.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/about'],
    },
    {
        key: 'services.hero',
        pageLabel: 'Services',
        sectionLabel: 'Hero',
        description: 'Primary services overview hero image.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/services'],
    },
    {
        key: 'services.card.events',
        pageLabel: 'Services',
        sectionLabel: 'Events Card',
        description: 'Image used for the Events card on the services page.',
        expectedAspectRatios: ['landscape'],
        affectedPaths: ['/services'],
    },
    {
        key: 'services.card.family',
        pageLabel: 'Services',
        sectionLabel: 'Family Card',
        description: 'Image used for the Family card on the services page.',
        expectedAspectRatios: ['landscape'],
        affectedPaths: ['/services'],
    },
    {
        key: 'services.card.maternity',
        pageLabel: 'Services',
        sectionLabel: 'Maternity Card',
        description: 'Image used for the Maternity card on the services page.',
        expectedAspectRatios: ['landscape'],
        affectedPaths: ['/services'],
    },
    {
        key: 'services.card.couples-engagement',
        pageLabel: 'Services',
        sectionLabel: 'Couples & Engagement Card',
        description:
            'Image used for the Couples & Engagement card on the services page.',
        expectedAspectRatios: ['landscape'],
        affectedPaths: ['/services'],
    },
    {
        key: 'services.card.portrait',
        pageLabel: 'Services',
        sectionLabel: 'Portrait Card',
        description: 'Image used for the Portrait card on the services page.',
        expectedAspectRatios: ['landscape'],
        affectedPaths: ['/services'],
    },
    {
        key: 'services.card.custom_request',
        pageLabel: 'Services',
        sectionLabel: 'Custom Request Card',
        description:
            'Image used for the Custom Request card on the services page.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/services'],
    },
    {
        key: 'services.events.hero',
        pageLabel: 'Events',
        sectionLabel: 'Hero',
        description: 'Primary events service page hero image.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/services/events'],
    },
    {
        key: 'services.family.hero',
        pageLabel: 'Family',
        sectionLabel: 'Hero',
        description: 'Primary family service page hero image.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/services/family'],
    },
    {
        key: 'services.maternity.hero',
        pageLabel: 'Maternity',
        sectionLabel: 'Hero',
        description: 'Primary maternity service page hero image.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/services/maternity'],
    },
    {
        key: 'services.couples-engagement.hero',
        pageLabel: 'Couples & Engagement',
        sectionLabel: 'Hero',
        description: 'Primary couples and engagement service page hero image.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/services/couples-engagement'],
    },
    {
        key: 'services.portrait.hero',
        pageLabel: 'Portrait',
        sectionLabel: 'Hero',
        description: 'Primary portrait service page hero image.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/services/portrait'],
    },
    {
        key: 'portfolio.hero',
        pageLabel: 'Portfolio',
        sectionLabel: 'Hero',
        description: 'Primary portfolio page hero image.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/portfolio'],
    },
    {
        key: 'investment.hero',
        pageLabel: 'Investment',
        sectionLabel: 'Hero',
        description: 'Primary investment page hero image.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/investment'],
    },
    {
        key: 'investment.detail',
        pageLabel: 'Investment',
        sectionLabel: 'Detail',
        description: 'Supporting investment page detail image.',
        expectedAspectRatios: ['portrait', 'landscape'],
        affectedPaths: ['/investment'],
    },
    {
        key: 'faq.hero',
        pageLabel: 'FAQ',
        sectionLabel: 'Hero',
        description: 'Primary FAQ page hero image.',
        expectedAspectRatios: ['landscape', 'portrait'],
        affectedPaths: ['/faq'],
    },
] as const satisfies readonly MediaPlacementSlot[]

export type IffersMediaPlacementSlotKey =
    (typeof IFFERS_MEDIA_PLACEMENT_SLOTS)[number]['key']

export const IFFERS_MEDIA_PLACEMENT_SLOT_KEYS =
    IFFERS_MEDIA_PLACEMENT_SLOTS.map(slot => slot.key)

const SLOT_REGISTRY_BY_WEBSITE: Record<string, readonly MediaPlacementSlot[]> = {
    [IFFERS_PICTURES_WEBSITE_SLUG]: IFFERS_MEDIA_PLACEMENT_SLOTS,
}

export const getMediaPlacementSlotsForWebsite = (
    websiteSlug: string
): readonly MediaPlacementSlot[] => SLOT_REGISTRY_BY_WEBSITE[websiteSlug] || []

export const getMediaPlacementSlot = ({
    websiteSlug,
    slotKey,
}: {
    websiteSlug: string
    slotKey: string
}): MediaPlacementSlot | null =>
    getMediaPlacementSlotsForWebsite(websiteSlug).find(
        slot => slot.key === slotKey
    ) || null

export const isValidMediaPlacementSlot = ({
    websiteSlug,
    slotKey,
}: {
    websiteSlug: string
    slotKey: string
}): boolean => Boolean(getMediaPlacementSlot({ websiteSlug, slotKey }))

export const assertValidMediaPlacementSlot = ({
    websiteSlug,
    slotKey,
}: {
    websiteSlug: string
    slotKey: string
}): MediaPlacementSlot => {
    const slot = getMediaPlacementSlot({ websiteSlug, slotKey })
    if (!slot) {
        throw new MediaValidationError(
            400,
            'media.invalid_placement_slot',
            'Invalid media placement slot.',
            {
                field: 'slotKey',
                websiteSlug,
                slotKey,
                allowed: getMediaPlacementSlotsForWebsite(websiteSlug).map(
                    item => item.key
                ),
            }
        )
    }

    return slot
}
