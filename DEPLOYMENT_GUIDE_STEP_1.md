# Step 1: Fetch Deployments for a Website

**Goal:** Get all deployment logs for a specific website.

**Scope:** ONE website at a time. Everything is website-scoped.

---

## Endpoint

```
GET /api/websites/:websiteId/deployments
```

**Base URL:** `https://api.pixelversestudios.io`

**Path Parameters:**
- `websiteId` (required) - UUID of the website

**Query Parameters:**
- `limit` (optional) - Number of results per page (1-100, default: 20)
- `offset` (optional) - Starting position for pagination (default: 0)

---

## Example Requests

### Get all deployments (default 20)
```
GET /api/websites/b5e2e350-3015-4adc-8ace-7a4598cc14b9/deployments
```

### Get first 10 deployments
```
GET /api/websites/b5e2e350-3015-4adc-8ace-7a4598cc14b9/deployments?limit=10
```

### Get next 10 (pagination)
```
GET /api/websites/b5e2e350-3015-4adc-8ace-7a4598cc14b9/deployments?limit=10&offset=10
```

---

## Response

### Success (200 OK)

```json
{
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "website_title": "PixelVerse Studios",
  "total": 42,
  "limit": 20,
  "offset": 0,
  "deployments": [
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
          "indexed_at": "2025-11-24T12:30:00.000000+00:00"
        },
        {
          "url": "https://www.pixelversestudios.io/about",
          "indexed_at": null
        }
      ],
      "summary": "- Updated homepage hero section with new CTA\n- Added new service offerings to services page\n- Refreshed team photos on about page",
      "created_at": "2025-11-24T00:17:37.328336+00:00",
      "indexed_at": null
    },
    {
      "id": "abc-123-def-456",
      "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
      "changed_urls": [
        {
          "url": "https://www.pixelversestudios.io/contact",
          "indexed_at": "2025-11-21T09:15:00.000000+00:00"
        }
      ],
      "summary": "- Fixed contact form bug\n- Updated contact information",
      "created_at": "2025-11-20T14:30:00.000000+00:00",
      "indexed_at": "2025-11-21T09:15:00.000000+00:00"
    }
  ]
}
```

### Empty Result (200 OK)

```json
{
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "website_title": "PixelVerse Studios",
  "total": 0,
  "limit": 20,
  "offset": 0,
  "deployments": []
}
```

### Website Not Found (404 Not Found)

```json
{
  "error": "Website not found"
}
```

---

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `website_id` | string | UUID of the website (matches URL parameter) |
| `website_title` | string | Name of the website |
| `total` | number | Total number of deployments for this website |
| `limit` | number | Number of results per page |
| `offset` | number | Starting position for this page |
| `deployments` | array | Array of deployment objects |

### Deployment Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID of the deployment |
| `website_id` | string | UUID of the website |
| `changed_urls` | array[object] | Array of URL objects with indexing status |
| `summary` | string | Markdown-formatted description of changes |
| `created_at` | string | ISO 8601 timestamp when deployment occurred |
| `indexed_at` | string \| null | ISO 8601 timestamp when ALL URLs indexed, or `null` if any pending |

### URL Object (in changed_urls)

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | The URL that was changed |
| `indexed_at` | string \| null | ISO 8601 timestamp when this URL was indexed, or `null` if not yet indexed |

---

## Understanding Status

### Per-URL Status

Each URL tracks its own indexing status:
- `indexed_at: null` - URL not yet re-indexed in Google Search Console
- `indexed_at: "timestamp"` - URL has been re-indexed

### Deployment Status

The deployment's `indexed_at` field indicates if ALL URLs are indexed:
- `indexed_at: null` - At least one URL is still pending
- `indexed_at: "timestamp"` - All URLs have been indexed (auto-set when last URL is marked)

### Example Status Tracking

**Partially indexed deployment:**
```json
{
  "indexed_at": null,  // Deployment incomplete
  "changed_urls": [
    {"url": "https://example.com/page1", "indexed_at": "2025-11-24T..."}, ✅
    {"url": "https://example.com/page2", "indexed_at": null}  ❌ Still pending
  ]
}
```

**Fully indexed deployment:**
```json
{
  "indexed_at": "2025-11-24T...",  // ✅ All URLs indexed!
  "changed_urls": [
    {"url": "https://example.com/page1", "indexed_at": "2025-11-24T..."}, ✅
    {"url": "https://example.com/page2", "indexed_at": "2025-11-24T..."}  ✅
  ]
}
```

---

## cURL Examples

### Basic request
```bash
curl https://api.pixelversestudios.io/api/websites/b5e2e350-3015-4adc-8ace-7a4598cc14b9/deployments
```

### With pagination
```bash
curl "https://api.pixelversestudios.io/api/websites/b5e2e350-3015-4adc-8ace-7a4598cc14b9/deployments?limit=10&offset=20"
```

### Pretty print with jq
```bash
curl https://api.pixelversestudios.io/api/websites/b5e2e350-3015-4adc-8ace-7a4598cc14b9/deployments | jq
```

---

## Filtering Client-Side

Since all deployments are returned, you can filter client-side:

**Get only pending deployments:**
```javascript
const pending = deployments.filter(d => d.indexed_at === null)
```

**Get pending URLs across all deployments:**
```javascript
const pendingUrls = deployments.flatMap(d =>
  d.changed_urls.filter(urlObj => urlObj.indexed_at === null)
)
```

**Count indexed vs pending:**
```javascript
const stats = {
  total: deployments.length,
  indexed: deployments.filter(d => d.indexed_at !== null).length,
  pending: deployments.filter(d => d.indexed_at === null).length
}
```

---

## Next Steps

- **Step 2:** Mark URLs/deployments as indexed
- **Step 3:** Create new deployments
- **Step 4:** Get all clients and websites
