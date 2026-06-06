import 'dotenv/config'

import fs from 'fs'
import path from 'path'
import vm from 'vm'
import ts from 'typescript'

import { db, Tables } from '../src/lib/db'
import {
    buildMediaCatalogBackfillRows,
    normalizePublicBaseUrl,
} from '../src/utils/media-catalog-backfill'

interface CliOptions {
    apply: boolean
    syncR2Config: boolean
    source: string
    websiteSlug: string
    sourcePublicBaseUrl?: string
    publicBaseUrl?: string
    bucket: string
    keyPrefix: string
}

interface WebsiteRecord {
    id: string
    client_id: string
}

interface R2ConfigRecord {
    id: string
    bucket: string
    public_base_url: string
    key_prefix: string
}

const DEFAULT_SOURCE = path.resolve(
    process.cwd(),
    '../../clients/iffers-pictures/src/components/features/portfolio/portfolioData.ts'
)

const usage = (): string => `Usage:
  npm run backfill:iffers-media -- [--apply] [--source <path>] [--website-slug <slug>] [--public-base-url <url>] [--bucket <name>] [--key-prefix <prefix>]

Defaults:
  --source ${DEFAULT_SOURCE}
  --website-slug iffers-pictures
  --bucket iffers-pictures
  --key-prefix ""

The script performs a dry run unless --apply is passed.
Existing R2 config is preserved unless --sync-r2-config is passed.`

const readArgValue = (args: string[], index: number, flag: string): string => {
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
        throw new Error(`${flag} requires a value`)
    }
    return value
}

const parseArgs = (args: string[]): CliOptions => {
    const options: CliOptions = {
        apply: false,
        syncR2Config: false,
        source: process.env.IFFERS_PORTFOLIO_SOURCE || DEFAULT_SOURCE,
        websiteSlug: process.env.IFFERS_WEBSITE_SLUG || 'iffers-pictures',
        sourcePublicBaseUrl: process.env.IFFERS_SOURCE_R2_PUBLIC_BASE_URL,
        publicBaseUrl: process.env.IFFERS_R2_PUBLIC_BASE_URL,
        bucket: process.env.IFFERS_R2_BUCKET || 'iffers-pictures',
        keyPrefix: process.env.IFFERS_R2_KEY_PREFIX || '',
    }

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index]
        if (arg === '--apply') {
            options.apply = true
            continue
        }
        if (arg === '--sync-r2-config') {
            options.syncR2Config = true
            continue
        }
        if (arg === '--source') {
            options.source = path.resolve(readArgValue(args, index, arg))
            index += 1
            continue
        }
        if (arg === '--website-slug') {
            options.websiteSlug = readArgValue(args, index, arg)
            index += 1
            continue
        }
        if (arg === '--public-base-url') {
            options.publicBaseUrl = readArgValue(args, index, arg)
            index += 1
            continue
        }
        if (arg === '--source-public-base-url') {
            options.sourcePublicBaseUrl = readArgValue(args, index, arg)
            index += 1
            continue
        }
        if (arg === '--bucket') {
            options.bucket = readArgValue(args, index, arg)
            index += 1
            continue
        }
        if (arg === '--key-prefix') {
            options.keyPrefix = readArgValue(args, index, arg)
            index += 1
            continue
        }
        if (arg === '--help' || arg === '-h') {
            console.log(usage())
            process.exit(0)
        }

        throw new Error(`Unknown argument: ${arg}`)
    }

    return options
}

const loadPortfolioModule = (
    sourcePath: string
): { PORTFOLIO_ITEMS: unknown[]; R2_BASE?: string } => {
    const source = fs.readFileSync(sourcePath, 'utf8')
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName: sourcePath,
    })

    const module = { exports: {} as Record<string, unknown> }
    const sandbox = {
        exports: module.exports,
        module,
        console,
        process: { env: process.env },
    }
    vm.runInNewContext(transpiled.outputText, sandbox, {
        filename: sourcePath,
    })

    const exported = module.exports as {
        PORTFOLIO_ITEMS?: unknown
        R2_BASE?: string
    }
    if (!Array.isArray(exported.PORTFOLIO_ITEMS)) {
        throw new Error('Source file must export PORTFOLIO_ITEMS as an array')
    }

    return {
        PORTFOLIO_ITEMS: exported.PORTFOLIO_ITEMS,
        R2_BASE: exported.R2_BASE,
    }
}

const inferPublicBaseUrl = ({
    explicitPublicBaseUrl,
    items,
}: {
    explicitPublicBaseUrl?: string
    items: unknown[]
}): string => {
    if (explicitPublicBaseUrl) return normalizePublicBaseUrl(explicitPublicBaseUrl)

    const first = items[0] as { src?: unknown } | undefined
    if (typeof first?.src !== 'string') {
        throw new Error(
            'Unable to infer public base URL. Pass --public-base-url.'
        )
    }

    const url = new URL(first.src)
    return normalizePublicBaseUrl(url.origin)
}

const getWebsite = async (websiteSlug: string): Promise<WebsiteRecord> => {
    const { data, error } = await db
        .from(Tables.WEBSITES)
        .select('id, client_id')
        .eq('website_slug', websiteSlug)
        .single()

    if (error) throw error
    return data as WebsiteRecord
}

const getCurrentR2Config = async (
    websiteId: string
): Promise<R2ConfigRecord | null> => {
    const { data, error } = await db
        .from(Tables.MEDIA_R2_CONFIGS)
        .select('id, bucket, public_base_url, key_prefix')
        .eq('website_id', websiteId)
        .maybeSingle()

    if (error) throw error
    return data
}

const syncR2Config = async ({
    website,
    current,
    bucket,
    publicBaseUrl,
    keyPrefix,
    apply,
}: {
    website: WebsiteRecord
    current: R2ConfigRecord | null
    bucket: string
    publicBaseUrl: string
    keyPrefix: string
    apply: boolean
}): Promise<{
    action: 'insert' | 'update' | 'unchanged' | 'preserved'
    current?: {
        bucket: string
        public_base_url: string
        key_prefix: string
    }
    next: {
        bucket: string
        public_base_url: string
        key_prefix: string
    }
}> => {
    const payload = {
        client_id: website.client_id,
        website_id: website.id,
        bucket,
        public_base_url: publicBaseUrl,
        key_prefix: keyPrefix,
    }

    if (!current) {
        if (apply) {
            const { error: insertError } = await db
                .from(Tables.MEDIA_R2_CONFIGS)
                .insert(payload)
            if (insertError) throw insertError
        }
        return { action: 'insert', next: payload }
    }

    const changed =
        current.bucket !== payload.bucket ||
        current.public_base_url !== payload.public_base_url ||
        current.key_prefix !== payload.key_prefix

    if (!changed) {
        return {
            action: 'unchanged',
            current: {
                bucket: current.bucket,
                public_base_url: current.public_base_url,
                key_prefix: current.key_prefix,
            },
            next: payload,
        }
    }

    if (apply) {
        const { error: updateError } = await db
            .from(Tables.MEDIA_R2_CONFIGS)
            .update(payload)
            .eq('id', current.id)
        if (updateError) throw updateError
    }

    return {
        action: 'update',
        current: {
            bucket: current.bucket,
            public_base_url: current.public_base_url,
            key_prefix: current.key_prefix,
        },
        next: payload,
    }
}

const getCatalogBackfillStats = async ({
    websiteId,
    keys,
}: {
    websiteId: string
    keys: string[]
}): Promise<{ existingRows: number; matchingRows: number }> => {
    const { data, error } = await db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .select('key')
        .eq('website_id', websiteId)

    if (error) throw error

    const existingKeys = new Set((data || []).map(row => row.key as string))
    return {
        existingRows: existingKeys.size,
        matchingRows: keys.filter(key => existingKeys.has(key)).length,
    }
}

const upsertCatalogRows = async (
    rows: ReturnType<typeof buildMediaCatalogBackfillRows>
): Promise<number> => {
    const { error } = await db
        .from(Tables.MEDIA_CATALOG_ITEMS)
        .upsert(rows, { onConflict: 'website_id,key' })

    if (error) throw error
    return rows.length
}

const main = async (): Promise<void> => {
    const options = parseArgs(process.argv.slice(2))
    const sourcePath = path.resolve(options.source)
    const { PORTFOLIO_ITEMS } = loadPortfolioModule(sourcePath)
    const sourcePublicBaseUrl = inferPublicBaseUrl({
        explicitPublicBaseUrl: options.sourcePublicBaseUrl,
        items: PORTFOLIO_ITEMS,
    })
    const website = await getWebsite(options.websiteSlug)
    const currentR2Config = await getCurrentR2Config(website.id)
    const catalogPublicBaseUrl = normalizePublicBaseUrl(
        options.publicBaseUrl ||
            currentR2Config?.public_base_url ||
            sourcePublicBaseUrl
    )
    const rows = buildMediaCatalogBackfillRows({
        items: PORTFOLIO_ITEMS,
        sourcePublicBaseUrl,
        catalogPublicBaseUrl,
        websiteId: website.id,
        clientId: website.client_id,
    })
    const r2ConfigAction =
        options.syncR2Config || !currentR2Config
            ? await syncR2Config({
                  website,
                  current: currentR2Config,
                  bucket: options.bucket,
                  publicBaseUrl: catalogPublicBaseUrl,
                  keyPrefix: options.keyPrefix,
                  apply: options.apply,
              })
            : {
                  action: 'preserved' as const,
                  current: {
                      bucket: currentR2Config.bucket,
                      public_base_url: currentR2Config.public_base_url,
                      key_prefix: currentR2Config.key_prefix,
                  },
                  next: {
                      bucket: currentR2Config.bucket,
                      public_base_url: currentR2Config.public_base_url,
                      key_prefix: currentR2Config.key_prefix,
                  },
              }
    const catalogStats = await getCatalogBackfillStats({
        websiteId: website.id,
        keys: rows.map(row => row.key),
    })

    console.log(
        `${options.apply ? 'Applying' : 'Dry run'} Iffer's media catalog backfill`
    )
    console.log(`Source: ${sourcePath}`)
    console.log(`Website slug: ${options.websiteSlug}`)
    console.log(`Source public base URL: ${sourcePublicBaseUrl}`)
    console.log(`Catalog public base URL: ${catalogPublicBaseUrl}`)
    console.log(`R2 config: ${r2ConfigAction.action}`)
    if (r2ConfigAction.current) {
        console.log(
            `Current R2 config: bucket=${r2ConfigAction.current.bucket}, public_base_url=${r2ConfigAction.current.public_base_url}, key_prefix=${r2ConfigAction.current.key_prefix || '(empty)'}`
        )
    }
    console.log(
        `Next R2 config: bucket=${r2ConfigAction.next.bucket}, public_base_url=${r2ConfigAction.next.public_base_url}, key_prefix=${r2ConfigAction.next.key_prefix || '(empty)'}`
    )
    console.log(`Catalog rows: ${rows.length}`)
    console.log(`Existing catalog rows for website: ${catalogStats.existingRows}`)
    console.log(`Existing rows matching source keys: ${catalogStats.matchingRows}`)

    if (!options.apply) {
        console.log('No writes performed. Re-run with --apply to write Supabase.')
        return
    }

    const written = await upsertCatalogRows(rows)
    console.log(`Upserted ${written} media_catalog_items rows.`)
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    console.error('')
    console.error(usage())
    process.exit(1)
})
