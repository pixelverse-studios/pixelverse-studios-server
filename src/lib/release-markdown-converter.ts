import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

export const RELEASE_CONVERTER_VERSION = 'domani-markdown-v1'
export const MAX_CONVERSION_NOTES = 100

export type ReleaseNoteType = 'feature' | 'improvement' | 'fix' | 'breaking'

export interface ReleaseNoteDraft {
    noteType: ReleaseNoteType
    publicTitle: string
    publicBody: string
    technicalNotes: null
    platforms: ['ios', 'android']
}

type MarkdownToken = {
    type: string
    depth?: number
    ordered?: boolean
    href?: string
    text?: string
    raw?: string
    tokens?: MarkdownToken[]
    items?: Array<{ tokens?: MarkdownToken[]; text?: string }>
}

export class ConversionContentError extends Error {
    constructor(
        public readonly code:
            | 'NO_CONVERSION_CANDIDATES'
            | 'TOO_MANY_CONVERSION_CANDIDATES'
            | 'UNSAFE_GENERATED_MARKDOWN',
        message: string
    ) {
        super(message)
        this.name = 'ConversionContentError'
    }
}

export const normalizeReleaseNoteMarkdown = (value: string): string =>
    value.replace(/\r\n?/g, '\n')

const codepointLimit = (value: string, maximum: number): string =>
    Array.from(value).slice(0, maximum).join('').trim()

const codepointLength = (value: string): number => Array.from(value).length

const plainText = (value: string): string =>
    sanitizeHtml(marked.parseInline(value, { gfm: false }) as string, {
        allowedTags: [],
        allowedAttributes: {},
    })
        .replace(/\s+/g, ' ')
        .trim()

const inlineText = (value: string): string =>
    sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ')

const escapeMarkdown = (value: string): string =>
    value.replace(/([\\`*_{}\[\]<>])/g, '\\$1')

const escapeLeadingBlockMarkers = (value: string): string =>
    value
        .split('\n')
        .map(line => {
            if (/^ {0,3}(?:#{1,6}|>|[-+*]|`{3,}|~{3,})(?:[ \t]|$)/.test(line)) {
                return line.replace(/^( {0,3})/, '$1\\')
            }
            return line.replace(/^( {0,3}\d{1,9})([.)])(?=[ \t]|$)/, '$1\\$2')
        })
        .join('\n')

const escapeMarkdownToLimit = (value: string, maximum: number): string => {
    let result = ''
    let length = 0
    for (const codepoint of Array.from(value)) {
        const escaped = escapeMarkdown(codepoint)
        const escapedLength = codepointLength(escaped)
        if (length + escapedLength > maximum) break
        result += escaped
        length += escapedLength
    }
    return codepointLimit(escapeLeadingBlockMarkers(result), maximum)
}

const renderCodeSpan = (value: string): string => {
    const longestBacktickRun = Math.max(
        0,
        ...Array.from(value.matchAll(/`+/g), match => match[0].length)
    )
    const delimiter = '`'.repeat(longestBacktickRun + 1)
    const needsPadding =
        value.startsWith('`') ||
        value.endsWith('`') ||
        (value.startsWith(' ') && value.endsWith(' ') && /\S/.test(value))
    const content = needsPadding ? ` ${value} ` : value
    return `${delimiter}${content}${delimiter}`
}

const safeHref = (href: string | undefined): string | null => {
    if (!href) return null
    const trimmed = href.trim()
    if (
        trimmed.startsWith('#') ||
        (trimmed.startsWith('/') && !trimmed.startsWith('//')) ||
        /^(https?:|mailto:)/i.test(trimmed)
    ) {
        return encodeURI(trimmed).replace(/\(/g, '%28').replace(/\)/g, '%29')
    }
    return null
}

const renderInline = (tokens: MarkdownToken[] = []): string =>
    tokens
        .map(token => {
            const children = token.tokens || []
            switch (token.type) {
                case 'text':
                    return children.length > 0
                        ? renderInline(children)
                        : escapeMarkdown(inlineText(token.text || token.raw || ''))
                case 'escape':
                    return token.raw?.startsWith('\\')
                        ? token.raw
                        : escapeMarkdown(inlineText(token.text || token.raw || ''))
                case 'strong':
                    return `**${renderInline(children)}**`
                case 'em':
                    return `*${renderInline(children)}*`
                case 'codespan':
                    return renderCodeSpan(token.text || '')
                case 'br':
                    return '  \n'
                case 'link': {
                    const label = renderInline(children) || escapeMarkdown(plainText(token.text || ''))
                    const href = safeHref(token.href)
                    return href ? `[${label}](${href})` : label
                }
                case 'html':
                case 'image':
                    return ''
                default:
                    return children.length > 0
                        ? renderInline(children)
                        : escapeMarkdown(plainText(token.text || ''))
            }
        })
        .join('')
        .trim()

const isSafeInline = (tokens: MarkdownToken[] = []): boolean =>
    tokens.every(token => {
        const children = token.tokens || []
        switch (token.type) {
            case 'text':
            case 'escape':
            case 'codespan':
            case 'br':
                return children.length === 0 || isSafeInline(children)
            case 'strong':
            case 'em':
                return isSafeInline(children)
            case 'link':
                return safeHref(token.href) !== null && isSafeInline(children)
            default:
                return false
        }
    })

const isSafeBlocks = (tokens: MarkdownToken[]): boolean =>
    tokens.every(token => {
        if (token.type === 'space') return true
        if (token.type === 'paragraph' || token.type === 'text') {
            return isSafeInline(token.tokens)
        }
        if (token.type === 'list') {
            return (token.items || []).every(item => isSafeBlocks(item.tokens || []))
        }
        return false
    })

export const isSafeReleaseNoteMarkdown = (value: string): boolean => {
    try {
        return isSafeBlocks(
            marked.lexer(value, { gfm: false }) as unknown as MarkdownToken[]
        )
    } catch {
        return false
    }
}

const renderBlock = (token: MarkdownToken): string => {
    if (token.type === 'paragraph' || token.type === 'text') {
        const rendered = renderInline(token.tokens) || escapeMarkdown(plainText(token.text || ''))
        return escapeLeadingBlockMarkers(rendered)
    }
    if (token.type === 'list') {
        return (token.items || [])
            .map((item, index) => {
                const body = renderBlocks(item.tokens || [])
                if (!body) return ''
                return `${token.ordered ? `${index + 1}.` : '-'} ${body.replace(/\n+/g, ' ')}`
            })
            .filter(Boolean)
            .join('\n')
    }
    return ''
}

const renderBlocks = (tokens: MarkdownToken[]): string =>
    tokens.map(renderBlock).filter(Boolean).join('\n\n').trim()

const noteTypeFor = (heading: string): ReleaseNoteType => {
    const match = heading.match(/\b(feature|improvement|fix|breaking)\b/i)
    return (match?.[1]?.toLowerCase() as ReleaseNoteType | undefined) || 'improvement'
}

const titleForHeading = (heading: string): string => {
    const withoutType = heading.replace(
        /^(feature|improvement|fix|breaking)(?:\s*[:\-–—]\s*|\s+)/i,
        ''
    )
    return codepointLimit(withoutType || heading, 160)
}

const draftFor = (title: string, body: string, noteType: ReleaseNoteType): ReleaseNoteDraft => {
    const publicTitle = codepointLimit(plainText(title), 160)
    const candidateBody = (body || escapeMarkdown(publicTitle)).trim()
    const publicBody =
        codepointLength(candidateBody) <= 4000 && isSafeReleaseNoteMarkdown(candidateBody)
            ? candidateBody
            : escapeMarkdownToLimit(plainText(candidateBody), 4000)

    if (!publicBody || !isSafeReleaseNoteMarkdown(publicBody)) {
        throw new ConversionContentError(
            'UNSAFE_GENERATED_MARKDOWN',
            'Generated release-note Markdown failed safety validation'
        )
    }
    return {
        noteType,
        publicTitle,
        publicBody,
        technicalNotes: null,
        platforms: ['ios', 'android'],
    }
}

export const convertReleaseMarkdown = (rawMarkdown: string): ReleaseNoteDraft[] => {
    const markdown = normalizeReleaseNoteMarkdown(rawMarkdown)
    const tokens = marked.lexer(markdown, { gfm: false }) as unknown as MarkdownToken[]
    const drafts: ReleaseNoteDraft[] = []
    let active: { heading: string; noteType: ReleaseNoteType; blocks: MarkdownToken[] } | null = null

    const flush = () => {
        if (!active) return
        const title = titleForHeading(active.heading)
        if (title) drafts.push(draftFor(title, renderBlocks(active.blocks), active.noteType))
        active = null
    }

    for (const token of tokens) {
        if (token.type === 'heading') {
            flush()
            if ((token.depth || 0) >= 2) {
                const heading = plainText(token.text || '')
                if (heading) active = { heading, noteType: noteTypeFor(heading), blocks: [] }
            }
            continue
        }
        if (active && ['paragraph', 'list', 'text'].includes(token.type)) {
            active.blocks.push(token)
        }
    }
    flush()

    if (drafts.length === 0) {
        for (const token of tokens) {
            if (token.type !== 'list') continue
            for (const item of token.items || []) {
                const body = renderBlocks(item.tokens || [])
                const title = codepointLimit(plainText(body), 160)
                if (title && body) drafts.push(draftFor(title, body, 'improvement'))
            }
        }
    }

    if (drafts.length === 0) {
        throw new ConversionContentError(
            'NO_CONVERSION_CANDIDATES',
            'Markdown does not contain convertible headings or list items'
        )
    }
    if (drafts.length > MAX_CONVERSION_NOTES) {
        throw new ConversionContentError(
            'TOO_MANY_CONVERSION_CANDIDATES',
            `Markdown produces more than ${MAX_CONVERSION_NOTES} release notes`
        )
    }
    return drafts
}
