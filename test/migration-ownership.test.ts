import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    it('allows the two reviewed PVS auth-reading migrations unchanged', () => {
        for (const name of [
            '20260928175702_verify_pvs_dashboard_actor.sql',
            '20260928180942_harden_pvs_dashboard_actor_verification.sql',
        ]) {
            expect(check(name, readFileSync(resolve('supabase/migrations', name), 'utf8'))).toBe(true)
        }
    })

    it('rejects unreviewed auth reads and changes to reviewed migrations', () => {
        const name = '20260928175702_verify_pvs_dashboard_actor.sql'
        const original = readFileSync(resolve('supabase/migrations', name), 'utf8')
        expect(check('20261001_pvs_actor.sql', 'SELECT id FROM auth.users LIMIT 1;')).toBe(false)
        expect(check(name, `${original}\nUPDATE auth.users SET email = 'changed@example.com';`)).toBe(false)
    })

    it('allows the unchanged PVS migration with an auth comment', () => {
        const name = '20260527175229_create_media_admin_auth_tables.sql'
        expect(check(name, readFileSync(resolve('supabase/migrations', name), 'utf8'))).toBe(true)
    })

    it('does not let comment markers in SQL strings hide later statements', () => {
        expect(check('20261001_pvs_actor.sql', "SELECT '--' AS marker; UPDATE auth.users SET email = 'changed@example.com';")).toBe(false)
        expect(check('20261001_pvs_actor.sql', "SELECT '/*' AS marker; CREATE INDEX users_email_idx ON auth.users (email);")).toBe(false)
        expect(check('20261001_pvs_actor.sql', "SELECT '--' AS marker; ALTER TABLE public.profiles ADD COLUMN note text;")).toBe(false)
    })

    it('requires review for any new auth mention, including comments', () => {
        expect(check('20261001_pvs_media.sql', '-- PVS media auth\nCREATE TABLE public.pvs_media (id uuid);')).toBe(false)
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
        expect(check('20261001_update_schema.sql', 'CREATE INDEX users_email_idx ON auth.users (email);')).toBe(false)
        expect(check('20261001_update_schema.sql', "UPDATE auth.users SET email = 'changed@example.com';")).toBe(false)
        expect(check('20261001_update_schema.sql', 'CREATE SCHEMA auth;')).toBe(false)
    })
})
