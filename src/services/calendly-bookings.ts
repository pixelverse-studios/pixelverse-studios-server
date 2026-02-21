import { db, Tables, COLUMNS } from '../lib/db'

export interface CalendlyBookingPayload {
    prospectId: string
    calendlyEventUri: string
    calendlyInviteeUri: string
    eventTypeName: string
    eventStartAt: string
    eventEndAt: string
    cancelUrl: string | null
    rescheduleUrl: string | null
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
    canceled: boolean
    canceled_at: string | null
    created_at: string
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
        })
        .select()
        .single()

    if (error) throw error
    return data as CalendlyBookingRecord
}

const calendlyBookingsService = { findBookingByEventUri, createBooking }

export default calendlyBookingsService
