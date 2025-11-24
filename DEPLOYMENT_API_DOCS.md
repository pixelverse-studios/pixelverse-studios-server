# Deployment Tracking API Documentation

## Create Deployment Endpoint

### Endpoint
```
POST /api/deployments
```

### Description
Creates a new deployment record for a website and sends an automated email notification to the website's contact email. The email includes deployment details, change summary, and a list of changed URLs that need to be re-indexed in Google Search Console.

### Request Headers
```
Content-Type: application/json
```

### Request Body
```json
{
  "website_id": "uuid",
  "changed_urls": ["string"],
  "deploy_summary": "string (markdown supported)",
  "internal_notes": "string (optional, markdown supported)"
}
```

### Request Body Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `website_id` | UUID | Yes | The ID of the website being deployed |
| `changed_urls` | Array of strings | Yes | List of URLs that were changed in this deployment |
| `deploy_summary` | String | Yes | Markdown-formatted summary of deployment changes sent in email. Supports bold (**text**), italic (*text*), and bullet lists (- item) |
| `internal_notes` | String | No | Internal team notes (not sent in email). Can include technical details, environment variables, or other internal information |

### Response
**Success (201 Created)**
```json
{
  "id": "uuid",
  "website_id": "uuid",
  "changed_urls": ["string"],
  "deploy_summary": "string",
  "internal_notes": "string or null",
  "created_at": "ISO 8601 timestamp",
  "indexed_at": null
}
```

**Error (400 Bad Request)**
```json
{
  "errors": [
    {
      "msg": "Invalid value",
      "param": "field_name",
      "location": "body"
    }
  ]
}
```

**Error (404 Not Found)**
```json
{
  "error": "Website not found"
}
```

### Example Request
```bash
curl -X POST http://localhost:5001/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "website_id": "123e4567-e89b-12d3-a456-426614174000",
    "changed_urls": [
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/services"
    ],
    "deploy_summary": "**Major update to homepage and services**\n\n- Updated hero section with new imagery\n- Added new service offerings\n- Improved mobile responsiveness",
    "internal_notes": "**Technical details:**\n- Updated NEXT_PUBLIC_API_URL environment variable\n- Fixed OAuth redirect configuration\n- Requires re-indexing in Google Search Console"
  }'
```

### Example Response
```json
{
  "id": "987f6543-e21b-45c6-b789-123456789abc",
  "website_id": "123e4567-e89b-12d3-a456-426614174000",
  "changed_urls": [
    "https://example.com/",
    "https://example.com/about",
    "https://example.com/services"
  ],
  "deploy_summary": "**Major update to homepage and services**\n\n- Updated hero section with new imagery\n- Added new service offerings\n- Improved mobile responsiveness",
  "internal_notes": "**Technical details:**\n- Updated NEXT_PUBLIC_API_URL environment variable\n- Fixed OAuth redirect configuration\n- Requires re-indexing in Google Search Console",
  "created_at": "2025-01-24T10:30:00.000Z",
  "indexed_at": null
}
```

### Email Notification
When a deployment is created, an automated email is sent to the website's `contact_email` with:
- Deployment date
- **Deploy summary only** (rendered from markdown to HTML) - `internal_notes` are NOT included in the email
- List of all changed URLs
- Call-to-action button linking to Google Search Console

**Email subject:** `🚀 New Deployment: {Website Title}`

**Recipients:**
- **To:** Website's `contact_email` (from database)
- **CC:** sami@pixelversestudios.io (automatically added to all deployment emails)

**Important:** Only the `deploy_summary` field is sent in the email. The `internal_notes` field is stored in the database but never sent to clients.

### Notes
- The email notification is sent asynchronously and won't cause the API request to fail if email delivery fails
- Email is only sent if the website has a `contact_email` configured
- Both `deploy_summary` and `internal_notes` fields support basic markdown formatting:
  - `**text**` for bold
  - `*text*` for italic
  - `- item` for bullet points
- **Deploy summary vs Internal notes:**
  - `deploy_summary`: Client-facing changes sent in email (e.g., "Updated homepage design", "Added new features")
  - `internal_notes`: Team-only notes NOT sent in email (e.g., environment variables, technical details, internal tasks)
- All URLs in `changed_urls` should be fully qualified (include protocol)
- The deployment's `indexed_at` field is `null` initially and can be updated later when URLs are indexed

### Integration Example (JavaScript)

```javascript
async function createDeployment(websiteId, changedUrls, deploySummary, internalNotes = null) {
  try {
    const response = await fetch('http://localhost:5001/api/deployments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        website_id: websiteId,
        changed_urls: changedUrls,
        deploy_summary: deploySummary,
        internal_notes: internalNotes
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(JSON.stringify(error));
    }

    const deployment = await response.json();
    console.log('Deployment created:', deployment);
    return deployment;
  } catch (error) {
    console.error('Failed to create deployment:', error);
    throw error;
  }
}

// Usage
createDeployment(
  '123e4567-e89b-12d3-a456-426614174000',
  [
    'https://example.com/',
    'https://example.com/about'
  ],
  '**Homepage refresh**\n\n- Updated branding\n- New testimonials',
  '**Internal notes:**\n- Updated NEXT_PUBLIC_API_URL\n- Fixed OAuth configuration'
);
```

## Additional Endpoints

### Get Deployments by Website
```
GET /api/deployments/website/:websiteId?limit=20&offset=0
```

### Get Single Deployment
```
GET /api/deployments/:id
```

### Mark Deployment as Indexed
```
PATCH /api/deployments/:id/indexed
```

### Mark Specific URL as Indexed
```
PATCH /api/deployments/:id/urls/indexed
Body: { "url": "https://example.com/page" }
```

### Get Unindexed Deployments
```
GET /api/deployments/unindexed?limit=50
```
