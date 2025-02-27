import { Request, Response } from 'express'

const verifyTopNotchRecaptcha = async (
    req: Request,
    res: Response
): Promise<Response> => {
    const { token } = req.body

    if (!token) {
        return res.status(400).json({ error: 'No reCAPTCHA token provided.' })
    }

    try {
        const response = await fetch(
            `https://recaptchaenterprise.googleapis.com/v1/projects/YOUR_PROJECT_ID/assessments?key=YOUR_API_KEY`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event: {
                        token: token,
                        siteKey: '6LdC3dEqAAAAACuoO_aRk_0rUm_6v0uYRUseKabC',
                        expectedAction: 'USER_ACTION'
                    }
                })
            }
        )

        const data = await response.json()

        if (!response.ok) {
            throw new Error(
                `Google reCAPTCHA API error: ${
                    data.error?.message || 'Unknown error'
                }`
            )
        }

        const riskScore = data?.riskAnalysis?.score || 0

        if (riskScore >= 0.5) {
            return res.status(200).json({
                success: true,
                message: 'reCAPTCHA verified successfully.'
            })
        } else {
            return res.status(403).json({
                success: false,
                message: 'reCAPTCHA verification failed.'
            })
        }
    } catch (error) {
        return res.status(500).json({
            error: 'Verification failed.',
            details: (error as Error).message
        })
    }
}

export default { verifyTopNotchRecaptcha }
