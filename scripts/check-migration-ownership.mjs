import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = process.argv[2]
    ? resolve(process.argv[2])
    : fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const forbiddenName = /domani|release|feedback|user_insight|activity_projection/i
const forbiddenSql = /\b(?:domani_\w*|dashboard_domani_\w*|release_\w*|releases|beta_feedback|support_requests|profiles(?:_dashboard)?|waitlist)\b/i
// These existing PVS actor-verification migrations only read Supabase auth data.
// Any new auth reference or change to these files requires an explicit review here.
const reviewedAuthMigrations = new Map([
    ['20260928175702_verify_pvs_dashboard_actor.sql', '127d8be863cd622c937bbfe2bcf150ddbaeadc3fcbc2816d7f85e04efcfb2b6a'],
    ['20260928180942_harden_pvs_dashboard_actor_verification.sql', 'f4d52784c2dab9f305d329d487c58f08bba6df910d3e5a7864a918c52765a9e3'],
])

const violations = readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .filter(name => {
        const contents = readFileSync(join(migrationsDir, name))
        const sql = contents.toString('utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/--[^\n]*/g, '')
        const reviewedHash = reviewedAuthMigrations.get(name)
        const authViolation = reviewedHash
            ? createHash('sha256').update(contents).digest('hex') !== reviewedHash
            : /\bauth\b/i.test(sql)
        return forbiddenName.test(name) || forbiddenSql.test(sql) || authViolation
    })

if (violations.length) {
    console.error('PVS migration ownership violations (Domani schema or unreviewed auth SQL):')
    violations.forEach(name => console.error(`  ${name}`))
    process.exitCode = 1
} else {
    console.log('PVS migration ownership check passed')
}
