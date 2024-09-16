import express, { Application } from 'express'
import bodyParser from 'body-parser'

import internalRouter from './routes/internal'

import 'dotenv/config'

// Supabase URL and Key from environment variables
const app: Application = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(bodyParser.json())

// Routes
app.use('/api/internal', internalRouter)
// app.use('/api/users', userRoutes)

// Error handling middleware
app.use(
    (
        err: any,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        res.status(500).json({ message: err.message })
    }
)

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`)
})
