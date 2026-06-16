import 'dotenv/config'

import express, { Application } from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import crypto from 'crypto'

import clientsRouter from './routes/clients'
import newsletterRouter from './routes/newsletter'
import cmsRouter from './routes/cms'
import contactFormsRouter from './routes/contact-forms'
import leadsRouter from './routes/leads'
import auditRouter from './routes/audit'
import deploymentsRouter from './routes/deployments'
import websitesRouter from './routes/websites'
import appsRouter from './routes/apps'
import projectsRouter from './routes/projects'
import agendaRouter from './routes/agenda'
import domaniRouter from './routes/domani'
import calendlyWebhookRouter from './routes/calendly-webhook'
import prospectsRouter from './routes/prospects'
import emailCampaignsRouter from './routes/email-campaigns'
import seoRouter from './routes/seo'
import mediaAdminAuthRouter from './routes/media-admin-auth'
import mediaRouter from './routes/media'

process.on('uncaughtException', err => {
    console.error('Uncaught exception:', {
        message: err.message,
        stack: err.stack,
    })
    process.exit(1)
})

process.on('unhandledRejection', reason => {
    console.error('Unhandled rejection:', reason)
    process.exit(1)
})

// Supabase URL and Key from environment variables
const app: Application = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use((req, res, next) => {
    const requestId =
        req.get('x-request-id') ||
        req.get('x-correlation-id') ||
        crypto.randomUUID()
    const startedAt = process.hrtime.bigint()

    req.requestId = requestId
    res.setHeader('x-request-id', requestId)

    res.on('finish', () => {
        const durationMs =
            Number(process.hrtime.bigint() - startedAt) / 1_000_000

        console.log('HTTP request completed:', {
            requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Math.round(durationMs),
        })
    })

    next()
})
app.use(bodyParser.json())

// Routes
app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true })
})

app.use(clientsRouter)
app.use(newsletterRouter)
app.use(cmsRouter)
app.use(contactFormsRouter)
app.use(leadsRouter)
app.use(auditRouter)
app.use(deploymentsRouter)
app.use(websitesRouter)
app.use(appsRouter)
app.use(projectsRouter)
app.use(agendaRouter)
app.use(domaniRouter)
app.use(calendlyWebhookRouter)
app.use(prospectsRouter)
app.use(emailCampaignsRouter)
app.use(seoRouter)
app.use(mediaAdminAuthRouter)
app.use(mediaRouter)

// Error handling middleware
app.use(
    (
        err: any,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ) => {
        console.error('Unhandled request error:', {
            requestId: req.requestId,
            method: req.method,
            path: req.path,
            message: err?.message,
            stack: err?.stack,
        })
        res.status(500).json({ message: err.message })
    }
)

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`)
})
