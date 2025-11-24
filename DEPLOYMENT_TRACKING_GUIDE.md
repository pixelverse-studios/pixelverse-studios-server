# Website Deployment Tracking API - Frontend Integration Guide

**Last Updated:** November 2025
**API Base URL:** `https://api.pixelversestudios.io` (or `http://localhost:5001` for local)

---

## Overview

The PixelVerse Studios Server provides a complete deployment tracking system that records website deployments, tracks changed URLs needing Google Search Console re-indexing, and sends email notifications to clients.

**Use Case:** Your company dashboard can display all client website deployments, show which pages need SEO re-indexing, and provide deployment history and summaries for your team.

---

## Quick Start

### 1. Fetch All Unindexed Deployments (Dashboard Overview)

```javascript
const response = await fetch('https://api.pixelversestudios.io/api/deployments/unindexed')
const data = await response.json()

console.log(data)
// {
//   "total": 5,
//   "deployments": [...]
// }
```

### 2. Fetch Deployment History for a Specific Website

```javascript
const websiteId = 'b5e2e350-3015-4adc-8ace-7a4598cc14b9'
const response = await fetch(
  `https://api.pixelversestudios.io/api/websites/${websiteId}/deployments?limit=10&offset=0`
)
const data = await response.json()

console.log(data)
// {
//   "website_id": "uuid",
//   "website_title": "PixelVerse Studios",
//   "total": 42,
//   "limit": 10,
//   "offset": 0,
//   "deployments": [...]
// }
```

### 3. Mark a Deployment as Indexed (After Re-indexing in GSC)

```javascript
const deploymentId = '2b4fb0af-6bde-462b-be52-a7772ec1755b'
const response = await fetch(
  `https://api.pixelversestudios.io/api/deployments/${deploymentId}/indexed`,
  { method: 'PATCH' }
)
const data = await response.json()

console.log(data.indexed_at)
// "2025-11-24T00:18:59.087+00:00"
```

---

## Complete API Reference

### Endpoint 1: Get All Unindexed Deployments

**Purpose:** Show all deployments with pages that need Google Search Console re-indexing

**Endpoint:** `GET /api/deployments/unindexed`

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| limit | integer | No | 50 | Max results (1-100) |

**Example Request:**
```javascript
const response = await fetch(
  'https://api.pixelversestudios.io/api/deployments/unindexed?limit=20'
)
const { total, deployments } = await response.json()
```

**Example Response:**
```json
{
  "total": 3,
  "deployments": [
    {
      "id": "2b4fb0af-6bde-462b-be52-a7772ec1755b",
      "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
      "changed_urls": [
        "https://www.pixelversestudios.io/",
        "https://www.pixelversestudios.io/services",
        "https://www.pixelversestudios.io/about"
      ],
      "summary": "- Updated homepage hero section with new CTA\n- Added new service offerings to services page\n- Refreshed team photos on about page",
      "created_at": "2025-11-24T00:17:37.328336+00:00",
      "indexed_at": null
    }
  ]
}
```

**Dashboard Use Case:**
- Display a "Needs Indexing" section showing all pending SEO work
- Show how many pages need re-indexing across all client websites
- Sort by date to prioritize oldest deployments first

---

### Endpoint 2: Get Deployment History by Website

**Purpose:** Show all deployment history for a specific client website

**Endpoint:** `GET /api/websites/:websiteId/deployments`

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| websiteId | UUID | Yes | Website UUID |

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| limit | integer | No | 20 | Max results (1-100) |
| offset | integer | No | 0 | Pagination offset |

**Example Request:**
```javascript
const websiteId = 'b5e2e350-3015-4adc-8ace-7a4598cc14b9'
const page = 0
const limit = 10

const response = await fetch(
  `https://api.pixelversestudios.io/api/websites/${websiteId}/deployments?limit=${limit}&offset=${page * limit}`
)
const data = await response.json()
```

**Example Response:**
```json
{
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "website_title": "PixelVerse Studios",
  "total": 42,
  "limit": 10,
  "offset": 0,
  "deployments": [
    {
      "id": "uuid-1",
      "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
      "changed_urls": ["https://..."],
      "summary": "- Bug fixes\n- New features",
      "created_at": "2025-11-24T00:17:37.328336+00:00",
      "indexed_at": "2025-11-24T00:18:59.087+00:00"
    },
    {
      "id": "uuid-2",
      "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
      "changed_urls": ["https://..."],
      "summary": "- Content updates",
      "created_at": "2025-11-23T14:22:10.123456+00:00",
      "indexed_at": null
    }
  ]
}
```

**Dashboard Use Case:**
- Client detail page showing deployment timeline
- Pagination through deployment history
- Show which deployments are indexed vs. pending
- Display deployment frequency/activity

---

### Endpoint 3: Get Single Deployment

**Purpose:** View detailed information about a specific deployment

**Endpoint:** `GET /api/deployments/:id`

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | UUID | Yes | Deployment UUID |

**Example Request:**
```javascript
const deploymentId = '2b4fb0af-6bde-462b-be52-a7772ec1755b'
const response = await fetch(
  `https://api.pixelversestudios.io/api/deployments/${deploymentId}`
)
const deployment = await response.json()
```

**Example Response:**
```json
{
  "id": "2b4fb0af-6bde-462b-be52-a7772ec1755b",
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "changed_urls": [
    "https://www.pixelversestudios.io/",
    "https://www.pixelversestudios.io/services"
  ],
  "summary": "- Updated homepage hero\n- Added new features",
  "created_at": "2025-11-24T00:17:37.328336+00:00",
  "indexed_at": null
}
```

**Dashboard Use Case:**
- Deployment detail modal/page
- Show full list of changed URLs
- Display markdown summary (convert to HTML for rendering)
- Show indexing status

---

### Endpoint 4: Mark Deployment as Indexed

**Purpose:** Update a deployment after manually re-indexing pages in Google Search Console

**Endpoint:** `PATCH /api/deployments/:id/indexed`

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | UUID | Yes | Deployment UUID |

**Example Request:**
```javascript
const deploymentId = '2b4fb0af-6bde-462b-be52-a7772ec1755b'

const response = await fetch(
  `https://api.pixelversestudios.io/api/deployments/${deploymentId}/indexed`,
  {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    }
  }
)

if (response.ok) {
  const deployment = await response.json()
  console.log('Indexed at:', deployment.indexed_at)
}
```

**Example Response:**
```json
{
  "id": "2b4fb0af-6bde-462b-be52-a7772ec1755b",
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "changed_urls": ["https://..."],
  "summary": "...",
  "created_at": "2025-11-24T00:17:37.328336+00:00",
  "indexed_at": "2025-11-24T00:18:59.087+00:00"
}
```

**Dashboard Use Case:**
- "Mark as Indexed" button on deployment cards
- Move deployment from "Pending" to "Completed" list
- Update UI optimistically, then sync with server
- Show indexed timestamp in deployment history

---

### Endpoint 5: Create Deployment (Optional - Automated)

**Purpose:** Record a new deployment (typically automated via GitHub Actions/Netlify webhooks)

**Endpoint:** `POST /api/deployments`

**Request Body:**
```json
{
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "changed_urls": [
    "https://www.pixelversestudios.io/page1",
    "https://www.pixelversestudios.io/page2"
  ],
  "summary": "- Updated homepage\n- Fixed bugs\n- Added new section"
}
```

**Validation Rules:**
- `website_id`: Must be a valid UUID of an existing website
- `changed_urls`: Non-empty array of valid URLs
- `summary`: Non-empty string (markdown format)

**Example Request:**
```javascript
const response = await fetch(
  'https://api.pixelversestudios.io/api/deployments',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      website_id: 'b5e2e350-3015-4adc-8ace-7a4598cc14b9',
      changed_urls: [
        'https://www.pixelversestudios.io/services',
        'https://www.pixelversestudios.io/about'
      ],
      summary: '- Updated services page\n- Refreshed team bios'
    })
  }
)

const deployment = await response.json()
```

**Example Response:**
```json
{
  "id": "newly-created-uuid",
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "changed_urls": ["https://..."],
  "summary": "...",
  "created_at": "2025-11-24T00:17:37.328336+00:00",
  "indexed_at": null
}
```

**Side Effects:**
- Sends email notification to `website.contact_email` if configured
- Email includes deployment summary and changed URLs list

**Dashboard Use Case:**
- Manual deployment creation form (if needed)
- Typically automated via CI/CD pipelines

---

## Data Structures

### Deployment Object

```typescript
interface Deployment {
  id: string                    // UUID
  website_id: string            // UUID (foreign key to websites table)
  changed_urls: string[]        // Array of URLs needing re-indexing
  summary: string               // Markdown-formatted deployment notes
  created_at: string            // ISO 8601 timestamp (e.g., "2025-11-24T00:17:37.328336+00:00")
  indexed_at: string | null     // ISO 8601 timestamp or null if not indexed
}
```

### Deployment History Response

```typescript
interface DeploymentHistoryResponse {
  website_id: string
  website_title: string
  total: number                 // Total deployments for this website
  limit: number                 // Current page size
  offset: number                // Current offset
  deployments: Deployment[]
}
```

### Unindexed Deployments Response

```typescript
interface UnindexedDeploymentsResponse {
  total: number                 // Total unindexed deployments
  deployments: Deployment[]
}
```

---

## Dashboard Implementation Examples

### Example 1: Unindexed Deployments Dashboard Widget

```javascript
// React example
import { useState, useEffect } from 'react'

function UnindexedDeploymentsWidget() {
  const [deployments, setDeployments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('https://api.pixelversestudios.io/api/deployments/unindexed')
      .then(res => res.json())
      .then(data => {
        setDeployments(data.deployments)
        setLoading(false)
      })
  }, [])

  const markAsIndexed = async (deploymentId) => {
    const response = await fetch(
      `https://api.pixelversestudios.io/api/deployments/${deploymentId}/indexed`,
      { method: 'PATCH' }
    )

    if (response.ok) {
      // Remove from unindexed list
      setDeployments(prev => prev.filter(d => d.id !== deploymentId))
    }
  }

  if (loading) return <div>Loading...</div>

  return (
    <div className="widget">
      <h2>Pages Needing Re-indexing ({deployments.length})</h2>
      {deployments.map(deployment => (
        <div key={deployment.id} className="deployment-card">
          <div className="urls">
            <strong>URLs:</strong>
            <ul>
              {deployment.changed_urls.map(url => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="summary">
            <strong>Changes:</strong>
            <pre>{deployment.summary}</pre>
          </div>

          <button onClick={() => markAsIndexed(deployment.id)}>
            Mark as Indexed
          </button>
        </div>
      ))}
    </div>
  )
}
```

---

### Example 2: Client Website Deployment Timeline

```javascript
// React example with pagination
import { useState, useEffect } from 'react'

function WebsiteDeploymentTimeline({ websiteId }) {
  const [data, setData] = useState(null)
  const [page, setPage] = useState(0)
  const limit = 10

  useEffect(() => {
    const offset = page * limit
    fetch(
      `https://api.pixelversestudios.io/api/websites/${websiteId}/deployments?limit=${limit}&offset=${offset}`
    )
      .then(res => res.json())
      .then(setData)
  }, [websiteId, page])

  if (!data) return <div>Loading...</div>

  const totalPages = Math.ceil(data.total / limit)

  return (
    <div className="timeline">
      <h2>{data.website_title} - Deployment History</h2>
      <p>Total Deployments: {data.total}</p>

      {data.deployments.map(deployment => (
        <div
          key={deployment.id}
          className={`deployment-item ${deployment.indexed_at ? 'indexed' : 'pending'}`}
        >
          <div className="header">
            <span className="date">
              {new Date(deployment.created_at).toLocaleDateString()}
            </span>
            <span className={`status ${deployment.indexed_at ? 'success' : 'warning'}`}>
              {deployment.indexed_at ? 'Indexed' : 'Pending'}
            </span>
          </div>

          <div className="summary">
            {/* Render markdown as HTML */}
            <ReactMarkdown>{deployment.summary}</ReactMarkdown>
          </div>

          <div className="urls">
            <strong>Changed Pages ({deployment.changed_urls.length}):</strong>
            <ul>
              {deployment.changed_urls.map(url => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {deployment.indexed_at && (
            <div className="indexed-at">
              Indexed: {new Date(deployment.indexed_at).toLocaleString()}
            </div>
          )}
        </div>
      ))}

      <div className="pagination">
        <button
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>Page {page + 1} of {totalPages}</span>
        <button
          disabled={page >= totalPages - 1}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}
```

---

### Example 3: Dashboard Overview (All Clients)

```javascript
// Fetch unindexed deployments and group by website
async function getDashboardOverview() {
  const response = await fetch(
    'https://api.pixelversestudios.io/api/deployments/unindexed?limit=100'
  )
  const { deployments } = await response.json()

  // Group by website_id
  const grouped = deployments.reduce((acc, deployment) => {
    if (!acc[deployment.website_id]) {
      acc[deployment.website_id] = {
        website_id: deployment.website_id,
        deployments: []
      }
    }
    acc[deployment.website_id].deployments.push(deployment)
    return acc
  }, {})

  return Object.values(grouped)
}

// Usage
function DashboardOverview() {
  const [websiteGroups, setWebsiteGroups] = useState([])

  useEffect(() => {
    getDashboardOverview().then(setWebsiteGroups)
  }, [])

  return (
    <div className="dashboard">
      <h1>SEO Work Queue</h1>

      {websiteGroups.map(group => (
        <div key={group.website_id} className="website-group">
          <h3>Website: {group.website_id}</h3>
          <p>{group.deployments.length} deployment(s) need indexing</p>

          {group.deployments.map(deployment => (
            <DeploymentCard
              key={deployment.id}
              deployment={deployment}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
```

---

## Rendering Markdown Summaries

The `summary` field contains markdown. Here's how to render it in your frontend:

### React with react-markdown

```bash
npm install react-markdown
```

```javascript
import ReactMarkdown from 'react-markdown'

function DeploymentSummary({ summary }) {
  return (
    <div className="deployment-summary">
      <ReactMarkdown>{summary}</ReactMarkdown>
    </div>
  )
}
```

### Vue with marked

```bash
npm install marked
```

```vue
<template>
  <div v-html="renderedSummary" class="deployment-summary"></div>
</template>

<script>
import { marked } from 'marked'

export default {
  props: ['summary'],
  computed: {
    renderedSummary() {
      return marked(this.summary)
    }
  }
}
</script>
```

### Plain JavaScript

```javascript
import { marked } from 'marked'

function renderSummary(summary) {
  const html = marked(summary)
  document.getElementById('summary').innerHTML = html
}
```

---

## Typical Workflows

### Workflow 1: Daily SEO Check

**Goal:** Check what pages need re-indexing across all client websites

1. Fetch unindexed deployments: `GET /api/deployments/unindexed`
2. Display grouped by website or in a single list
3. Open Google Search Console for each website
4. Submit changed URLs for re-indexing
5. Mark each deployment as indexed: `PATCH /api/deployments/:id/indexed`

---

### Workflow 2: Client Website Review

**Goal:** Review deployment history for a specific client website

1. Navigate to client detail page in your dashboard
2. Fetch deployment history: `GET /api/websites/:websiteId/deployments`
3. Display timeline with:
   - Deployment dates
   - Change summaries (markdown rendered as HTML)
   - Changed URLs
   - Indexing status
4. Filter/sort by indexed status, date, etc.
5. Paginate through history

---

### Workflow 3: Automated Deployment Recording

**Goal:** Automatically record deployments from CI/CD pipeline

**In your GitHub Actions workflow:**

```yaml
name: Deploy and Record

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 2

      - name: Get changed files
        id: changed-files
        run: |
          CHANGED_FILES=$(git diff --name-only HEAD^ HEAD)
          # Convert to URLs (example logic)
          CHANGED_URLS=$(echo "$CHANGED_FILES" | grep '\.html$' | sed 's/^/https:\/\/yourwebsite.com\//' | jq -R -s -c 'split("\n")[:-1]')
          echo "changed_urls=$CHANGED_URLS" >> $GITHUB_OUTPUT

      - name: Generate summary
        id: summary
        run: |
          SUMMARY=$(git log -1 --pretty=format:"%B" | sed 's/^/- /')
          echo "summary=$SUMMARY" >> $GITHUB_OUTPUT

      - name: Record deployment
        run: |
          curl -X POST https://api.pixelversestudios.io/api/deployments \
            -H "Content-Type: application/json" \
            -d '{
              "website_id": "${{ secrets.WEBSITE_ID }}",
              "changed_urls": ${{ steps.changed-files.outputs.changed_urls }},
              "summary": "${{ steps.summary.outputs.summary }}"
            }'
```

---

## Error Handling

### HTTP Status Codes

| Status | Meaning | Example |
|--------|---------|---------|
| 200 | Success | Deployment fetched successfully |
| 201 | Created | Deployment created successfully |
| 400 | Bad Request | Invalid UUID, missing required fields |
| 404 | Not Found | Deployment or website not found |
| 500 | Server Error | Database error, internal error |

### Example Error Responses

**400 Bad Request (Validation Error):**
```json
{
  "errors": [
    {
      "type": "field",
      "value": "invalid-uuid",
      "msg": "website_id must be a valid UUID",
      "path": "website_id",
      "location": "body"
    }
  ]
}
```

**404 Not Found:**
```json
{
  "error": "Website not found"
}
```

**500 Server Error:**
```json
{
  "message": "Internal server error message"
}
```

### Frontend Error Handling Example

```javascript
async function fetchDeployments(websiteId) {
  try {
    const response = await fetch(
      `https://api.pixelversestudios.io/api/websites/${websiteId}/deployments`
    )

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Website not found')
      }
      if (response.status === 400) {
        const { errors } = await response.json()
        throw new Error(errors.map(e => e.msg).join(', '))
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Failed to fetch deployments:', error)
    // Show user-friendly error message
    alert(`Error: ${error.message}`)
    return null
  }
}
```

---

## Performance Considerations

### Caching Strategy

```javascript
// Simple in-memory cache with TTL
const cache = new Map()
const CACHE_TTL = 60000 // 1 minute

async function fetchWithCache(url, ttl = CACHE_TTL) {
  const cached = cache.get(url)

  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data
  }

  const response = await fetch(url)
  const data = await response.json()

  cache.set(url, {
    data,
    timestamp: Date.now()
  })

  return data
}

// Usage
const deployments = await fetchWithCache(
  'https://api.pixelversestudios.io/api/deployments/unindexed'
)
```

### Pagination Best Practices

- Default to 10-20 items per page for performance
- Use offset-based pagination for simple cases
- Consider virtual scrolling for very long lists
- Cache paginated results to avoid refetching

---

## Security Notes

**Current State (as of November 2025):**
- No authentication/authorization implemented
- All endpoints are publicly accessible
- Rate limiting not implemented

**Recommendations for Production:**
- Add API key authentication
- Implement rate limiting
- Restrict CORS origins
- Add request logging/monitoring

**For Your Dashboard:**
- Add authentication layer in your frontend
- Don't expose API URLs in public-facing code
- Use environment variables for API base URL
- Implement proper error handling

---

## Database Schema Reference

**Table:** `website_deployments`

```sql
CREATE TABLE website_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,

    changed_urls TEXT[] NOT NULL,  -- Array of URLs needing re-indexing
    summary TEXT NOT NULL,          -- Markdown summary

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    indexed_at TIMESTAMPTZ          -- Set when re-indexed in GSC
);

CREATE INDEX idx_website_deployments_website_id ON website_deployments(website_id);
CREATE INDEX idx_website_deployments_created_at ON website_deployments(created_at DESC);
CREATE INDEX idx_website_deployments_indexed_at ON website_deployments(indexed_at) WHERE indexed_at IS NULL;
```

---

## Next Steps for Dashboard Development

### Phase 1: Basic Display
1. Create unindexed deployments widget
2. Display deployment details (URLs, summary, date)
3. Implement "Mark as Indexed" button

### Phase 2: Client-Specific Views
1. Add deployment timeline per client website
2. Implement pagination
3. Add filtering (indexed vs. unindexed)
4. Show deployment frequency stats

### Phase 3: Advanced Features
1. Bulk mark as indexed
2. Deployment search/filtering
3. Export deployment reports
4. Deployment analytics dashboard

### Phase 4: Automation
1. Real-time updates (WebSockets or polling)
2. Notifications for new deployments
3. Auto-refresh unindexed count

---

## Testing the API

### Using cURL

```bash
# Get unindexed deployments
curl https://api.pixelversestudios.io/api/deployments/unindexed

# Get deployment history
curl "https://api.pixelversestudios.io/api/websites/b5e2e350-3015-4adc-8ace-7a4598cc14b9/deployments?limit=5"

# Mark as indexed
curl -X PATCH https://api.pixelversestudios.io/api/deployments/2b4fb0af-6bde-462b-be52-a7772ec1755b/indexed

# Create deployment
curl -X POST https://api.pixelversestudios.io/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
    "changed_urls": ["https://example.com/page"],
    "summary": "- Test deployment"
  }'
```

### Using Postman/Insomnia

1. Import the API endpoints as a collection
2. Set base URL variable: `https://api.pixelversestudios.io`
3. Test each endpoint with sample data
4. Save example responses for reference

---

## Support & Documentation

**Backend Code:** `/Users/phil/PVS-local/Projects/internal/pixelverse-studios-server`

**Key Files:**
- Routes: `src/routes/deployments.ts`
- Controller: `src/controllers/deployments.ts`
- Service: `src/services/deployments.ts`
- Email Templates: `src/utils/mailer/emails.ts`
- Full Documentation: `CLAUDE.md`

**Example Response:**
See test results in this guide or run the API locally to inspect actual responses.

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────────┐
│ Deployment Tracking API - Quick Reference                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ GET  /api/deployments/unindexed                                    │
│      → Get all deployments needing indexing                        │
│                                                                     │
│ GET  /api/websites/:websiteId/deployments?limit=10&offset=0       │
│      → Get deployment history for a website                        │
│                                                                     │
│ GET  /api/deployments/:id                                          │
│      → Get single deployment details                               │
│                                                                     │
│ PATCH /api/deployments/:id/indexed                                 │
│       → Mark deployment as indexed                                 │
│                                                                     │
│ POST /api/deployments                                              │
│      → Create new deployment record                                │
│      Body: { website_id, changed_urls[], summary }                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

**Ready to build your dashboard!** Use this guide as a reference when integrating the deployment tracking API into your frontend project.
