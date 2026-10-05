import { readdirSync, readFileSync } from 'node:fs'

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const forbiddenName = /domani|release|feedback|user_insight|activity_projection/i
const forbiddenSql = /\b(?:domani_\w*|dashboard_domani_\w*|release_notes|release_prds|releases|beta_feedback|support_requests|profiles_dashboard)\b/i

const violations = readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .filter(name => {
        const sql = readFileSync(new URL(name, migrationsDir), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/--[^\n]*/g, '')
        return forbiddenName.test(name) || forbiddenSql.test(sql)
    })

if (violations.length) {
    console.error('Domani schema migrations belong in domani-app/supabase/migrations:')
    violations.forEach(name => console.error(`  ${name}`))
    process.exitCode = 1
} else {
    console.log('PVS migration ownership check passed')
}
