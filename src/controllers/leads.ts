import { readFileSync } from 'node:fs'
import path from 'node:path'

import { Request, Response } from 'express'
import { z, ZodError } from 'zod'

import { handleGenericError } from '../utils/http'

// Valid package and add-on IDs for the interestedIn field
const VALID_PACKAGE_IDS = [
    // Website Packages
    'core-lite',
    'core-starter',
    'core-growth',
    'core-premium',
    // SEO Packages
    'seo-starter',
    'seo-growth',
    'seo-premium',
    // Development Add-ons
    'additional-page-basic',
    'additional-page-service',
    'feature-integration',
    // SEO Add-ons
    'blog-post',
    'citation-submission',
    'city-page',
    'competitor-analysis',
    'content-mapping',
    'county-page',
    'gbp-management',
    'hub-page',
    'keyword-research',
    'monthly-seo-report',
    'seo-page-audit',
    'service-page',
    // UX/UI Add-ons
    'page-audit',
] as const

type PackageId = (typeof VALID_PACKAGE_IDS)[number]

// Display names for packages with emojis and prices
const PACKAGE_DISPLAY_NAMES: Record<PackageId, string> = {
    // Website Packages
    'core-lite': '🖥️ Core Lite ($500 + $49/mo)',
    'core-starter': '🖥️ Core Starter ($2k + $79/mo)',
    'core-growth': '🖥️ Core Growth ($4k + $179/mo)',
    'core-premium': '🖥️ Core Premium (Custom)',
    // SEO Packages
    'seo-starter': '🔍 SEO Starter ($150 + $349/mo)',
    'seo-growth': '🔍 SEO Growth ($300 + $649/mo)',
    'seo-premium': '🔍 SEO Premium ($500 + $1,149/mo)',
    // Development Add-ons
    'additional-page-basic': '➕ Additional Page – Basic ($150)',
    'additional-page-service': '➕ Additional Page – Service ($200)',
    'feature-integration': '➕ Feature Integration ($500)',
    // SEO Add-ons
    'blog-post': '📝 Blog Post ($75)',
    'citation-submission': '📍 Citation Submission ($150)',
    'city-page': '🏙️ City Page ($200)',
    'competitor-analysis': '🔎 Competitor Analysis ($750)',
    'content-mapping': '🗺️ Content Mapping ($350)',
    'county-page': '🗺️ County Page ($350)',
    'gbp-management': '📍 GBP Management ($300)',
    'hub-page': '🔗 Hub Page ($350)',
    'keyword-research': '🔑 Keyword Research ($250)',
    'monthly-seo-report': '📊 Monthly SEO Report ($249)',
    'seo-page-audit': '🔍 SEO Page Audit ($75)',
    'service-page': '📄 Service Page ($250)',
    // UX/UI Add-ons
    'page-audit': '🎨 Page Audit ($75)',
}

const getPackageDisplayName = (id: string): string =>
    PACKAGE_DISPLAY_NAMES[id as PackageId] ?? id

const leadSchema = z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    budget: z.enum(['<1k', '1-3k', '3-6k', '6-10k', '10k+']),
    timeline: z.enum(['ASAP', '1-2mo', '3-6mo', '6+mo', 'unsure']),
    briefSummary: z.string().min(10).max(2000),
    hasSeenPackages: z.boolean(),
    honeypot: z.string().length(0),
    interestedIn: z.array(z.enum(VALID_PACKAGE_IDS)).optional().default([]),
})

const DEFAULT_NOTIFY_TO = 'ops@pixelversestudios.io'
const DEFAULT_NOTIFY_FROM =
    'PixelVerse Studios <notifications@pixelversestudios.io>'
const SUPPORT_EMAIL = 'info@pixelversestudios.io'
const SUPPORT_SUBJECT = 'PixelVerse Studios — Lead Follow-Up'

type LeadRecord = {
    id: string
    name: string
    email: string
    budget: string
    timeline: string
    brief_summary: string
    has_seen_packages: boolean
    interested_in: string[]
    user_agent: string | null
    ip: string | null
    acknowledged: boolean
    created_at: string
}

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

const getClientIp = (req: Request): string | null => {
    const headerValue =
        req.headers['x-forwarded-for'] || req.headers['x-real-ip']
    if (!headerValue) {
        return null
    }
    if (Array.isArray(headerValue)) {
        return headerValue[0] || null
    }
    const [first] = headerValue.split(',').map(value => value.trim())
    return first || null
}

const getRecipients = (): string[] => {
    const value = process.env.LEAD_NOTIFY_TO || DEFAULT_NOTIFY_TO
    return value
        .split(',')
        .map(recipient => recipient.trim())
        .filter(Boolean)
}

const getFromAddress = (): string =>
    process.env.LEAD_NOTIFY_FROM || DEFAULT_NOTIFY_FROM

const shouldUseResend = (): boolean => {
    const flag = process.env.LEAD_NOTIFY_USE_RESEND
    if (typeof flag !== 'string') {
        return false
    }

    const normalized = flag.trim().toLowerCase()
    if (['false', '0', 'off', 'no'].includes(normalized)) {
        return false
    }

    if (['true', '1', 'on', 'yes'].includes(normalized)) {
        return true
    }

    return false
}

const getSupabaseRestConfig = () => {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY

    if (!supabaseUrl) {
        throw new Error('SUPABASE_URL is not configured')
    }

    if (!supabaseKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
    }

    return {
        endpoint: `${supabaseUrl.replace(/\/$/, '')}/rest/v1`,
        supabaseKey
    }
}

const resolveLogoSource = (): string | null => {
    const configured =
        process.env.LEAD_NOTIFY_LOGO_URL?.trim() ||
        'https://res.cloudinary.com/pixelverse-studios/image/upload/v1761333954/pvs/logo-black.png'
    if (configured.length > 0) {
        return configured
    }

    try {
        const pngPath = path.resolve(__dirname, '../media/logo-email.png')
        const file = readFileSync(pngPath)
        return `data:image/png;base64,${file.toString('base64')}`
    } catch {
        return null
    }
}

const LOGO_SOURCE = resolveLogoSource()

const BRAND = {
    primary: '#3f00e9',
    secondary: '#c947ff',
    gradient: 'linear-gradient(90deg, #3f00e9, #c947ff)',
    background: '#ffffff',
    surface: '#f7f7fb',
    text: '#111111',
    muted: '#666666',
    border: '#e6e6ef',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    ring: '#3f00e9',
    shadow: '0 8px 24px rgba(0, 0, 0, 0.08)'
}

const insertLeadViaRest = async (
    payload: Omit<LeadRecord, 'id' | 'created_at'>
): Promise<LeadRecord> => {
    const { endpoint, supabaseKey } = getSupabaseRestConfig()

    const response = await fetch(`${endpoint}/leads`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            Prefer: 'return=representation'
        },
        body: JSON.stringify([
            {
                name: payload.name,
                email: payload.email,
                budget: payload.budget,
                timeline: payload.timeline,
                brief_summary: payload.brief_summary,
                has_seen_packages: payload.has_seen_packages,
                interested_in: payload.interested_in,
                user_agent: payload.user_agent,
                ip: payload.ip,
                acknowledged: payload.acknowledged
            }
        ])
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
            `Supabase insert failed (${response.status}): ${errorText}`
        )
    }

    const data = (await response.json()) as LeadRecord[] | LeadRecord

    const lead = Array.isArray(data) ? data[0] : data
    if (!lead || !lead.id) {
        throw new Error('Supabase insert did not return a lead record')
    }

    return lead
}

const buildLeadHtml = (lead: LeadRecord): string => {
    const emailHref = `mailto:${encodeURIComponent(lead.email)}`
    const summary = escapeHtml(lead.brief_summary).replace(/\n/g, '<br />')
    const hasSeenPackages = lead.has_seen_packages ? 'Yes' : 'No'

    const detailRow = (label: string, value: string) => `
        <tr>
            <td style="padding:8px 12px;color:${BRAND.muted};font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;width:40%;border-bottom:1px solid ${BRAND.border};">${label}</td>
            <td style="padding:8px 12px;color:${BRAND.text};font-size:16px;border-bottom:1px solid ${BRAND.border};">${value}</td>
        </tr>
    `

    const metaRow = (label: string, value: string) => `
        <p style="margin:0 0 6px;font-size:14px;color:${BRAND.muted};"><strong style="color:${BRAND.text};">${label}:</strong> ${value}</p>
    `

    const logoMarkup = `
        <div style="display:inline-flex;align-items:center;justify-content:center;width:96px;height:96px;border-radius:24px;background:${
            BRAND.background
        };box-shadow:0 10px 26px rgba(34,0,112,0.24);margin-bottom:20px;">
            ${
                LOGO_SOURCE
                    ? `<img src="${LOGO_SOURCE}" alt="PixelVerse Studios" style="height:auto;max-width:100%;display:block;" />`
                    : `<div style="font-size:32px;font-weight:700;color:${BRAND.background};letter-spacing:0.02em;">PVS</div>`
            }
        </div>
    `

    return `
        <!doctype html>
        <html lang="en">
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width,initial-scale=1" />
                <style>
                    :root {
                        color-scheme: light dark;
                        supported-color-schemes: light dark;
                    }
                    @media (prefers-color-scheme: dark) {
                        body {
                            background: #050510 !important;
                            color: #f7f7fb !important;
                        }
                        .pvs-card {
                            background: #151529 !important;
                            border-color: #27274b !important;
                            box-shadow: none !important;
                        }
                        .pvs-detail td {
                            border-color: #27274b !important;
                            color: #f7f7fb !important;
                        }
                        .pvs-summary {
                            background: #1c1c36 !important;
                            border-color: #27274b !important;
                            color: #f7f7fb !important;
                        }
                        .pvs-summary p {
                            color: #f7f7fb !important;
                        }
                        .pvs-meta {
                            border-top-color: #27274b !important;
                        }
                        .pvs-meta p {
                            color: #c7c7dc !important;
                        }
                        .pvs-footer {
                            background: #0f0f1f !important;
                        }
                        .pvs-footer p {
                            color: #a8a8c0 !important;
                        }
                    }
                </style>
            </head>
            <body style="margin:0;padding:0;background:${
                BRAND.surface
            };font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${
                BRAND.text
            };">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:${
                    BRAND.surface
                };">
                    <tr>
                        <td align="center">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="pvs-card" style="max-width:640px;background:${
                                BRAND.background
                            };border:1px solid ${
                                BRAND.border
                            };border-radius:20px;overflow:hidden;box-shadow:${BRAND.shadow};">
                                <tr>
                                    <td style="padding:36px 28px;background:${
                                        BRAND.gradient
                                    };text-align:center;color:#ffffff;">
                                        ${logoMarkup}
                                        <h1 style="margin:0 0 12px;font-size:16px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.85);">PixelVerse Studios</h1>
                                        <h2 style="margin:0;font-size:28px;line-height:34px;color:#ffffff!important;text-shadow:0 2px 6px rgba(17,17,17,0.2);">New Lead Submission</h2>
                                        <p style="margin:14px 0 0;font-size:16px;color:#ffffff!important;opacity:0.9;text-shadow:0 1px 3px rgba(17,17,17,0.25);">
                                            Here's a quick look at the latest inquiry.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:28px;">
                                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="pvs-detail" style="border-collapse:collapse;border:1px solid ${
                                            BRAND.border
                                        };border-radius:12px;overflow:hidden;">
                                            ${detailRow(
                                                'Name',
                                                escapeHtml(lead.name)
                                            )}
                                            ${detailRow(
                                                'Email',
                                                `<a href="${emailHref}" style="color:${
                                                    BRAND.primary
                                                };text-decoration:none;font-weight:600;">${escapeHtml(
                                                    lead.email
                                                )}</a>`
                                            )}
                                            ${detailRow(
                                                'Budget Range',
                                                escapeHtml(lead.budget)
                                            )}
                                            ${detailRow(
                                                'Timeline',
                                                escapeHtml(lead.timeline)
                                            )}
                                            ${detailRow(
                                                'Seen Packages',
                                                hasSeenPackages
                                            )}
                                        </table>
                                        <div class="pvs-summary" style="margin-top:24px;padding:20px;border:1px solid ${
                                            BRAND.border
                                        };border-radius:12px;background:${
                                            BRAND.surface
                                        };">
                                            <h2 style="margin:0 0 12px;font-size:18px;color:${
                                                BRAND.text
                                            };">Project Summary</h2>
                                            <p style="margin:0;font-size:16px;line-height:1.6;color:${
                                                BRAND.text
                                            };">${summary}</p>
                                        </div>
                                        ${
                                            lead.interested_in.length > 0
                                                ? `
                                        <div class="pvs-packages" style="margin-top:24px;padding:20px;border:1px solid ${
                                            BRAND.border
                                        };border-radius:12px;background:${
                                            BRAND.surface
                                        };">
                                            <h2 style="margin:0 0 12px;font-size:18px;color:${
                                                BRAND.text
                                            };">Interested In</h2>
                                            <ul style="margin:0;padding:0 0 0 20px;font-size:16px;line-height:1.8;color:${
                                                BRAND.text
                                            };">
                                                ${lead.interested_in
                                                    .map(
                                                        id =>
                                                            `<li>${escapeHtml(getPackageDisplayName(id))}</li>`
                                                    )
                                                    .join('')}
                                            </ul>
                                        </div>
                                        `
                                                : ''
                                        }
                                        <div class="pvs-meta" style="margin-top:24px;padding-top:20px;border-top:1px solid ${
                                            BRAND.border
                                        };">
                                            <h3 style="margin:0 0 12px;font-size:16px;color:${
                                                BRAND.muted
                                            };text-transform:uppercase;letter-spacing:0.08em;">Submission Details</h3>
                                            ${metaRow(
                                                'Lead ID',
                                                escapeHtml(lead.id)
                                            )}
                                            ${metaRow(
                                                'Submitted At',
                                                escapeHtml(lead.created_at)
                                            )}
                                            ${metaRow(
                                                'User Agent',
                                                escapeHtml(
                                                    lead.user_agent ?? 'n/a'
                                                )
                                            )}
                                            ${metaRow(
                                                'IP',
                                                escapeHtml(lead.ip ?? 'n/a')
                                            )}
                                            ${metaRow(
                                                'Acknowledged',
                                                lead.acknowledged ? 'Yes' : 'No'
                                            )}
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td class="pvs-footer" style="padding:20px 28px;background:${
                                        BRAND.surface
                                    };text-align:center;">
                                        <p style="margin:0;font-size:13px;color:${
                                            BRAND.muted
                                        };">
                                            You’re receiving this message because your address is listed as a lead notification recipient in PixelVerse Studios HQ.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
        </html>
    `
}

const buildLeadText = (lead: LeadRecord): string => {
    const hasSeenPackages = lead.has_seen_packages ? 'Yes' : 'No'
    const interestedInSection =
        lead.interested_in.length > 0
            ? [
                  '',
                  'Interested In:',
                  ...lead.interested_in.map(
                      id => `  • ${getPackageDisplayName(id)}`
                  ),
              ]
            : []

    return [
        'PixelVerse Studios — New Lead Submission',
        '',
        `Name: ${lead.name}`,
        `Email: ${lead.email}`,
        `Budget Range: ${lead.budget}`,
        `Timeline: ${lead.timeline}`,
        `Seen Packages: ${hasSeenPackages}`,
        '',
        'Project Summary:',
        lead.brief_summary,
        ...interestedInSection,
        '',
        `Lead ID: ${lead.id}`,
        `Submitted At: ${lead.created_at}`,
        `User Agent: ${lead.user_agent ?? 'n/a'}`,
        `IP: ${lead.ip ?? 'n/a'}`,
        `Acknowledged: ${lead.acknowledged ? 'Yes' : 'No'}`
    ].join('\n')
}

const findPendingLeadByEmail = async (
    email: string
): Promise<LeadRecord | null> => {
    const { endpoint, supabaseKey } = getSupabaseRestConfig()
    const normalizedEmail = email.trim().toLowerCase()
    const url = new URL(`${endpoint}/leads`)
    const params = url.searchParams
    params.set('select', '*')
    params.set('email', `ilike.${normalizedEmail}`)
    params.set('acknowledged', 'eq.false')
    params.set('limit', '1')

    const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`
        }
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
            `Supabase fetch failed (${response.status}): ${errorText}`
        )
    }

    const data = (await response.json()) as LeadRecord[] | LeadRecord | null

    if (!data) {
        return null
    }

    if (Array.isArray(data)) {
        return data.length > 0 ? data[0] : null
    }

    return data
}

const sendLeadAlertToDiscord = async (lead: LeadRecord) => {
    const webhookUrl = process.env.LEAD_NOTIFY_DISCORD_WEBHOOK?.trim()

    if (!webhookUrl) {
        throw new Error('LEAD_NOTIFY_DISCORD_WEBHOOK is not configured')
    }

    const message = buildLeadText(lead)

    if (message.length > 4096) {
        throw new Error('Discord payload exceeds maximum embed length')
    }

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username: 'PixelVerse Lead Alerts',
            content: 'PixelVerse Studios — New Lead Submission',
            embeds: [
                {
                    description: message,
                    color: 0x3f00e9,
                    timestamp: lead.created_at,
                    footer: {
                        text: 'Lead intake notifications'
                    }
                }
            ]
        })
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
            `Discord webhook failed (${response.status}): ${errorText}`
        )
    }
}

const sendLeadEmailViaResend = async (lead: LeadRecord) => {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
        throw new Error('RESEND_API_KEY is not configured')
    }

    const to = getRecipients()
    if (to.length === 0) {
        throw new Error('LEAD_NOTIFY_TO is not configured')
    }

    const from = getFromAddress()
    const subject = `New Lead: ${lead.name} • ${lead.budget} • ${lead.timeline}`
    const html = buildLeadHtml(lead)
    const text = buildLeadText(lead)

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from,
            to,
            subject,
            html,
            text
        })
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
            `Resend email failed (${response.status}): ${errorText}`
        )
    }
}

const notifyLead = async (lead: LeadRecord) => {
    if (shouldUseResend()) {
        await sendLeadEmailViaResend(lead)
        return
    }

    await sendLeadAlertToDiscord(lead)
}

const createLead = async (req: Request, res: Response): Promise<Response> => {
    try {
        const parsed = leadSchema.parse(req.body)

        const userAgent =
            typeof req.headers['user-agent'] === 'string'
                ? req.headers['user-agent']
                : null
        const ip = getClientIp(req)

        const existingLead = await findPendingLeadByEmail(parsed.email)
        if (existingLead) {
            return res.status(409).json({
                error: 'Lead already submitted',
                message: `Thanks for reaching out — we already have your inquiry on file. If you have any new details or questions, please email us directly at ${SUPPORT_EMAIL}.`,
                supportEmail: SUPPORT_EMAIL,
                subjectLine: SUPPORT_SUBJECT
            })
        }

        const lead = await insertLeadViaRest({
            name: parsed.name,
            email: parsed.email,
            budget: parsed.budget,
            timeline: parsed.timeline,
            brief_summary: parsed.briefSummary,
            has_seen_packages: parsed.hasSeenPackages,
            interested_in: parsed.interestedIn,
            user_agent: userAgent,
            ip,
            acknowledged: false
        })

        await notifyLead(lead)

        console.log('Lead inserted', { id: lead.id, email: lead.email })

        return res.status(201).json({
            id: lead.id,
            createdAt: lead.created_at,
            acknowledged: lead.acknowledged
        })
    } catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({
                error: 'Invalid payload',
                details: error.flatten()
            })
        }

        return handleGenericError(error, res)
    }
}

export default { createLead }
