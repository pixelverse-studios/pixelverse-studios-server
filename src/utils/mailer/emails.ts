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

// Default app store links for Domani
export const DOMANI_IOS_LINK = 'https://testflight.apple.com/join/1dgpHTK3'
export const DOMANI_ANDROID_LINK =
    'https://play.google.com/store/apps/details?id=com.baitedz.domaniapp'

interface DomaniBetaLaunchEmailParams {
    recipientEmail: string
    recipientName?: string | null
    iosLink?: string
    androidLink?: string
}

export const DOMANI_BETA_SUBJECT = "You're in! Domani is ready for you"

export const generateDomaniBetaLaunchEmailHtml = ({
    recipientEmail,
    recipientName,
    iosLink = DOMANI_IOS_LINK,
    androidLink = DOMANI_ANDROID_LINK
}: DomaniBetaLaunchEmailParams): string => {
    const greeting = recipientName ? `Hey ${escapeHtml(recipientName)},` : 'Hey there,'
    const unsubscribeUrl = `https://domani-app.com/waitlist/unsubscribe?email=${encodeURIComponent(recipientEmail)}`

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Domani Public Beta</title>
</head>
<body style="margin:0;padding:0;background-color:#FAF8F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#FAF8F5;">
        <tr>
            <td style="padding:40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background-color:#F5F2ED;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(125,155,138,0.15);">
                    <!-- Header -->
                    <tr>
                        <td style="background:linear-gradient(135deg,#7D9B8A 0%,#5A7765 100%);padding:40px 32px;text-align:center;">
                            <h1 style="margin:0;color:#FAF8F5;font-size:28px;font-weight:700;letter-spacing:-0.5px;">Domani</h1>
                            <p style="margin:8px 0 0;color:rgba(250,248,245,0.9);font-size:16px;">Plan tomorrow, tonight.</p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding:40px 32px;">
                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">${greeting}</p>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">You signed up for Domani a while back, and we haven't forgotten about you.</p>

                            <p style="margin:0 0 28px;color:#3D4A44;font-size:16px;line-height:1.7;">Today, we're excited to invite you to join our <strong>public beta</strong>.</p>

                            <!-- What is Domani -->
                            <h2 style="margin:0 0 16px;color:#7D9B8A;font-size:20px;font-weight:600;">What is Domani?</h2>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">Domani is a simple idea: <strong>plan tomorrow, tonight</strong>. Instead of waking up scattered, you spend a few minutes each evening deciding what actually matters for the next day. Then you wake up with clarity and just... do the things.</p>

                            <p style="margin:0 0 28px;color:#3D4A44;font-size:16px;line-height:1.7;">No complex project management. No overwhelming feature lists. Just a focused way to plan your day and actually follow through.</p>

                            <!-- Why you're getting this -->
                            <h2 style="margin:0 0 16px;color:#7D9B8A;font-size:20px;font-weight:600;">Why you're getting this email</h2>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">You believed in us early — before the app even existed. That means something.</p>

                            <!-- Special Offer Box - Table-based for Gmail compatibility -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 28px;">
                                <tr>
                                    <td bgcolor="#E8F1ED" style="background-color:#E8F1ED;border:2px solid #A3BFB0;border-radius:12px;padding:24px;">
                                        <p style="margin:0 0 12px;color:#3D4A44;font-size:16px;line-height:1.6;"><span style="color:#3D4A44;">So here's our thank you: once the beta ends, you'll be able to unlock Domani for life at </span><strong style="font-size:18px;color:#5A7765;">$9.99</strong><span style="color:#3D4A44;"> instead of the regular </span><span style="text-decoration:line-through;color:#6B7265;">$34.99</span><span style="color:#3D4A44;">.</span></p>
                                        <p style="margin:0;color:#3D4A44;font-size:14px;"><span style="color:#3D4A44;">That's a one-time purchase, yours forever.</span></p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0 0 32px;color:#3D4A44;font-size:16px;line-height:1.7;">For now, the beta is <strong>completely free</strong>. Download it, try it out, and let us know what you think.</p>

                            <!-- CTA Buttons - Bulletproof for light/dark mode -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 32px;">
                                <tr>
                                    <td align="center" style="padding:0 0 12px;">
                                        <!--[if mso]>
                                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(iosLink)}" style="height:52px;v-text-anchor:middle;width:220px;" arcsize="23%" strokecolor="#7D9B8A" strokeweight="2px" fillcolor="#7D9B8A">
                                        <w:anchorlock/>
                                        <center style="color:#FAF8F5;font-family:sans-serif;font-size:16px;font-weight:bold;">Download for iOS</center>
                                        </v:roundrect>
                                        <![endif]-->
                                        <!--[if !mso]><!-->
                                        <a href="${escapeHtml(iosLink)}" style="display:inline-block;background-color:#7D9B8A;color:#FAF8F5;text-decoration:none;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:600;border:2px solid #7D9B8A;mso-hide:all;">
                                            Download for iOS
                                        </a>
                                        <!--<![endif]-->
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center">
                                        <!--[if mso]>
                                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(androidLink)}" style="height:52px;v-text-anchor:middle;width:220px;" arcsize="23%" strokecolor="#7D9B8A" strokeweight="2px" fillcolor="#FAF8F5">
                                        <w:anchorlock/>
                                        <center style="color:#7D9B8A;font-family:sans-serif;font-size:16px;font-weight:bold;">Download for Android</center>
                                        </v:roundrect>
                                        <![endif]-->
                                        <!--[if !mso]><!-->
                                        <a href="${escapeHtml(androidLink)}" style="display:inline-block;background-color:#FAF8F5;color:#7D9B8A;text-decoration:none;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:600;border:2px solid #7D9B8A;mso-hide:all;">
                                            Download for Android
                                        </a>
                                        <!--<![endif]-->
                                    </td>
                                </tr>
                            </table>

                            <!-- One Ask -->
                            <h2 style="margin:0 0 16px;color:#7D9B8A;font-size:20px;font-weight:600;">One ask</h2>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">This is a beta, which means we're still polishing things. If something feels off or you have ideas, tap the <strong>Feedback</strong> tab at the bottom of the app. We read everything.</p>

                            <p style="margin:0;color:#3D4A44;font-size:16px;line-height:1.7;">Thanks for being here from the start.</p>

                            <p style="margin:32px 0 0;color:#6B7265;font-size:15px;">— The Domani Team</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color:#f9fafb;padding:24px 32px;text-align:center;border-top:1px solid #e5e7eb;">
                            <p style="margin:0 0 8px;color:#9ca3af;font-size:13px;">Made with care by the Domani team</p>
                            <p style="margin:0 0 12px;color:#9ca3af;font-size:12px;">
                                <a href="https://domani-app.com" style="color:#6366f1;text-decoration:none;">domani-app.com</a>
                            </p>
                            <p style="margin:0;color:#9ca3af;font-size:11px;">
                                <a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>
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
    recipientEmail,
    recipientName,
    iosLink = DOMANI_IOS_LINK,
    androidLink = DOMANI_ANDROID_LINK
}: DomaniBetaLaunchEmailParams): string => {
    const greeting = recipientName ? `Hey ${recipientName},` : 'Hey there,'
    const unsubscribeUrl = `https://domani-app.com/waitlist/unsubscribe?email=${encodeURIComponent(recipientEmail)}`

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
domani-app.com

Unsubscribe: ${unsubscribeUrl}`
}

// ============================================================================
// Domani Beta Update Email (Task Rollover Feature)
// ============================================================================

interface DomaniBetaUpdateEmailParams {
    recipientEmail: string
    recipientName?: string | null
}

export const DOMANI_BETA_UPDATE_SUBJECT =
    "You've been shaping something special (+ a peek at what's next)"

export const generateDomaniBetaUpdateEmailHtml = ({
    recipientEmail,
    recipientName
}: DomaniBetaUpdateEmailParams): string => {
    const greeting = recipientName
        ? `Hey ${escapeHtml(recipientName)},`
        : 'Hey there,'
    const unsubscribeUrl = `https://domani-app.com/users/unsubscribe?email=${encodeURIComponent(recipientEmail)}`

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Domani Beta Update</title>
</head>
<body style="margin:0;padding:0;background-color:#FAF8F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#FAF8F5;">
        <tr>
            <td style="padding:40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background-color:#F5F2ED;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(125,155,138,0.15);">
                    <!-- Header -->
                    <tr>
                        <td style="background:linear-gradient(135deg,#7D9B8A 0%,#5A7765 100%);padding:40px 32px;text-align:center;">
                            <h1 style="margin:0;color:#FAF8F5;font-size:28px;font-weight:700;letter-spacing:-0.5px;">Domani</h1>
                            <p style="margin:8px 0 0;color:rgba(250,248,245,0.9);font-size:16px;">Beta Update</p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding:40px 32px;">
                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">${greeting}</p>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">First, thank you. Seriously. You took a chance on Domani when it was just an idea about planning differently, and your feedback has been shaping this app into something real.</p>

                            <!-- What you've seen recently -->
                            <h2 style="margin:28px 0 16px;color:#7D9B8A;font-size:20px;font-weight:600;">What you've seen recently</h2>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">You might have noticed things looking a little different lately. We rolled out a new <strong>sage theme</strong>—think muted earth tones instead of bold blues. It wasn't just a visual refresh. The old colors felt urgent, almost pushy. The sage palette is calmer, more grounded. Because planning your day shouldn't feel like your app is yelling at you.</p>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">The philosophy is simple: support intentional work without visual overwhelm. You're already making conscious choices about tomorrow. Your tools should respect that.</p>

                            <p style="margin:0 0 28px;color:#3D4A44;font-size:16px;line-height:1.7;">We also added <strong>per-task reminders</strong>. You asked for them, we built them. Now you can set a specific time for each task instead of hoping you remember when it matters.</p>

                            <!-- What's coming next -->
                            <h2 style="margin:28px 0 16px;color:#7D9B8A;font-size:20px;font-weight:600;">What's coming next: Task Rollover</h2>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">Here's the thing we've been wrestling with: what happens when you don't finish everything you planned yesterday?</p>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">Right now, those tasks just... disappear into the past. You have to manually recreate them if you still care. That's friction you shouldn't need.</p>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">But auto-rollover everything? That's worse. Suddenly you're dragging around a backlog of stuff you never quite got to, and planning feels like housekeeping instead of intention-setting.</p>

                            <p style="margin:0 0 28px;color:#3D4A44;font-size:16px;line-height:1.7;">So we built something in between.</p>

                            <!-- Feature Box -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 28px;">
                                <tr>
                                    <td bgcolor="#E8F1ED" style="background-color:#E8F1ED;border:2px solid #A3BFB0;border-radius:12px;padding:24px;">
                                        <p style="margin:0 0 12px;color:#3D4A44;font-size:18px;font-weight:600;">Task Rollover lets you choose.</p>
                                        <p style="margin:0;color:#6B7265;font-size:15px;line-height:1.6;">It works at two key moments during your planning flow.</p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0 0 12px;color:#3D4A44;font-size:16px;line-height:1.7;"><strong>In the morning:</strong> When you open Domani for the first time each day, if you had incomplete tasks yesterday, you'll see a simple prompt. Your Most Important Task from yesterday appears at the top with a star. Other incomplete tasks sit below it. You pick which ones deserve another day.</p>

                            <p style="margin:0 0 28px;color:#3D4A44;font-size:16px;line-height:1.7;"><strong>During evening planning:</strong> When your planning reminder goes off (say, 6pm), and you have incomplete tasks from today, you'll see a gentle prompt before you start planning tomorrow. But here's the smart part—it only shows tasks you clearly missed (that 4pm dentist call) or unscheduled tasks. Tasks with reminders still in the future (your 7pm meditation) don't show up because they haven't failed yet.</p>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">Maybe that quarterly report still matters. Check it, carry it forward, keep it as today's MIT (or tomorrow's, if you're planning ahead).</p>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">Maybe that "organize desk drawer" task was never actually important. Leave it unchecked. Start fresh.</p>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">The details come with you—category, priority, reminders all preserved (adjusted to the right day, obviously). But you're making a conscious choice, not inheriting leftovers by default.</p>

                            <p style="margin:0 0 28px;color:#3D4A44;font-size:16px;line-height:1.7;">And if you finished everything? The app celebrates with you. Because that deserves recognition.</p>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">This isn't about managing an endless to-do list. It's about choosing what matters, informed by what you didn't finish, without the guilt or overwhelm of automatic inheritance.</p>

                            <!-- Keep going -->
                            <h2 style="margin:28px 0 16px;color:#7D9B8A;font-size:20px;font-weight:600;">Keep going</h2>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">We're building this thing together. Keep using the app, keep sharing what works and what doesn't. The more real-world usage we see, the better Domani becomes for everyone who values intentional productivity.</p>

                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;"><strong>Task Rollover launches soon.</strong> You'll be the first to try it.</p>

                            <p style="margin:0;color:#3D4A44;font-size:16px;line-height:1.7;">Talk soon,</p>
                            <p style="margin:8px 0 0;color:#6B7265;font-size:15px;">— The Domani Team</p>

                            <p style="margin:32px 0 0;color:#6B7265;font-size:14px;font-style:italic;">P.S. If something feels off or you have ideas about what should come next, just reply to this email. We read everything.</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color:#FAF8F5;padding:24px 32px;text-align:center;border-top:1px solid #E8E4DD;">
                            <p style="margin:0 0 8px;color:#9BA69E;font-size:13px;">Made with care by the Domani team</p>
                            <p style="margin:0 0 12px;color:#9BA69E;font-size:12px;">
                                <a href="https://domani-app.com" style="color:#7D9B8A;text-decoration:none;">domani-app.com</a>
                            </p>
                            <p style="margin:0;color:#ADB7B0;font-size:11px;">
                                <a href="${unsubscribeUrl}" style="color:#9BA69E;text-decoration:underline;">Unsubscribe</a>
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

// ============================================================================
// Domani Version Release Campaign Email
// ============================================================================

interface VersionReleaseEmailParams {
    recipientEmail: string
    recipientName?: string | null
    subject: string
    htmlContent: string // pre-sanitized WYSIWYG HTML
}

export const generateVersionReleaseEmailHtml = ({
    recipientEmail,
    recipientName,
    subject,
    htmlContent,
}: VersionReleaseEmailParams): string => {
    const greeting = recipientName
        ? `Hey ${escapeHtml(recipientName)},`
        : 'Hey there,'
    const unsubscribeUrl = `https://domani-app.com/users/unsubscribe?email=${encodeURIComponent(recipientEmail)}`

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#FAF8F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#FAF8F5;">
        <tr>
            <td style="padding:40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background-color:#F5F2ED;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(125,155,138,0.15);">
                    <!-- Header -->
                    <tr>
                        <td style="background:linear-gradient(135deg,#7D9B8A 0%,#5A7765 100%);padding:40px 32px;text-align:center;">
                            <h1 style="margin:0;color:#FAF8F5;font-size:28px;font-weight:700;letter-spacing:-0.5px;">Domani</h1>
                            <p style="margin:8px 0 0;color:rgba(250,248,245,0.9);font-size:16px;">${escapeHtml(subject)}</p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding:40px 32px;">
                            <p style="margin:0 0 20px;color:#3D4A44;font-size:16px;line-height:1.7;">${greeting}</p>

                            <!-- WYSIWYG Content -->
                            <div style="color:#3D4A44;font-size:16px;line-height:1.7;">
                                ${htmlContent}
                            </div>

                            <p style="margin:32px 0 0;color:#6B7265;font-size:15px;">— The Domani Team</p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color:#FAF8F5;padding:24px 32px;text-align:center;border-top:1px solid #E8E4DD;">
                            <p style="margin:0 0 8px;color:#9BA69E;font-size:13px;">Made with care by the Domani team</p>
                            <p style="margin:0 0 12px;color:#9BA69E;font-size:12px;">
                                <a href="https://domani-app.com" style="color:#7D9B8A;text-decoration:none;">domani-app.com</a>
                            </p>
                            <p style="margin:0;color:#ADB7B0;font-size:11px;">
                                <a href="${unsubscribeUrl}" style="color:#9BA69E;text-decoration:underline;">Unsubscribe</a>
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

export const generateVersionReleaseEmailText = ({
    recipientEmail,
    recipientName,
    subject,
    htmlContent,
}: VersionReleaseEmailParams): string => {
    const greeting = recipientName ? `Hey ${recipientName},` : 'Hey there,'
    const unsubscribeUrl = `https://domani-app.com/users/unsubscribe?email=${encodeURIComponent(recipientEmail)}`

    // Strip HTML tags for plain text version
    const plainContent = htmlContent
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li>/gi, '- ')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim()

    return `${greeting}

${plainContent}

— The Domani Team

---
domani-app.com

Unsubscribe: ${unsubscribeUrl}`
}

export const generateDomaniBetaUpdateEmailText = ({
    recipientEmail,
    recipientName
}: DomaniBetaUpdateEmailParams): string => {
    const greeting = recipientName ? `Hey ${recipientName},` : 'Hey there,'
    const unsubscribeUrl = `https://domani-app.com/users/unsubscribe?email=${encodeURIComponent(recipientEmail)}`

    return `${greeting}

First, thank you. Seriously. You took a chance on Domani when it was just an idea about planning differently, and your feedback has been shaping this app into something real.

---

WHAT YOU'VE SEEN RECENTLY

You might have noticed things looking a little different lately. We rolled out a new sage theme—think muted earth tones instead of bold blues. It wasn't just a visual refresh. The old colors felt urgent, almost pushy. The sage palette is calmer, more grounded. Because planning your day shouldn't feel like your app is yelling at you.

The philosophy is simple: support intentional work without visual overwhelm. You're already making conscious choices about tomorrow. Your tools should respect that.

We also added per-task reminders. You asked for them, we built them. Now you can set a specific time for each task instead of hoping you remember when it matters.

---

WHAT'S COMING NEXT: TASK ROLLOVER

Here's the thing we've been wrestling with: what happens when you don't finish everything you planned yesterday?

Right now, those tasks just... disappear into the past. You have to manually recreate them if you still care. That's friction you shouldn't need.

But auto-rollover everything? That's worse. Suddenly you're dragging around a backlog of stuff you never quite got to, and planning feels like housekeeping instead of intention-setting.

So we built something in between.

Task Rollover lets you choose.

It works at two key moments:

IN THE MORNING: When you open Domani for the first time each day, if you had incomplete tasks yesterday, you'll see a simple prompt. Your Most Important Task from yesterday appears at the top with a star. Other incomplete tasks sit below it. You pick which ones deserve another day.

DURING EVENING PLANNING: When your planning reminder goes off (say, 6pm), and you have incomplete tasks from today, you'll see a gentle prompt before you start planning tomorrow. But here's the smart part—it only shows tasks you clearly missed (that 4pm dentist call) or unscheduled tasks. Tasks with reminders still in the future (your 7pm meditation) don't show up because they haven't failed yet.

Maybe that quarterly report still matters. Check it, carry it forward, keep it as today's MIT (or tomorrow's, if you're planning ahead).

Maybe that "organize desk drawer" task was never actually important. Leave it unchecked. Start fresh.

The details come with you—category, priority, reminders all preserved (adjusted to the right day, obviously). But you're making a conscious choice, not inheriting leftovers by default.

And if you finished everything? The app celebrates with you. Because that deserves recognition.

This isn't about managing an endless to-do list. It's about choosing what matters, informed by what you didn't finish, without the guilt or overwhelm of automatic inheritance.

---

KEEP GOING

We're building this thing together. Keep using the app, keep sharing what works and what doesn't. The more real-world usage we see, the better Domani becomes for everyone who values intentional productivity.

Task Rollover launches soon. You'll be the first to try it.

Talk soon,
— The Domani Team

P.S. If something feels off or you have ideas about what should come next, just reply to this email. We read everything.

---
domani-app.com

Unsubscribe: ${unsubscribeUrl}`
}
