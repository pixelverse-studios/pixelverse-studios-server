# Deployment Tracking - Corrected Flow (Website-Centric)

**Important:** The guides have been corrected to follow the proper hierarchy: Client → Website → Deployments

---

## The Correct Hierarchy

```
Clients
  └─ Client (e.g., "PixelVerse Studios")
      └─ Websites
          └─ Website (e.g., "www.pixelversestudios.io")
              └─ Deployment Details
                  ├─ Deployment History (all deployments for this website)
                  ├─ Pending Deployments (filter: indexed_at === null)
                  └─ Indexed Deployments (filter: indexed_at !== null)
```

---

## Key API Endpoints (Website-Scoped)

### 1. Get All Clients with Websites
```
GET /api/clients
```

Returns all clients with their nested websites. This is your starting point.

---

### 2. Get Deployments for a Specific Website
```
GET /api/websites/:websiteId/deployments?limit=20&offset=0
```

Returns ALL deployments for a specific website (both pending and indexed).

**Response:**
```json
{
  "website_id": "uuid",
  "website_title": "Website Name",
  "total": 42,
  "limit": 20,
  "offset": 0,
  "deployments": [
    {
      "id": "uuid",
      "website_id": "uuid",
      "changed_urls": ["https://..."],
      "summary": "- Changes made",
      "created_at": "2025-11-24T...",
      "indexed_at": "2025-11-24T..." // or null if not indexed
    }
  ]
}
```

**To show only pending (unindexed):** Filter client-side where `indexed_at === null`

---

### 3. Mark Deployment as Indexed
```
PATCH /api/deployments/:deploymentId/indexed
```

Marks a specific deployment as indexed.

---

## Corrected User Flow

### Step 1: Display Clients
- Fetch `GET /api/clients`
- Show list of clients with their websites

### Step 2: Click on a Website
- User clicks on a website (e.g., "www.pixelversestudios.io")
- Navigate to website detail view
- Fetch `GET /api/websites/{websiteId}/deployments`

### Step 3: Show Deployment Stats
- Total deployments
- Pending: `deployments.filter(d => !d.indexed_at).length`
- Indexed: `deployments.filter(d => d.indexed_at).length`

### Step 4: Display Deployments
- Show all deployments in a list
- Mark which ones are pending vs. indexed
- Show deployment date, changed URLs, summary

### Step 5: Mark as Indexed
- User clicks "Mark as Indexed" on a deployment
- Call `PATCH /api/deployments/{deploymentId}/indexed`
- Remove from pending list or update status

---

## Example Dashboard Flow

```
1. Clients List Page
┌──────────────────────────────────────┐
│ Clients Dashboard                    │
│                                      │
│ PixelVerse Studios                   │
│ └─ PixelVerse Studios               │
│    www.pixelversestudios.io         │
│    [View Deployments] ← Click here  │
│                                      │
│ Kyle Jones                           │
│ └─ Client Website 1                 │
│    example.com                      │
│    [View Deployments]               │
└──────────────────────────────────────┘

2. Website Detail Page (after clicking "View Deployments")
┌──────────────────────────────────────┐
│ PixelVerse Studios                   │
│ www.pixelversestudios.io            │
│                                      │
│ Deployment Stats:                    │
│ • Total: 15                         │
│ • Pending: 3                        │
│ • Indexed: 12                       │
│                                      │
│ [Show All] [Show Pending] [Show Indexed]
│                                      │
│ Deployments:                         │
│                                      │
│ Nov 24, 2025 [PENDING]              │
│ • https://site.com/page1            │
│ • https://site.com/page2            │
│ Summary: - Updated homepage         │
│ [Mark as Indexed]                   │
│                                      │
│ Nov 20, 2025 [INDEXED]              │
│ • https://site.com/about            │
│ Summary: - Fixed bug                │
│ Indexed: Nov 21, 2025               │
│                                      │
│ [Previous] Page 1 of 3 [Next]       │
└──────────────────────────────────────┘
```

---

## What Changed from Previous Guides

### ❌ OLD (Incorrect):
- Started with `GET /api/deployments/unindexed` (system-wide)
- Showed all deployments across all websites
- Then grouped by website

### ✅ NEW (Correct):
- Start with `GET /api/clients` (get clients and websites)
- User clicks on a specific website
- Fetch `GET /api/websites/:websiteId/deployments` (scoped to that website)
- Filter client-side for pending if needed

---

## Revised Step Guides

### Step 1: Display Clients and Websites
- Endpoint: `GET /api/clients`
- Show: List of clients with their websites
- Make websites clickable

### Step 2: Fetch Deployments for a Website
- Endpoint: `GET /api/websites/:websiteId/deployments`
- Show: All deployments for that website
- Calculate: Pending vs. indexed counts

### Step 3: Display Deployment Details
- Show: Deployment date, URLs, summary, status
- Format: Markdown rendering for summaries

### Step 4: Mark Deployments as Indexed
- Endpoint: `PATCH /api/deployments/:deploymentId/indexed`
- Action: Update deployment status
- UI: Remove from pending or update badge

### Step 5: Add Pagination
- Use: `limit` and `offset` query parameters
- Navigate: Through deployment history

### Step 6: Add Filtering
- Client-side: Filter by pending/indexed status
- Filter: By date range
- Sort: By date, URL count, etc.

### Step 7: Polish UI
- Tabs: All | Pending | Indexed
- Stats: Show counts
- Search: Filter by keyword

---

## Code Example: Correct Flow

```javascript
// 1. Fetch clients
const clients = await fetch('/api/clients').then(r => r.json())

// 2. User clicks on a website
const websiteId = 'b5e2e350-3015-4adc-8ace-7a4598cc14b9'

// 3. Fetch deployments for that website
const response = await fetch(`/api/websites/${websiteId}/deployments?limit=20&offset=0`)
const data = await response.json()

// {
//   website_id: "uuid",
//   website_title: "PixelVerse Studios",
//   total: 42,
//   deployments: [...]
// }

// 4. Filter for pending if needed
const pending = data.deployments.filter(d => !d.indexed_at)
const indexed = data.deployments.filter(d => d.indexed_at)

console.log(`Pending: ${pending.length}, Indexed: ${indexed.length}`)

// 5. Mark as indexed
await fetch(`/api/deployments/${deploymentId}/indexed`, { method: 'PATCH' })
```

---

## Summary

**Key Principle:** Everything is scoped to a website. You never fetch all deployments system-wide.

**Navigation:** Clients → Website → Deployment History

**Filtering:** Done client-side after fetching website-specific deployments.

---

I'm now rewriting all 7 step guides to follow this correct flow. Continue working on Step 1 (displaying clients), and the updated guides will follow this structure!
