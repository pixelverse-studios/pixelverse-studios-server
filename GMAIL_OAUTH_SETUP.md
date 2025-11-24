# Gmail OAuth2 Setup Guide

This guide will help you set up Gmail OAuth2 credentials for sending deployment notification emails.

## Prerequisites

- A Google account (Gmail)
- Access to Google Cloud Console

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Create Project" or select an existing project
3. Name your project (e.g., "PixelVerse Server")

## Step 2: Enable Gmail API

1. In your project, go to "APIs & Services" > "Library"
2. Search for "Gmail API"
3. Click on it and press "Enable"

## Step 3: Configure OAuth Consent Screen

1. Go to "APIs & Services" > "OAuth consent screen"
2. Select "External" user type (or "Internal" if using Google Workspace)
3. Fill in required fields:
   - App name: "PixelVerse Studios Server"
   - User support email: your email
   - Developer contact: your email
4. Click "Save and Continue"
5. On "Scopes" page, click "Add or Remove Scopes"
6. Add this scope: `https://www.googleapis.com/auth/gmail.send`
7. Click "Save and Continue"
8. Add test users (your Gmail address)
9. Click "Save and Continue"

## Step 4: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Choose "Desktop app" as application type
4. Name it: "PixelVerse Server OAuth"
5. Click "Create"
6. **Save the Client ID and Client Secret** - you'll need these for `.env`

## Step 5: Generate Refresh Token

You need to generate a refresh token that never expires. Use this Node.js script:

```javascript
// oauth2-refresh-token.js
const { google } = require('googleapis');
const readline = require('readline');

const CLIENT_ID = 'your-client-id-here';
const CLIENT_SECRET = 'your-client-secret-here';
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

// Generate auth URL
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent'
});

console.log('Authorize this app by visiting this URL:', authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Enter the authorization code from that page: ', (code) => {
  rl.close();
  oAuth2Client.getToken(code, (err, token) => {
    if (err) return console.error('Error retrieving access token', err);
    console.log('\n✅ Your refresh token is:');
    console.log(token.refresh_token);
    console.log('\n⚠️  Save this refresh token - it will not be shown again!');
  });
});
```

### Run the script:

```bash
npm install googleapis
node oauth2-refresh-token.js
```

1. Visit the URL shown in your terminal
2. Authorize the app with your Google account
3. Copy the authorization code
4. Paste it into the terminal
5. **Save the refresh token** - you'll need it for `.env`

## Step 6: Add to .env

Add these values to your `.env` file:

```env
GMAIL_USER=your-email@gmail.com
GMAIL_CLIENT_ID=your-client-id-from-step-4
GMAIL_CLIENT_SECRET=your-client-secret-from-step-4
GMAIL_REFRESH_TOKEN=your-refresh-token-from-step-5
```

## Step 7: Test Email Sending

Create a deployment to test:

```bash
curl -X POST http://localhost:5001/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "website_id": "your-website-uuid",
    "changed_urls": ["https://example.com/page"],
    "summary": "Test deployment"
  }'
```

Check your server logs for:
```
✅ Deployment email sent: client@email.com for Website Name
```

## Troubleshooting

### "Error sending email: invalid_grant"
- Your refresh token expired or is invalid
- Regenerate the refresh token (Step 5)
- Make sure OAuth consent screen is published

### "Error sending email: unauthorized_client"
- Gmail API is not enabled
- OAuth client ID is incorrect
- Scopes don't match what you authorized

### No email received
- Check spam folder
- Verify `contact_email` is set in the website record
- Check server logs for email errors

## Security Notes

- Never commit `.env` file to git
- Keep refresh token secure
- Use service accounts for production if possible
- Regularly rotate credentials
