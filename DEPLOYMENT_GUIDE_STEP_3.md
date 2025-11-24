# Step 3: Create a New Deployment

**Goal:** Record a new deployment with changed URLs and summary notes.

---

## Endpoint

```
POST /api/deployments
```

**Base URL:** `https://api.pixelversestudios.io`

**Request Body:**
- `website_id` (required) - UUID of the website
- `changed_urls` (required) - Array of URLs that were changed
- `summary` (required) - Markdown description of changes

---

## Example Request

```json
{
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "changed_urls": [
    "https://www.pixelversestudios.io/",
    "https://www.pixelversestudios.io/services",
    "https://www.pixelversestudios.io/about"
  ],
  "summary": "- Updated homepage hero section with new CTA\n- Added new service offerings to services page\n- Refreshed team photos on about page"
}
```

---

## Response

### Success (201 Created)

```json
{
  "id": "2b4fb0af-6bde-462b-be52-a7772ec1755b",
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "changed_urls": [
    {
      "url": "https://www.pixelversestudios.io/",
      "indexed_at": null
    },
    {
      "url": "https://www.pixelversestudios.io/services",
      "indexed_at": null
    },
    {
      "url": "https://www.pixelversestudios.io/about",
      "indexed_at": null
    }
  ],
  "summary": "- Updated homepage hero section with new CTA\n- Added new service offerings to services page\n- Refreshed team photos on about page",
  "created_at": "2025-11-24T00:17:37.328336+00:00",
  "indexed_at": null
}
```

**Note:** Each URL in `changed_urls` starts with `indexed_at: null` (pending indexing).

### Website Not Found (404 Not Found)

```json
{
  "error": "Website not found"
}
```

### Validation Error (400 Bad Request)

```json
{
  "errors": [
    {
      "msg": "website_id must be a valid UUID",
      "param": "website_id",
      "location": "body"
    }
  ]
}
```

---

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID of the newly created deployment |
| `website_id` | string | UUID of the website |
| `changed_urls` | array[object] | URLs that were changed with indexing status |
| `changed_urls[].url` | string | The URL that changed |
| `changed_urls[].indexed_at` | string \| null | When this URL was indexed (always `null` on creation) |
| `summary` | string | Markdown description of changes |
| `created_at` | string | ISO 8601 timestamp when deployment was created |
| `indexed_at` | string \| null | When ALL URLs indexed (always `null` on creation) |

---

## What This Does

1. Creates a new deployment record in the database
2. Associates it with the specified website
3. Sends email notification to website contact email (if configured)
4. Returns the created deployment with `indexed_at` set to `null`

---

## Email Notification

If the website has a `contact_email` configured, an email notification is automatically sent with:
- Website title
- Deployment date
- Markdown summary (converted to HTML)
- List of changed URLs that need re-indexing in Google Search Console

**Note:** Email failures do not cause the request to fail. The deployment is still created.

---

## cURL Examples

### Basic request
```bash
curl -X POST https://api.pixelversestudios.io/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
    "changed_urls": [
      "https://www.pixelversestudios.io/",
      "https://www.pixelversestudios.io/services"
    ],
    "summary": "- Updated homepage\n- Added new services"
  }'
```

### With pretty print
```bash
curl -X POST https://api.pixelversestudios.io/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
    "changed_urls": ["https://www.pixelversestudios.io/"],
    "summary": "- Updated homepage"
  }' | jq
```

---

## TypeScript/JavaScript Example

```typescript
interface CreateDeploymentRequest {
  website_id: string
  changed_urls: string[]
  summary: string
}

interface DeploymentResponse {
  id: string
  website_id: string
  changed_urls: Array<{
    url: string
    indexed_at: string | null
  }>
  summary: string
  created_at: string
  indexed_at: string | null
}

async function createDeployment(
  websiteId: string,
  changedUrls: string[],
  summary: string
): Promise<DeploymentResponse> {
  const response = await fetch('https://api.pixelversestudios.io/api/deployments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      website_id: websiteId,
      changed_urls: changedUrls,
      summary: summary
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Failed to create deployment: ${JSON.stringify(error)}`)
  }

  return response.json()
}

// Usage example
try {
  const deployment = await createDeployment(
    'b5e2e350-3015-4adc-8ace-7a4598cc14b9',
    [
      'https://www.pixelversestudios.io/',
      'https://www.pixelversestudios.io/services'
    ],
    '- Updated homepage hero\n- Added new service offerings'
  )

  console.log('✅ Deployment created:', deployment.id)
  console.log('📧 Client notified at:', deployment.created_at)
  console.log('📋 Pending URLs:', deployment.changed_urls.length)
} catch (error) {
  console.error('❌ Failed to create deployment:', error)
}
```

---

## Integration Examples

### From GitHub Actions

```yaml
- name: Notify Deployment
  run: |
    curl -X POST https://api.pixelversestudios.io/api/deployments \
      -H "Content-Type: application/json" \
      -d '{
        "website_id": "${{ secrets.WEBSITE_ID }}",
        "changed_urls": ["https://example.com/page1", "https://example.com/page2"],
        "summary": "- Deployed from commit ${{ github.sha }}"
      }'
```

### From Netlify Deploy Notification

```javascript
// netlify/functions/deploy-notification.js
exports.handler = async (event) => {
  const payload = {
    website_id: process.env.WEBSITE_ID,
    changed_urls: event.body.changed_files.map(f => `https://example.com${f}`),
    summary: `- Deployed: ${event.body.title}\n- Branch: ${event.body.branch}`
  }

  await fetch('https://api.pixelversestudios.io/api/deployments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}
```

---

## Validation Rules

| Field | Rules |
|-------|-------|
| `website_id` | Must be a valid UUID, website must exist |
| `changed_urls` | Must be a non-empty array, each URL must be valid |
| `summary` | Must be a non-empty string (markdown format) |

---

## Workflow

1. **Deploy your website** (Netlify, Vercel, manual, etc.)
2. **Call this endpoint** to log the deployment
3. **Server automatically**:
   - Creates deployment record (all URLs start with `indexed_at: null`)
   - Sends email notification to client's contact email
4. **Use Step 1** to view pending deployments in your UI
5. **Re-index URLs** in Google Search Console (one by one or all at once)
6. **Use Step 2** to mark URLs/deployment as indexed
7. Deployment auto-completes when all URLs are marked

---

## Next Steps

- **Step 1:** Fetch deployments for a website (view in your UI)
- **Step 2:** Mark URLs/deployments as indexed (track progress)
