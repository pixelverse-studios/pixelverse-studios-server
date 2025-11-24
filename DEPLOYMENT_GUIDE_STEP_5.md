# Step 5: API Reference Summary

**Goal:** Quick reference for all deployment tracking endpoints.

---

## All Endpoints

### 1. Get Deployments for a Website
```
GET /api/websites/:websiteId/deployments?limit=20&offset=0
```
**Returns:** Paginated deployment history for a specific website
**See:** Step 1

---

### 2. Mark Deployment as Indexed
```
PATCH /api/deployments/:deploymentId/indexed
```
**Returns:** Updated deployment with `indexed_at` timestamp
**See:** Step 2

---

### 3. Create New Deployment
```
POST /api/deployments
```
**Returns:** Newly created deployment record
**See:** Step 3

---

### 4. Get All Clients with Websites
```
GET /api/clients
```
**Returns:** All clients with nested website arrays
**See:** Step 4

---

## Complete Workflow Example

### 1. Dashboard Initialization

```bash
# Get all clients and websites for navigation
curl https://api.pixelversestudios.io/api/clients
```

Response:
```json
[
  {
    "id": "client-uuid",
    "firstname": "PixelVerse",
    "lastname": "Studios",
    "websites": [
      {
        "id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
        "title": "PixelVerse Studios",
        "domain": "www.pixelversestudios.io"
      }
    ]
  }
]
```

---

### 2. View Website Deployments

```bash
# User clicks on "PixelVerse Studios" website
# Fetch its deployment history
curl "https://api.pixelversestudios.io/api/websites/b5e2e350-3015-4adc-8ace-7a4598cc14b9/deployments?limit=20&offset=0"
```

Response:
```json
{
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "website_title": "PixelVerse Studios",
  "total": 42,
  "limit": 20,
  "offset": 0,
  "deployments": [
    {
      "id": "deployment-uuid-1",
      "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
      "changed_urls": ["https://www.pixelversestudios.io/"],
      "summary": "- Updated homepage",
      "created_at": "2025-11-24T00:17:37.328336+00:00",
      "indexed_at": null
    },
    {
      "id": "deployment-uuid-2",
      "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
      "changed_urls": ["https://www.pixelversestudios.io/about"],
      "summary": "- Fixed bug",
      "created_at": "2025-11-20T14:30:00.000000+00:00",
      "indexed_at": "2025-11-21T09:15:00.000000+00:00"
    }
  ]
}
```

**Client-side filtering:**
- Pending: `deployments.filter(d => !d.indexed_at)`
- Indexed: `deployments.filter(d => d.indexed_at)`

---

### 3. Re-index URLs in Google Search Console

Manual step (not API):
1. Go to Google Search Console
2. Request indexing for each URL in `changed_urls`

---

### 4. Mark Deployment as Indexed

```bash
# After re-indexing URLs in GSC, mark deployment as complete
curl -X PATCH https://api.pixelversestudios.io/api/deployments/deployment-uuid-1/indexed
```

Response:
```json
{
  "id": "deployment-uuid-1",
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "changed_urls": ["https://www.pixelversestudios.io/"],
  "summary": "- Updated homepage",
  "created_at": "2025-11-24T00:17:37.328336+00:00",
  "indexed_at": "2025-11-24T15:30:45.123456+00:00"
}
```

**Note:** `indexed_at` is now populated with current timestamp

---

### 5. Automated Deployment Creation

From GitHub Actions or Netlify webhook:

```bash
# When deployment happens, webhook creates deployment record
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

Response:
```json
{
  "id": "new-deployment-uuid",
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "changed_urls": [
    "https://www.pixelversestudios.io/",
    "https://www.pixelversestudios.io/services"
  ],
  "summary": "- Updated homepage\n- Added new services",
  "created_at": "2025-11-24T16:00:00.000000+00:00",
  "indexed_at": null
}
```

Email notification automatically sent if website has `contact_email` configured.

---

## Pagination Example

### First page (0-19)
```bash
curl "https://api.pixelversestudios.io/api/websites/b5e2e350-3015-4adc-8ace-7a4598cc14b9/deployments?limit=20&offset=0"
```

### Second page (20-39)
```bash
curl "https://api.pixelversestudios.io/api/websites/b5e2e350-3015-4adc-8ace-7a4598cc14b9/deployments?limit=20&offset=20"
```

### Third page (40-59)
```bash
curl "https://api.pixelversestudios.io/api/websites/b5e2e350-3015-4adc-8ace-7a4598cc14b9/deployments?limit=20&offset=40"
```

**Calculate total pages:**
```javascript
totalPages = Math.ceil(total / limit)
// If total = 42 and limit = 20, then totalPages = 3
```

---

## Common Queries

### Get only first 10 deployments
```bash
curl "https://api.pixelversestudios.io/api/websites/{websiteId}/deployments?limit=10"
```

### Get all websites for a client
```bash
curl https://api.pixelversestudios.io/api/clients | jq '.[] | select(.id == "{client-id}") | .websites'
```

### Count pending deployments for a website
```bash
curl "https://api.pixelversestudios.io/api/websites/{websiteId}/deployments?limit=100" | jq '[.deployments[] | select(.indexed_at == null)] | length'
```

---

## Error Handling

### Website Not Found (404)
```json
{
  "error": "Website not found"
}
```

### Deployment Not Found (404)
```json
{
  "error": "Deployment not found"
}
```

### Validation Error (400)
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

## Data Hierarchy

```
Client
└─ Website(s)
   └─ Deployment(s)
      ├─ changed_urls (array)
      ├─ summary (markdown)
      ├─ created_at (timestamp)
      └─ indexed_at (timestamp or null)
```

**Key Principle:** Everything is scoped to a website. Never fetch all deployments system-wide.

---

## Summary

You now have complete API documentation for:
- ✅ Fetching deployments per website (Step 1)
- ✅ Marking deployments as indexed (Step 2)
- ✅ Creating new deployments (Step 3)
- ✅ Getting clients and websites for navigation (Step 4)

All endpoints follow the website-scoped architecture: **Client → Website → Deployments**
