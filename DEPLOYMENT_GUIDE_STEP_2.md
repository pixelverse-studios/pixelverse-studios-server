# Step 2: Mark URLs/Deployment as Indexed

**Goal:** Update indexing status after re-indexing URLs in Google Search Console.

You can either mark individual URLs or mark the entire deployment at once.

---

## Option 1: Mark Single URL as Indexed (Recommended)

```
PATCH /api/deployments/:deploymentId/urls/indexed
```

**Base URL:** `https://api.pixelversestudios.io`

**Path Parameters:**
- `deploymentId` (required) - UUID of the deployment

**Request Body:**
```json
{
  "url": "https://www.example.com/page"
}
```

**When to use:** Mark URLs individually as you re-index them in GSC. When all URLs are marked, the deployment's `indexed_at` is automatically set.

---

## Option 2: Mark Entire Deployment as Indexed

```
PATCH /api/deployments/:deploymentId/indexed
```

**Base URL:** `https://api.pixelversestudios.io`

**Path Parameters:**
- `deploymentId` (required) - UUID of the deployment

**Request Body:** None required

**When to use:** Mark all URLs in a deployment as indexed at once (sets `indexed_at` for all URLs and the deployment)

---

## Example Requests

### Mark Single URL

```bash
PATCH /api/deployments/2b4fb0af-6bde-462b-be52-a7772ec1755b/urls/indexed

Body:
{
  "url": "https://www.pixelversestudios.io/services"
}
```

### Mark Entire Deployment

```bash
PATCH /api/deployments/2b4fb0af-6bde-462b-be52-a7772ec1755b/indexed
```

---

## Response Examples

### Option 1: Single URL Marked (200 OK)

After marking one URL (deployment still has pending URLs):

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
      "indexed_at": "2025-11-24T15:30:45.123456+00:00"
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

**Note:** `indexed_at` for the deployment is still `null` because not all URLs are indexed yet.

---

### Success - All URLs Indexed (200 OK)

After marking the last URL:

```json
{
  "id": "2b4fb0af-6bde-462b-be52-a7772ec1755b",
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "changed_urls": [
    {
      "url": "https://www.pixelversestudios.io/",
      "indexed_at": "2025-11-24T15:31:12.456789+00:00"
    },
    {
      "url": "https://www.pixelversestudios.io/services",
      "indexed_at": "2025-11-24T15:30:45.123456+00:00"
    },
    {
      "url": "https://www.pixelversestudios.io/about",
      "indexed_at": "2025-11-24T15:32:03.789012+00:00"
    }
  ],
  "summary": "- Updated homepage hero section with new CTA\n- Added new service offerings to services page\n- Refreshed team photos on about page",
  "created_at": "2025-11-24T00:17:37.328336+00:00",
  "indexed_at": "2025-11-24T15:32:03.789012+00:00"
}
```

**Note:** The deployment's `indexed_at` is now automatically set because all URLs are indexed!

---

### Option 2: Entire Deployment Marked (200 OK)

When marking the entire deployment as indexed (all URLs marked at once):

```json
{
  "id": "2b4fb0af-6bde-462b-be52-a7772ec1755b",
  "website_id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
  "changed_urls": [
    {
      "url": "https://www.pixelversestudios.io/",
      "indexed_at": "2025-11-24T16:00:00.000000+00:00"
    },
    {
      "url": "https://www.pixelversestudios.io/services",
      "indexed_at": "2025-11-24T16:00:00.000000+00:00"
    },
    {
      "url": "https://www.pixelversestudios.io/about",
      "indexed_at": "2025-11-24T16:00:00.000000+00:00"
    }
  ],
  "summary": "- Updated homepage hero section with new CTA\n- Added new service offerings to services page\n- Refreshed team photos on about page",
  "created_at": "2025-11-24T00:17:37.328336+00:00",
  "indexed_at": "2025-11-24T16:00:00.000000+00:00"
}
```

**Note:** All URLs are marked with the same timestamp, and the deployment is marked as complete in a single operation.

---

### Deployment Not Found (404 Not Found)

```json
{
  "error": "Deployment not found"
}
```

---

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID of the deployment |
| `website_id` | string | UUID of the website |
| `changed_urls` | array[string] | URLs that were changed |
| `summary` | string | Markdown description of changes |
| `created_at` | string | ISO 8601 timestamp when deployment occurred |
| `indexed_at` | string | ISO 8601 timestamp when marked as indexed (just set) |

---

## What These Endpoints Do

### Option 1: Mark Single URL (`/urls/indexed`)
1. Sets `indexed_at` for the specified URL only
2. Checks if all URLs are now indexed
3. If all URLs indexed, automatically sets deployment's `indexed_at`
4. Otherwise, deployment remains pending

### Option 2: Mark Entire Deployment (`/indexed`)
1. Sets `indexed_at` for **ALL URLs** in the deployment
2. Sets deployment's `indexed_at`
3. Marks deployment as complete in one operation
4. Use when you've already indexed all URLs in GSC

---

## Filtering Deployments

You can filter deployments by status:

**Open/Pending deployments:** `indexed_at === null`
- At least one URL is not yet indexed
- Still requires indexing work

**Completed deployments:** `indexed_at !== null`
- All URLs have been indexed
- No further action needed

### Client-Side Filtering Examples

```javascript
// Filter open deployments
const openDeployments = deployments.filter(d => d.indexed_at === null)

// Filter completed deployments
const completedDeployments = deployments.filter(d => d.indexed_at !== null)

// Get count of pending URLs in a deployment
const pendingUrlCount = deployment.changed_urls
  .filter(url => url.indexed_at === null)
  .length

// Check if deployment has any pending URLs
const hasPendingUrls = deployment.changed_urls
  .some(url => url.indexed_at === null)

// Get completion percentage
const completionPercent = (deployment.changed_urls
  .filter(url => url.indexed_at !== null).length /
  deployment.changed_urls.length) * 100
```

---

## cURL Examples

### Mark single URL as indexed
```bash
curl -X PATCH https://api.pixelversestudios.io/api/deployments/2b4fb0af-6bde-462b-be52-a7772ec1755b/urls/indexed \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.pixelversestudios.io/services"}'
```

### Mark entire deployment as indexed
```bash
curl -X PATCH https://api.pixelversestudios.io/api/deployments/2b4fb0af-6bde-462b-be52-a7772ec1755b/indexed
```

### With pretty print
```bash
curl -X PATCH https://api.pixelversestudios.io/api/deployments/2b4fb0af-6bde-462b-be52-a7772ec1755b/urls/indexed \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.pixelversestudios.io/services"}' | jq
```

---

## Workflow

### Recommended: Per-URL Tracking

1. Fetch deployments for a website (Step 1)
2. For each pending deployment, see which URLs need indexing
3. Re-index a URL in Google Search Console
4. Mark that specific URL as indexed: `PATCH /api/deployments/:id/urls/indexed`
5. Repeat for each URL
6. When the last URL is marked, the deployment automatically completes

### Alternative: Bulk Indexing

1. Re-index all URLs for a deployment in Google Search Console
2. Mark entire deployment as indexed: `PATCH /api/deployments/:id/indexed`
3. All URLs and the deployment are marked as indexed at once

---

## Next Steps

- **Step 3:** Create a new deployment
- **Step 4:** Get all clients and websites
