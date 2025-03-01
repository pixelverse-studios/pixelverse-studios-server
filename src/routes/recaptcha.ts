import { Router } from 'express'

const recaptchaRouter: Router = Router()

recaptchaRouter.post('/verify-recaptcha/topnotch')

export default recaptchaRouter
