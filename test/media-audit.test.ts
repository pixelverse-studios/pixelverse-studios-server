import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
    from: vi.fn(),
    insert: vi.fn(),
}))

vi.mock('../src/lib/db', () => ({
    db: {
        from: mockState.from,
    },
    Tables: {
        MEDIA_AUDIT_LOGS: 'media_audit_logs',
    },
}))

import mediaAuditService from '../src/services/media-audit'

describe('media audit service', () => {
    beforeEach(() => {
        mockState.from.mockReset()
        mockState.insert.mockReset()
        mockState.from.mockReturnValue({
            insert: mockState.insert,
        })
    })

    it('writes media audit log rows with placement action payloads', async () => {
        mockState.insert.mockResolvedValue({ error: null })

        await mediaAuditService.createLog({
            websiteId: 'website-1',
            clientId: 'client-1',
            mediaId: 1,
            mediaKey: 'events/baby-shower/baby.jpg',
            action: 'placement_assigned',
            actor: 'jenn@example.com',
            oldValues: null,
            newValues: {
                slotKey: 'home.hero',
                mediaId: 1,
            },
        })

        expect(mockState.from).toHaveBeenCalledWith('media_audit_logs')
        expect(mockState.insert).toHaveBeenCalledWith({
            website_id: 'website-1',
            client_id: 'client-1',
            media_id: 1,
            media_key: 'events/baby-shower/baby.jpg',
            action: 'placement_assigned',
            actor: 'jenn@example.com',
            old_values: null,
            new_values: {
                slotKey: 'home.hero',
                mediaId: 1,
            },
        })
    })

    it('logs and suppresses audit write failures through tryCreateLog', async () => {
        const error = new Error('audit unavailable')
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        mockState.insert.mockResolvedValue({ error })

        await expect(
            mediaAuditService.tryCreateLog({
                websiteId: 'website-1',
                clientId: 'client-1',
                mediaId: 1,
                mediaKey: 'events/baby-shower/baby.jpg',
                action: 'placement_replaced',
                oldValues: { slotKey: 'home.hero', mediaId: 1 },
                newValues: { slotKey: 'home.hero', mediaId: 2 },
            })
        ).resolves.toBeUndefined()

        expect(consoleSpy).toHaveBeenCalledWith(
            'Failed to write media audit log for placement_replaced: events/baby-shower/baby.jpg',
            error
        )
    })
})
