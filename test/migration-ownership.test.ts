import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const created: string[] = []
const check = (name: string, sql: string): boolean => {
    const dir = mkdtempSync(join(tmpdir(), 'pvs-migration-ownership-'))
    created.push(dir)
    writeFileSync(join(dir, name), sql)
    try {
        execFileSync(process.execPath, [resolve('scripts/check-migration-ownership.mjs'), dir])
        return true
    } catch {
        return false
    }
}

afterEach(() => {
    created.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }))
})

describe('PVS migration ownership check', () => {
    it('allows a PVS function to read auth data', () => {
        expect(check('20261001_pvs_actor.sql', 'CREATE FUNCTION public.verify_pvs_actor() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM auth.users LIMIT 1 $$;')).toBe(true)
    })

    it('rejects Domani profiles even under a generic filename', () => {
        expect(check('20261001_update_schema.sql', 'ALTER TABLE public.profiles ADD COLUMN reviewer_note text;')).toBe(false)
    })

    it('rejects DDL targeting the auth schema', () => {
        expect(check('20261001_update_schema.sql', 'ALTER TABLE auth.users ADD COLUMN reviewer_note text;')).toBe(false)
        expect(check('20261001_update_schema.sql', 'ALTER TABLE ONLY auth.users ADD COLUMN reviewer_note text;')).toBe(false)
        expect(check('20261001_update_schema.sql', 'ALTER TABLE IF EXISTS ONLY "auth"."users" ADD COLUMN reviewer_note text;')).toBe(false)
        expect(check('20261001_update_schema.sql', 'CREATE POLICY staff_read ON auth.users FOR SELECT USING (true);')).toBe(false)
        expect(check('20261001_update_schema.sql', 'CREATE POLICY "staff read" ON auth.users FOR SELECT USING (true);')).toBe(false)
    })
})
