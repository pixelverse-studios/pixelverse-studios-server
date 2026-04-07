/**
 * Normalizes a hostname for database storage and lookup.
 *
 * Steps:
 * - Trim whitespace
 * - Lowercase
 * - Strip trailing dot (FQDN form `example.com.` -> `example.com`)
 * - Strip optional port suffix (`:8080`)
 *
 * Handles IPv6 literals wrapped in brackets (`[::1]:8080` -> `[::1]`)
 * by preserving bracketed segments. For non-bracketed input with a
 * single colon, assumes the colon separates host from port.
 */
export const normalizeHostname = (raw: string): string => {
    if (typeof raw !== 'string') return ''
    let host = raw.trim().toLowerCase()

    // Strip port from bracketed IPv6 (e.g. "[::1]:8080" -> "[::1]")
    if (host.startsWith('[')) {
        const closingBracket = host.indexOf(']')
        if (closingBracket !== -1) {
            host = host.slice(0, closingBracket + 1)
        }
    } else {
        // Strip port from non-IPv6 hosts. Only strip if there's exactly one
        // colon (more than one suggests bare IPv6, which we don't support
        // but should not corrupt).
        const firstColon = host.indexOf(':')
        const lastColon = host.lastIndexOf(':')
        if (firstColon !== -1 && firstColon === lastColon) {
            host = host.slice(0, firstColon)
        }
    }

    // Strip trailing dot (FQDN root form)
    if (host.endsWith('.')) {
        host = host.slice(0, -1)
    }

    return host
}
