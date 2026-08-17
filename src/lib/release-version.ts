export type SemanticReleaseType = 'major' | 'minor' | 'patch'

export const RELEASE_VERSION_PATTERN =
    /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/

export const deriveReleaseType = (
    version: string
): SemanticReleaseType | null => {
    const match = version.match(RELEASE_VERSION_PATTERN)
    if (!match) return null
    const minor = Number(match[2])
    const patch = Number(match[3])
    if (patch > 0) return 'patch'
    if (minor > 0) return 'minor'
    return 'major'
}
