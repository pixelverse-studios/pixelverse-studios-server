import { Response } from 'express'

export const handleGenericError = (err: any, res: Response) => {
    if (err instanceof Error) {
        return res.status(500).json({ error: err.message })
    }
    // Custom error handling
    return res.status(err.status).json({ error: err.message })
}
