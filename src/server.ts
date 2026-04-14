import express, { Application } from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'

import clientsRouter from './routes/clients'
import newsletterRouter from './routes/newsletter'
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
import cmsUsersRouter from './routes/cms-users'
import cmsTemplatesRouter from './routes/cms-templates'
import cmsPagesRouter from './routes/cms-pages'
import websiteDomainsRouter from './routes/website-domains'
import r2UploadsRouter from './routes/r2-uploads'
import { generalApiLimit } from './routes/rate-limits'
import { startWebhookProcessor } from './lib/webhook-processor'

import 'dotenv/config'

// Supabase URL and Key from environment variables
const app: Application = express()
const PORT = process.env.PORT || 3000

// Trust the proxy chain in front of the server so Express reads the
// real client IP from X-Forwarded-For. DigitalOcean App Platform uses
// multiple proxy hops (load balancer + internal router), so a numeric
// value like 1 can resolve req.ip incorrectly. 'loopback, linklocal,
// uniquelocal' trusts only private/internal IPs as proxies, which is
// correct for any cloud platform where the app sits behind a VPC.
app.set('trust proxy', 'loopback, linklocal, uniquelocal')

// Middleware
app.use(bodyParser.json())
app.use(cors())
// Catch-all rate limit for non-CMS routes. The CMS routes apply their
// own per-tier limits explicitly and are skipped by this middleware
// (see src/routes/rate-limits.ts).
app.use(generalApiLimit)
// Routes
app.use(clientsRouter)
app.use(newsletterRouter)
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
app.use(cmsUsersRouter)
app.use(cmsTemplatesRouter)
app.use(cmsPagesRouter)
app.use(websiteDomainsRouter)
app.use(r2UploadsRouter)

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
    console.log(`trust proxy: ${app.get('trust proxy')}`)
    console.log(`environment: ${process.env.NODE_ENVIRONMENT || 'not set'}`)
    startWebhookProcessor()
})
