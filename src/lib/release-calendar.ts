export const DOMANI_RELEASE_TIME_ZONE = 'America/New_York' as const

export const domaniReleaseCalendarDate = (now = new Date()): string => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: DOMANI_RELEASE_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now)
    const value = Object.fromEntries(
        parts
            .filter(part => ['year', 'month', 'day'].includes(part.type))
            .map(part => [part.type, part.value])
    )
    return `${value.year}-${value.month}-${value.day}`
}

export const domaniReleaseCalendarMonth = (now = new Date()): string =>
    domaniReleaseCalendarDate(now).slice(0, 7)
