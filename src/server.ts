import express, { Application } from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'

import clientsRouter from './routes/clients'
import newsletterRouter from './routes/newsletter'
import cmsRouter from './routes/cms'
import contactFormsRouter from './routes/contact-forms'
import leadsRouter from './routes/leads'

import 'dotenv/config'

// Supabase URL and Key from environment variables
const app: Application = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(bodyParser.json())
app.use(cors())
// Routes
app.use(clientsRouter)
app.use(newsletterRouter)
app.use(cmsRouter)
app.use(contactFormsRouter)
app.use(leadsRouter)

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
