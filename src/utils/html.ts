import sanitizeHtml from 'sanitize-html'

/**
 * Configuration for HTML sanitization
 * Allows safe formatting tags from WYSIWYG editors while stripping XSS vectors
 */
const sanitizeConfig: sanitizeHtml.IOptions = {
    allowedTags: [
        // Text formatting
        'p',
        'br',
        'strong',
        'b',
        'em',
        'i',
        'u',
        's',
        'strike',
        // Lists
        'ul',
        'ol',
        'li',
        // Headings
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        // Links
        'a',
        // Code
        'code',
        'pre',
        // Quotes
        'blockquote'
    ],
    allowedAttributes: {
        a: ['href', 'target', 'rel'],
        ol: ['start', 'type']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    // Force safe link attributes
    transformTags: {
        a: (tagName, attribs) => {
            return {
                tagName,
                attribs: {
                    ...attribs,
                    rel: 'noopener noreferrer',
                    target: '_blank'
                }
            }
        }
    }
}

/**
 * Sanitize HTML content for safe storage and display
 * Removes XSS vectors while preserving safe formatting tags
 *
 * @param html - Raw HTML string from WYSIWYG editor
 * @returns Sanitized HTML string safe for storage and display
 *
 * @example
 * // Safe content passes through
 * sanitizeRichText('<p>Hello <strong>world</strong></p>')
 * // => '<p>Hello <strong>world</strong></p>'
 *
 * @example
 * // XSS vectors are stripped
 * sanitizeRichText('<script>alert("xss")</script><p>Hello</p>')
 * // => '<p>Hello</p>'
 *
 * @example
 * // Plain text passes through unchanged
 * sanitizeRichText('Just plain text')
 * // => 'Just plain text'
 */
export const sanitizeRichText = (html: string): string => {
    if (!html) return html
    return sanitizeHtml(html, sanitizeConfig)
}

/**
 * Escape HTML special characters for safe insertion into HTML contexts
 * Use this for plain text that needs to be displayed in HTML (not rich text)
 *
 * @param value - Plain text string to escape
 * @returns Escaped string safe for HTML insertion
 */
export const escapeHtml = (value: string): string => {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}
