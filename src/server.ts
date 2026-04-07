import express, { Application } from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'

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
import cmsUsersRouter from './routes/cms-users'
import cmsTemplatesRouter from './routes/cms-templates'
import websiteDomainsRouter from './routes/website-domains'

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
app.use(websiteDomainsRouter)

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
