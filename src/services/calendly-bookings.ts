import { db, Tables } from '../lib/db'

export interface CalendlyBookingPayload {
    prospectId: string
    calendlyEventUri: string
    calendlyInviteeUri: string
    eventTypeName: string
    eventStartAt: string
    eventEndAt: string
    cancelUrl: string
    rescheduleUrl: string
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
        .eq('calendly_event_uri', eventUri)
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

export const cancelBooking = async (
    eventUri: string
): Promise<CalendlyBookingRecord | null> => {
    const { data, error } = await db
        .from(Tables.CALENDLY_BOOKINGS)
        .update({ canceled: true, canceled_at: new Date().toISOString() })
        .eq('calendly_event_uri', eventUri)
        .select()
        .maybeSingle()

    if (error) throw error
    return data as CalendlyBookingRecord | null
}

const calendlyBookingsService = { findBookingByEventUri, createBooking, cancelBooking }

export default calendlyBookingsService
