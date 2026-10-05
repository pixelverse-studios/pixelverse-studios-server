import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/domani-db', () => ({ domaniDb: {} }))

import {
    assertDomaniSchemaContract,
    MIN_DOMANI_SCHEMA_VERSION,
} from '../src/lib/domani-schema-contract'

describe('Domani schema contract at PVS startup', () => {
    it('accepts the required version and later versions', async () => {
        for (const version of [MIN_DOMANI_SCHEMA_VERSION, '20261005002529']) {
            await expect(
                assertDomaniSchemaContract(async () => ({ data: version, error: null }))
            ).resolves.toBeUndefined()
        }
    })

    it('blocks an older or malformed version with an actionable error', async () => {
        await expect(
            assertDomaniSchemaContract(async () => ({ data: '20260920191645', error: null }))
        ).rejects.toThrow('Apply the pending Domani migrations')
        await expect(
            assertDomaniSchemaContract(async () => ({ data: null, error: null }))
        ).rejects.toThrow('invalid schema contract version')
    })

    it('blocks a missing RPC or unavailable database', async () => {
        await expect(
            assertDomaniSchemaContract(async () => ({ data: null, error: { message: 'function not found' } }))
        ).rejects.toThrow('Apply the Domani pvs_schema_contract migration')
        await expect(
            assertDomaniSchemaContract(async () => { throw new Error('network unavailable') })
        ).rejects.toThrow('Check the Domani database connection')
    })
})
