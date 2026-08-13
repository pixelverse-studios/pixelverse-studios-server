import { describe, expect, it } from 'vitest'

import { publicOverviewSchema, publicOverviewText, releaseSlug } from '../src/lib/release-rich-content'

const overview = {
    type: 'doc',
    content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What changed' }] },
        {
            type: 'bulletList',
            content: [
                {
                    type: 'listItem',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                { type: 'text', text: 'Plan faster with ' },
                                { type: 'text', text: 'clearer prompts', marks: [{ type: 'bold' }] },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
}

describe('restricted public release overview', () => {
    it('accepts headings, styled text, and lists and derives plain text', () => {
        expect(publicOverviewSchema.safeParse(overview).success).toBe(true)
        expect(publicOverviewText(overview)).toBe('What changed Plan faster with clearer prompts')
    })

    it.each(['image', 'video', 'blockquote', 'codeBlock'])('rejects unsupported %s nodes', type => {
        expect(
            publicOverviewSchema.safeParse({
                type: 'doc',
                content: [{ type, attrs: { src: 'https://example.com/file' } }],
            }).success
        ).toBe(false)
    })

    it('rejects unsafe link protocols', () => {
        expect(
            publicOverviewSchema.safeParse({
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Bad link',
                                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                            },
                        ],
                    },
                ],
            }).success
        ).toBe(false)
    })

    it('derives a stable semantic-version release slug', () => {
        expect(releaseSlug('1.2.1', 'Fix morning focus')).toBe('1-2-1-fix-morning-focus')
    })
})
