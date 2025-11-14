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
        { label: 'Email', value: `<a href="mailto:${escapeHtml(email)}" style="color:#7c3aed;">${escapeHtml(email)}</a>` },
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
