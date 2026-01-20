interface FormSubmissionEmailProps {
    website: string
    fullname: string
    email: string
    phone: string
    data: any
}

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

export const generateContactFormSubmissionEmail = ({
    website,
    fullname,
    email,
    phone,
    data
}: FormSubmissionEmailProps) => {
    const formattedData = Object.entries(data)
        .map(([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`)
        .join('')

    return `
    <div style="max-width: 600px; margin: 20px auto; background: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1); font-family: Arial, sans-serif; background-color: #1e1e1e; color: #ffffff;">
        <div style="background-color: #007BFF; color: #ffffff; text-align: center; padding: 15px; border-radius: 8px 8px 0 0; font-size: 20px;">
            🚀 New Contact Form Submission
        </div>
        <div style="padding: 20px; color: #ffffff;">
            <p><strong>Website:</strong> ${website}</p>
            <p><strong>Full Name:</strong> ${fullname}</p>
            <p><strong>Email:</strong> <a href="mailto:${email}" style="color:#007BFF; text-decoration:none;">${email}</a></p>
            <p><strong>Phone:</strong> ${phone}</p>

            <div style="background-color: #2a2a2a; padding: 15px; border-radius: 6px; margin-top: 10px; font-size: 14px;">
                <p><strong>Submitted Data:</strong></p>
                <ul style="padding-left: 20px; list-style-type: none;">
                    ${formattedData}
                </ul>
            </div>
        </div>
        <div style="text-align: center; padding: 15px; font-size: 14px; color: #bbbbbb;">
            <p>Need assistance? <a href="mailto:support@yourcompany.com" style="color:#007BFF; text-decoration:none;">Contact Support</a></p>
        </div>
    </div>`
}

interface AuditRequestEmailProps {
    name: string
    email: string
    websiteUrl: string
    phoneNumber?: string | null
    specifics?: string | null
    submittedAt: string
}

const formatTimestamp = (timestamp: string): string => {
    const parsed = new Date(timestamp)
    if (Number.isNaN(parsed.getTime())) {
        return timestamp
    }
    return parsed.toUTCString()
}

export const generateAuditRequestEmail = ({
    name,
    email,
    websiteUrl,
    phoneNumber,
    specifics,
    submittedAt
}: AuditRequestEmailProps) => {
    const details = [
        { label: 'Name', value: escapeHtml(name) },
        {
            label: 'Email',
            value: `<a href="mailto:${escapeHtml(email)}" style="color:#7c3aed;">${escapeHtml(email)}</a>`
        },
        {
            label: 'Website URL',
            value: `<a href="${escapeHtml(websiteUrl)}" style="color:#7c3aed;">${escapeHtml(websiteUrl)}</a>`
        },
        {
            label: 'Phone',
            value: phoneNumber ? escapeHtml(phoneNumber) : 'Not provided'
        },
        {
            label: 'Submitted',
            value: escapeHtml(formatTimestamp(submittedAt))
        }
    ]

    const specificsBlock = specifics
        ? `<div style="background-color:#f5f3ff;padding:16px;border-radius:6px;margin-top:12px;color:#1f2933;line-height:1.5;">${escapeHtml(
              specifics
          )}</div>`
        : `<p style="color:#6b7280;margin-top:12px;">No specifics were provided.</p>`

    const detailRows = details
        .map(
            ({ label, value }) => `
        <tr>
            <td style="padding:10px 12px;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:35%;border-bottom:1px solid #eee;">${label}</td>
            <td style="padding:10px 12px;color:#111827;font-size:15px;border-bottom:1px solid #eee;">${value}</td>
        </tr>`
        )
        .join('')

    return `
    <div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,0.12);overflow:hidden;font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;">
        <div style="background:linear-gradient(135deg,#7c3aed,#2563eb);padding:24px;color:#fff;text-align:center;">
            <div style="font-size:22px;font-weight:600;margin-bottom:4px;">New Free Website Audit Request</div>
            <div style="font-size:15px;opacity:0.9;">A visitor just requested a complimentary audit.</div>
        </div>
        <div style="padding:24px 28px 32px;">
            <table style="width:100%;border-collapse:collapse;">${detailRows}</table>
            <div style="margin-top:24px;">
                <p style="font-size:14px;color:#6b7280;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;">Specifics to Review</p>
                ${specificsBlock}
            </div>
        </div>
        <div style="background:#f9fafb;padding:16px 24px;text-align:center;font-size:13px;color:#6b7280;">
            Please respond within 2 business days to keep the promise on the landing page.
        </div>
    </div>`
}

interface DeploymentEmailParams {
    websiteTitle: string
    changedUrls: string[]
    summary: string // markdown
    deployedAt: Date
}

const markdownToHtml = (markdown: string): string => {
    const lines = markdown.split('\n')
    const htmlItems = lines
        .filter(line => line.trim().startsWith('-'))
        .map(line => {
            const text = line.trim().substring(1).trim()
            return `<li style="padding:8px 0;color:#374151;">${escapeHtml(text)}</li>`
        })
        .join('')

    return htmlItems
        ? `<ul style="padding-left:20px;margin:16px 0;">${htmlItems}</ul>`
        : ''
}

export const generateDeploymentEmailHtml = ({
    websiteTitle,
    changedUrls,
    summary,
    deployedAt
}: DeploymentEmailParams): string => {
    const summaryHtml = markdownToHtml(summary)
    const urlListHtml = changedUrls
        .map(
            url =>
                `<li style="padding:6px 0;"><a href="${escapeHtml(url)}" style="color:#7c3aed;text-decoration:none;">${escapeHtml(url)}</a></li>`
        )
        .join('')

    const formattedDate = deployedAt.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    })

    return `
    <div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,0.12);overflow:hidden;font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;">
        <div style="background:linear-gradient(135deg,#7c3aed,#2563eb);padding:24px;color:#fff;text-align:center;">
            <div style="font-size:28px;margin-bottom:4px;">🚀</div>
            <div style="font-size:22px;font-weight:600;margin-bottom:4px;">New Deployment: ${escapeHtml(websiteTitle)}</div>
            <div style="font-size:15px;opacity:0.9;">${formattedDate}</div>
        </div>

        <div style="padding:24px 28px;">
            <div style="margin-bottom:24px;">
                <h3 style="font-size:16px;color:#6b7280;margin:0 0 12px 0;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">📝 Changes Deployed</h3>
                ${summaryHtml}
            </div>

            <div style="background:#f9fafb;padding:20px;border-radius:8px;border-left:4px solid #7c3aed;">
                <h3 style="font-size:16px;color:#6b7280;margin:0 0 12px 0;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">🔗 Pages Updated</h3>
                <p style="font-size:14px;color:#6b7280;margin-bottom:12px;">The following pages need to be re-indexed in Google Search Console:</p>
                <ul style="padding-left:20px;margin:0;">${urlListHtml}</ul>
            </div>
        </div>

        <div style="background:#f9fafb;padding:16px 24px;text-align:center;font-size:13px;color:#6b7280;">
            This is an automated deployment notification from PixelVerse Studios.
        </div>
    </div>`
}

export const generateDeploymentEmailText = ({
    websiteTitle,
    changedUrls,
    summary,
    deployedAt
}: DeploymentEmailParams): string => {
    const formattedDate = deployedAt.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    })

    return [
        '🚀 New Deployment',
        '',
        `Website: ${websiteTitle}`,
        `Deployed: ${formattedDate}`,
        '',
        'Changes Deployed:',
        summary,
        '',
        'Pages Updated (Re-index in Google Search Console):',
        ...changedUrls.map(url => `- ${url}`),
        '',
        '---',
        'This is an automated deployment notification from PixelVerse Studios.'
    ]
        .filter(Boolean)
        .join('\n')
}

// ============================================================================
// Domani Beta Launch Email
// ============================================================================

interface DomaniBetaLaunchEmailParams {
    recipientName?: string | null
    iosLink: string
    androidLink: string
}

export const DOMANI_BETA_SUBJECT = "You're in! Domani is ready for you"

export const generateDomaniBetaLaunchEmailHtml = ({
    recipientName,
    iosLink,
    androidLink
}: DomaniBetaLaunchEmailParams): string => {
    const greeting = recipientName ? `Hey ${escapeHtml(recipientName)},` : 'Hey there,'

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Domani Public Beta</title>
</head>
<body style="margin:0;padding:0;background-color:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f8f9fa;">
        <tr>
            <td style="padding:40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
                    <!-- Header -->
                    <tr>
                        <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:40px 32px;text-align:center;">
                            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">Domani</h1>
                            <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:16px;">Plan tomorrow, tonight.</p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding:40px 32px;">
                            <p style="margin:0 0 20px;color:#1f2937;font-size:16px;line-height:1.7;">${greeting}</p>

                            <p style="margin:0 0 20px;color:#1f2937;font-size:16px;line-height:1.7;">You signed up for Domani a while back, and we haven't forgotten about you.</p>

                            <p style="margin:0 0 28px;color:#1f2937;font-size:16px;line-height:1.7;">Today, we're excited to invite you to join our <strong>public beta</strong>.</p>

                            <!-- What is Domani -->
                            <h2 style="margin:0 0 16px;color:#6366f1;font-size:20px;font-weight:600;">What is Domani?</h2>

                            <p style="margin:0 0 20px;color:#1f2937;font-size:16px;line-height:1.7;">Domani is a simple idea: <strong>plan tomorrow, tonight</strong>. Instead of waking up scattered, you spend a few minutes each evening deciding what actually matters for the next day. Then you wake up with clarity and just... do the things.</p>

                            <p style="margin:0 0 28px;color:#1f2937;font-size:16px;line-height:1.7;">No complex project management. No overwhelming feature lists. Just a focused way to plan your day and actually follow through.</p>

                            <!-- Why you're getting this -->
                            <h2 style="margin:0 0 16px;color:#6366f1;font-size:20px;font-weight:600;">Why you're getting this email</h2>

                            <p style="margin:0 0 20px;color:#1f2937;font-size:16px;line-height:1.7;">You believed in us early — before the app even existed. That means something.</p>

                            <!-- Special Offer Box -->
                            <div style="background:linear-gradient(135deg,#f0fdf4 0%,#ecfdf5 100%);border:1px solid #86efac;border-radius:12px;padding:24px;margin:0 0 28px;">
                                <p style="margin:0 0 12px;color:#166534;font-size:16px;line-height:1.6;">So here's our thank you: once the beta ends, you'll be able to unlock Domani for life at <strong style="font-size:18px;">$9.99</strong> instead of the regular <span style="text-decoration:line-through;">$34.99</span>.</p>
                                <p style="margin:0;color:#166534;font-size:14px;">That's a one-time purchase, yours forever.</p>
                            </div>

                            <p style="margin:0 0 32px;color:#1f2937;font-size:16px;line-height:1.7;">For now, the beta is <strong>completely free</strong>. Download it, try it out, and let us know what you think.</p>

                            <!-- CTA Buttons -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 32px;">
                                <tr>
                                    <td align="center" style="padding:0 0 12px;">
                                        <a href="${escapeHtml(iosLink)}" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:600;">
                                            Download for iOS
                                        </a>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center">
                                        <a href="${escapeHtml(androidLink)}" style="display:inline-block;background:#1f2937;color:#ffffff;text-decoration:none;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:600;">
                                            Download for Android
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <!-- One Ask -->
                            <h2 style="margin:0 0 16px;color:#6366f1;font-size:20px;font-weight:600;">One ask</h2>

                            <p style="margin:0 0 20px;color:#1f2937;font-size:16px;line-height:1.7;">This is a beta, which means we're still polishing things. If something feels off or you have ideas, tap the <strong>Feedback</strong> tab at the bottom of the app. We read everything.</p>

                            <p style="margin:0;color:#1f2937;font-size:16px;line-height:1.7;">Thanks for being here from the start.</p>

                            <p style="margin:32px 0 0;color:#6b7280;font-size:15px;">— The Domani Team</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color:#f9fafb;padding:24px 32px;text-align:center;border-top:1px solid #e5e7eb;">
                            <p style="margin:0 0 8px;color:#9ca3af;font-size:13px;">Made with care by the Domani team</p>
                            <p style="margin:0;color:#9ca3af;font-size:12px;">
                                <a href="https://domaniapp.com" style="color:#6366f1;text-decoration:none;">domaniapp.com</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`
}

export const generateDomaniBetaLaunchEmailText = ({
    recipientName,
    iosLink,
    androidLink
}: DomaniBetaLaunchEmailParams): string => {
    const greeting = recipientName ? `Hey ${recipientName},` : 'Hey there,'

    return `${greeting}

You signed up for Domani a while back, and we haven't forgotten about you.

Today, we're excited to invite you to join our public beta.

---

WHAT IS DOMANI?

Domani is a simple idea: plan tomorrow, tonight. Instead of waking up scattered, you spend a few minutes each evening deciding what actually matters for the next day. Then you wake up with clarity and just... do the things.

No complex project management. No overwhelming feature lists. Just a focused way to plan your day and actually follow through.

---

WHY YOU'RE GETTING THIS EMAIL

You believed in us early — before the app even existed. That means something.

So here's our thank you: once the beta ends, you'll be able to unlock Domani for life at $9.99 instead of the regular $34.99. That's a one-time purchase, yours forever.

For now, the beta is completely free. Download it, try it out, and let us know what you think.

---

GET THE APP

iOS: ${iosLink}
Android: ${androidLink}

---

ONE ASK

This is a beta, which means we're still polishing things. If something feels off or you have ideas, tap the Feedback tab at the bottom of the app. We read everything.

Thanks for being here from the start.

— The Domani Team

---
domaniapp.com`
}
