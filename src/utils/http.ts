import { Response } from 'express'

export const handleGenericError = (err: any, res: Response) => {
    // Check if 'err' is of type Error to access the message
    if (err instanceof Error) {
        return res.status(500).json({ error: err.message })
    }
    // If 'err' is not an instance of Error, return a generic message
    return res.status(500).json({ error: 'An unexpected error occurred.' })
}
