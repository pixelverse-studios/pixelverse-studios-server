import { Response } from 'express'

export const handleGenericError = (err: any, res: Response) => {
    if (err instanceof Error) {
        console.error('Unhandled error:', err.message, err.stack)
    } else {
        try {
            console.error('Unhandled error object:', JSON.stringify(err))
        } catch {
            console.error('Unhandled error object:', err)
        }
    }
    if (err instanceof Error) {
        return res.status(500).json({ error: err.message })
    }
    // Custom error handling
    const status =
        typeof err?.status === 'number' && err.status >= 400 ? err.status : 500
    const message =
        typeof err?.message === 'string' && err.message.length > 0
            ? err.message
            : 'Internal server error'
    return res.status(status).json({ error: message })
}
