const TOUCH_FIELDS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'src_code',
    'promo_code',
    'landing_page',
    'referrer',
    'captured_at',
] as const

const CONVERSION_FIELDS = [
    'conversion_page',
    'conversion_type',
    'converted_at',
] as const

type TouchField = (typeof TOUCH_FIELDS)[number]
type ConversionField = (typeof CONVERSION_FIELDS)[number]

export type AttributionTouch = Partial<Record<TouchField, string>>
export type AttributionConversion = Partial<Record<ConversionField, string>>

export interface AttributionPayload {
    first_touch?: AttributionTouch | null
    latest_touch?: AttributionTouch | null
    conversion?: AttributionConversion | null
}

const FIELD_MAX_LENGTH: Record<TouchField | ConversionField, number> = {
    utm_source: 128,
    utm_medium: 128,
    utm_campaign: 256,
    utm_content: 256,
    utm_term: 256,
    src_code: 64,
    promo_code: 64,
    landing_page: 2048,
    referrer: 2048,
    captured_at: 64,
    conversion_page: 2048,
    conversion_type: 128,
    converted_at: 64,
}

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/
const PHONE_QUERY_PARAM_PATTERN =
    /(?:^|[?&#])(?:phone|tel|mobile|cell|sms)=[^&#]*\d/i
const PHONE_STANDALONE_PATTERN =
    /(?:^|[^\dT:-])\+?(?:\d[\s().-]?){10,15}(?=$|[^\d:-])/
const IPV4_PATTERN =
    /(?:^|[^\d])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?=$|[^\d])/
const BRACKETED_IPV6_PATTERN = /\[[a-f0-9:]*:[a-f0-9:]*:[a-f0-9:]*\]/i
const COMPRESSED_IPV6_PATTERN = /(?:^|[^a-f0-9:])[a-f0-9:]*::[a-f0-9:]*(?=$|[^a-f0-9:])/i

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)

const sanitizeStringField = (
    field: TouchField | ConversionField,
    value: unknown
): string | undefined => {
    if (typeof value !== 'string') return undefined

    const trimmed = value.trim()
    if (!trimmed) return undefined
    if (EMAIL_PATTERN.test(trimmed)) return undefined
    if (
        PHONE_QUERY_PARAM_PATTERN.test(trimmed) ||
        PHONE_STANDALONE_PATTERN.test(trimmed)
    ) {
        return undefined
    }
    if (
        IPV4_PATTERN.test(trimmed) ||
        BRACKETED_IPV6_PATTERN.test(trimmed) ||
        COMPRESSED_IPV6_PATTERN.test(trimmed)
    ) {
        return undefined
    }

    return trimmed.slice(0, FIELD_MAX_LENGTH[field])
}

const sanitizeSection = <Field extends TouchField | ConversionField>(
    value: unknown,
    allowedFields: readonly Field[]
): Partial<Record<Field, string>> | undefined => {
    if (!isPlainObject(value)) return undefined

    const sanitized: Partial<Record<Field, string>> = {}
    for (const field of allowedFields) {
        const sanitizedValue = sanitizeStringField(field, value[field])
        if (sanitizedValue) sanitized[field] = sanitizedValue
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

export const sanitizeAttribution = (
    value: unknown
): AttributionPayload | null => {
    if (!isPlainObject(value)) return null

    const firstTouch = sanitizeSection(value.first_touch, TOUCH_FIELDS)
    const latestTouch = sanitizeSection(value.latest_touch, TOUCH_FIELDS)
    const conversion = sanitizeSection(value.conversion, CONVERSION_FIELDS)

    const sanitized: AttributionPayload = {}
    if (firstTouch) sanitized.first_touch = firstTouch
    if (latestTouch) sanitized.latest_touch = latestTouch
    if (conversion) sanitized.conversion = conversion

    return Object.keys(sanitized).length > 0 ? sanitized : null
}
