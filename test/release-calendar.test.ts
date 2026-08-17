import { describe, expect, it } from 'vitest'
import {
    domaniReleaseCalendarDate,
    domaniReleaseCalendarMonth
} from '../src/lib/release-calendar'

describe('Domani release calendar', () => {
    it('keeps late-evening UTC timestamps on the prior New York date', () => {
        const instant = new Date('2026-08-17T02:30:00.000Z')
        expect(domaniReleaseCalendarDate(instant)).toBe('2026-08-16')
        expect(domaniReleaseCalendarMonth(instant)).toBe('2026-08')
    })

    it('rolls to the new date at New York midnight', () => {
        const instant = new Date('2026-08-17T04:30:00.000Z')
        expect(domaniReleaseCalendarDate(instant)).toBe('2026-08-17')
        expect(domaniReleaseCalendarMonth(instant)).toBe('2026-08')
    })
})
