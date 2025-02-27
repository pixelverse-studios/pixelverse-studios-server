interface FormSubmissionEmailProps {
    website: string
    fullname: string
    email: string
    phone: string
    data: any
}

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
