import express, { Application } from 'express'
import bodyParser from 'body-parser'

import clientsRouter from './routes/clients'
import newsletterRouter from './routes/newsletter'
import cmsRouter from './routes/cms'

import 'dotenv/config'

// Supabase URL and Key from environment variables
const app: Application = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(bodyParser.json())

// Routes
app.use('/api/clients', clientsRouter)
app.use('/api/newsletter', newsletterRouter)
app.use('/api/cms', cmsRouter)

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
