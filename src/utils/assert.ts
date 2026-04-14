/**
 * Compile-time exhaustiveness check for discriminated unions. Call in the
 * default branch of an if/else or switch on a union's discriminator; if a
 * new variant is added later, the `never` typing will produce a type error
 * at the call site — forcing the author to handle the new case.
 *
 * Runtime fallback throws so a mis-built consumer also fails loudly in
 * production rather than silently ignoring the new variant.
 */
export const assertNever = (value: never): never => {
    throw new Error(
        `unexpected variant: ${JSON.stringify(value)}`,
    )
}
