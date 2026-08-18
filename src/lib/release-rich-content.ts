import { z } from 'zod'

const linkAttrsSchema = z
    .object({
        href: z
            .string()
            .trim()
            .max(2048)
            .refine(
                value => /^(https?:\/\/|mailto:)/i.test(value),
                'Links must use http, https, or mailto'
            ),
        target: z.enum(['_blank', '_self']).nullable().optional(),
        rel: z.string().max(100).nullable().optional(),
        class: z.string().max(100).nullable().optional()
    })
    .strict()

const markSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('bold') }).strict(),
    z.object({ type: z.literal('italic') }).strict(),
    z.object({ type: z.literal('link'), attrs: linkAttrsSchema }).strict()
])

type RichNode = {
    type: string
    attrs?: Record<string, unknown>
    content?: RichNode[]
    marks?: Array<z.infer<typeof markSchema>>
    text?: string
}

const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
    z
        .object({
            type: z.enum([
                'doc',
                'paragraph',
                'heading',
                'bulletList',
                'orderedList',
                'listItem',
                'text'
            ]),
            attrs: z.record(z.string(), z.unknown()).optional(),
            content: z.array(richNodeSchema).optional(),
            marks: z.array(markSchema).max(3).optional(),
            text: z.string().max(10_000).optional()
        })
        .strict()
)

const addIssue = (
    context: z.RefinementCtx,
    path: Array<string | number>,
    message: string
) => context.addIssue({ code: z.ZodIssueCode.custom, path, message })

const validateNode = (
    node: RichNode,
    context: z.RefinementCtx,
    path: Array<string | number>,
    parent: string | null,
    depth: number
): void => {
    if (depth > 10)
        addIssue(context, path, 'Public overview nesting is too deep')

    const children = node.content || []
    const childTypes = children.map(child => child.type)
    const allowedChildren: Record<string, string[]> = {
        doc: ['paragraph', 'heading', 'bulletList', 'orderedList'],
        paragraph: ['text'],
        heading: ['text'],
        bulletList: ['listItem'],
        orderedList: ['listItem'],
        listItem: ['paragraph', 'bulletList', 'orderedList'],
        text: []
    }

    if (node.type === 'doc' && parent !== null)
        addIssue(context, path, 'Document nodes can only be the root')
    if (node.type !== 'doc' && parent === null)
        addIssue(context, path, 'Public overview root must be a document')
    if (node.type === 'heading') {
        const attrs = z
            .object({ level: z.union([z.literal(2), z.literal(3)]) })
            .strict()
            .safeParse(node.attrs)
        if (!attrs.success)
            addIssue(
                context,
                [...path, 'attrs'],
                'Headings must be level 2 or 3'
            )
    } else if (node.type === 'orderedList') {
        const attrs = z
            .object({ start: z.number().int().min(1).max(1000).optional() })
            .strict()
            .safeParse(node.attrs || {})
        if (!attrs.success)
            addIssue(
                context,
                [...path, 'attrs'],
                'Ordered-list attributes are invalid'
            )
    } else if (node.attrs !== undefined) {
        addIssue(
            context,
            [...path, 'attrs'],
            `${node.type} nodes do not accept attributes`
        )
    }

    if (node.type === 'text') {
        if (!node.text)
            addIssue(context, [...path, 'text'], 'Text nodes cannot be empty')
        if (node.content !== undefined)
            addIssue(
                context,
                [...path, 'content'],
                'Text nodes cannot contain child nodes'
            )
    } else {
        if (node.text !== undefined)
            addIssue(
                context,
                [...path, 'text'],
                `${node.type} nodes cannot contain text directly`
            )
        if (node.marks !== undefined)
            addIssue(
                context,
                [...path, 'marks'],
                'Marks are only allowed on text nodes'
            )
    }

    if (childTypes.some(type => !allowedChildren[node.type].includes(type))) {
        addIssue(
            context,
            [...path, 'content'],
            `${node.type} contains an unsupported child node`
        )
    }
    if (
        ['bulletList', 'orderedList'].includes(node.type) &&
        children.length === 0
    ) {
        addIssue(
            context,
            [...path, 'content'],
            'Lists must contain at least one item'
        )
    }
    if (
        node.type === 'listItem' &&
        (children.length === 0 || children[0].type !== 'paragraph')
    ) {
        addIssue(
            context,
            [...path, 'content'],
            'List items must begin with a paragraph'
        )
    }

    children.forEach((child, index) =>
        validateNode(
            child,
            context,
            [...path, 'content', index],
            node.type,
            depth + 1
        )
    )
}

export const publicOverviewSchema = richNodeSchema.superRefine(
    (document, context) => {
        if (document.type !== 'doc')
            addIssue(
                context,
                ['type'],
                'Public overview root must be a document'
            )
        validateNode(document, context, [], null, 0)
        const encoded = JSON.stringify(document)
        if (Buffer.byteLength(encoded, 'utf8') > 64 * 1024) {
            addIssue(context, [], 'Public overview must be 64 KiB or smaller')
        }
        if (publicOverviewText(document).length > 10_000) {
            addIssue(
                context,
                [],
                'Public overview text must be 10,000 characters or fewer'
            )
        }
    }
)

export type PublicOverviewDocument = z.infer<typeof publicOverviewSchema>

export const publicOverviewText = (
    document: RichNode | null | undefined
): string => {
    if (!document) return ''
    const chunks: string[] = []
    const visit = (node: RichNode) => {
        if (node.type === 'text' && node.text) chunks.push(node.text)
        node.content?.forEach(visit)
        if (['paragraph', 'heading', 'listItem'].includes(node.type))
            chunks.push('\n')
    }
    visit(document)
    return chunks.join(' ').replace(/\s+/g, ' ').trim()
}

export const releaseSlug = (version: string, title: string): string => {
    const normalizedTitle = title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return `${version.replace(/\./g, '-')}-${normalizedTitle || 'release'}`
        .slice(0, 200)
        .replace(/-+$/g, '')
}
