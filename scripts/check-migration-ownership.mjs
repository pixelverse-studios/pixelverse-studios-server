import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = process.argv[2]
    ? resolve(process.argv[2])
    : fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const forbiddenName = /domani|release|feedback|user_insight|activity_projection/i
const forbiddenSql = /\b(?:domani_\w*|dashboard_domani_\w*|release_\w*|releases|beta_feedback|support_requests|profiles(?:_dashboard)?|waitlist)\b/i
const authSchemaDdl = [
    /\b(?:CREATE(?:\s+OR\s+REPLACE)?|ALTER|DROP)\s+(?:(?:MATERIALIZED\s+)?VIEW|TABLE|FUNCTION|PROCEDURE|INDEX|TYPE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:ONLY\s+)?"?auth"?\s*\./i,
    /\b(?:CREATE|ALTER|DROP)\s+SCHEMA\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?auth"?\b/i,
    /\b(?:CREATE|ALTER|DROP)\s+POLICY\s+(?:"[^"]+"|\w+)\s+ON\s+"?auth"?\s*\./i,
    /\bCREATE\s+TRIGGER\s+(?:"[^"]+"|\w+)[\s\S]{0,200}?\bON\s+"?auth"?\s*\./i,
    /\b(?:GRANT|REVOKE|COMMENT\s+ON|TRUNCATE)\b[^;]{0,200}?\b"?auth"?\s*\./i,
]

const violations = readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .filter(name => {
        const sql = readFileSync(join(migrationsDir, name), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/--[^\n]*/g, '')
        return forbiddenName.test(name) || forbiddenSql.test(sql) || authSchemaDdl.some(pattern => pattern.test(sql))
    })

if (violations.length) {
    console.error('Domani schema migrations belong in domani-app/supabase/migrations:')
    violations.forEach(name => console.error(`  ${name}`))
    process.exitCode = 1
} else {
    console.log('PVS migration ownership check passed')
}
