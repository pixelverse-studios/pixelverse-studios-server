import { db, Tables, COLUMNS } from '../lib/db'
import {
    sanitizeAttribution,
    AttributionPayload,
    AttributionTouch,
    AttributionConversion,
} from '../utils/attribution'

export interface CalendlyBookingPayload {
    prospectId: string
    calendlyEventUri: string
    calendlyInviteeUri: string
    eventTypeName: string
    eventStartAt: string
    eventEndAt: string
    cancelUrl: string | null
    rescheduleUrl: string | null
    attribution?: unknown
}

export interface CalendlyBookingRecord {
    id: string
    prospect_id: string
    calendly_event_uri: string
    calendly_invitee_uri: string | null
    event_type_name: string | null
    event_start_at: string | null
    event_end_at: string | null
    cancel_url: string | null
    reschedule_url: string | null
    attribution: AttributionPayload | null
    canceled: boolean
    canceled_at: string | null
    created_at: string
}

const CALENDLY_ACTION_URL_PATTERN =
    /https:\/\/calendly\.com\/(?:cancellations|reschedulings)\//i
const ENCODED_CALENDLY_ACTION_URL_PATTERN =
    /https?%3A%2F%2Fcalendly\.com%2F(?:cancellations|reschedulings)%2F/i

const includesCalendlyActionUrl = (value: string): boolean => {
    const trimmed = value.trim()
    return (
        CALENDLY_ACTION_URL_PATTERN.test(trimmed) ||
        ENCODED_CALENDLY_ACTION_URL_PATTERN.test(trimmed)
    )
}

const omitCalendlyActionUrlsFromSection = <
    Section extends AttributionTouch | AttributionConversion,
>(
    section: Section | null | undefined
): Section | undefined => {
    if (!section) return undefined

    const filtered = Object.fromEntries(
        Object.entries(section).filter(([, value]) => {
            return (
                typeof value === 'string' &&
                !includesCalendlyActionUrl(value)
            )
        })
    ) as Section

    return Object.keys(filtered).length > 0 ? filtered : undefined
}

const omitCalendlyActionUrlsFromAttribution = (
    attribution: AttributionPayload | null
): AttributionPayload | null => {
    if (!attribution) return null

    const firstTouch = omitCalendlyActionUrlsFromSection(attribution.first_touch)
    const latestTouch = omitCalendlyActionUrlsFromSection(attribution.latest_touch)
    const conversion = omitCalendlyActionUrlsFromSection(attribution.conversion)

    const filtered: AttributionPayload = {}
    if (firstTouch) filtered.first_touch = firstTouch
    if (latestTouch) filtered.latest_touch = latestTouch
    if (conversion) filtered.conversion = conversion

    return Object.keys(filtered).length > 0 ? filtered : null
}

export const findBookingByEventUri = async (
    eventUri: string
): Promise<CalendlyBookingRecord | null> => {
    const { data, error } = await db
        .from(Tables.CALENDLY_BOOKINGS)
        .select('*')
        .eq(COLUMNS.CALENDLY_EVENT_URI, eventUri)
        .maybeSingle()

    if (error) throw error
    return data as CalendlyBookingRecord | null
}

export const createBooking = async (
    payload: CalendlyBookingPayload
): Promise<CalendlyBookingRecord> => {
    const attribution = omitCalendlyActionUrlsFromAttribution(
        sanitizeAttribution(payload.attribution)
    )

    const { data, error } = await db
        .from(Tables.CALENDLY_BOOKINGS)
        .insert({
            prospect_id: payload.prospectId,
            calendly_event_uri: payload.calendlyEventUri,
            calendly_invitee_uri: payload.calendlyInviteeUri,
            event_type_name: payload.eventTypeName,
            event_start_at: payload.eventStartAt,
            event_end_at: payload.eventEndAt,
            cancel_url: payload.cancelUrl,
            reschedule_url: payload.rescheduleUrl,
            ...(attribution && { attribution }),
        })
        .select()
        .single()

    if (error) throw error
    return data as CalendlyBookingRecord
}

const calendlyBookingsService = { findBookingByEventUri, createBooking }

export default calendlyBookingsService
