# UI Guide: Deployment Tracking System

**Audience:** Frontend developers building the deployment tracking UI

**Goal:** Create a system to log website deployments, track URL indexing status, and display progress.

---

## Table of Contents

1. [Overview](#overview)
2. [Data Collection: What to Track](#data-collection-what-to-track)
3. [Creating a Deployment](#creating-a-deployment)
4. [Viewing Deployments](#viewing-deployments)
5. [Tracking Indexing Progress](#tracking-indexing-progress)
6. [Complete UI Examples](#complete-ui-examples)

---

## Overview

### The Workflow

```
1. User deploys website changes
   ↓
2. UI collects: website ID, changed URLs, summary
   ↓
3. POST to /api/deployments
   ↓
4. Server creates record + emails client
   ↓
5. UI fetches and displays deployments
   ↓
6. User re-indexes URLs in Google Search Console
   ↓
7. UI marks URLs as indexed via PATCH
   ↓
8. Deployment auto-completes when all URLs indexed
```

### Three Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/deployments` | POST | Create new deployment |
| `/api/websites/:id/deployments` | GET | Fetch deployments for a website |
| `/api/deployments/:id/urls/indexed` | PATCH | Mark URL as indexed |
| `/api/deployments/:id/indexed` | PATCH | Mark entire deployment as indexed |

---

## Data Collection: What to Track

### 1. Website ID (UUID)

Get this from your website selector/dropdown.

```typescript
// Example: User selects a website
const websiteId = "b5e2e350-3015-4adc-8ace-7a4598cc14b9"
```

### 2. Changed URLs (Array of Strings)

**What URLs changed in this deployment?**

This is a list of full URLs that were modified/added/updated.

```typescript
const changedUrls = [
  "https://www.pixelversestudios.io/",
  "https://www.pixelversestudios.io/services",
  "https://www.pixelversestudios.io/about"
]
```

**UI Patterns:**
- **Manual entry:** Text input + "Add URL" button
- **Bulk paste:** Textarea where user pastes multiple URLs (one per line)
- **Checkbox list:** Show all pages, user checks which ones changed
- **Integration:** Pull from Git commit files, Netlify changed files, etc.

### 3. Summary (Markdown String)

**What changed in this deployment?**

This is a **markdown-formatted** description of changes. Clients will see this in their email.

```typescript
const summary = `- Updated homepage hero section with new CTA
- Added new service offerings to services page
- Refreshed team photos on about page`
```

**UI Patterns:**
- **Markdown editor:** Rich text editor with markdown preview
- **Simple textarea:** Plain text with markdown syntax guide
- **Pre-filled template:** Provide structure, user fills in details

**Markdown Guidelines for Users:**
```markdown
Good format:
- Updated homepage hero section
- Added new testimonials
- Fixed mobile navigation bug

Also good:
## Design Updates
- New color scheme
- Updated typography

## Content Changes
- Added blog posts
- Updated pricing
```

---

## Creating a Deployment

### API Request

**Endpoint:** `POST https://api.pixelversestudios.io/api/deployments`

**Request Body:**
```typescript
{
  website_id: string    // UUID of the website
  changed_urls: string[] // Array of URLs that changed
  summary: string       // Markdown description
}
```

### TypeScript Implementation

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
    throw new Error(`Failed to create deployment: ${error.error || response.statusText}`)
  }

  return response.json()
}
```

### React Example: Form Component

```tsx
import { useState } from 'react'

interface DeploymentFormProps {
  websiteId: string
  websiteName: string
  onSuccess: () => void
}

export function DeploymentForm({ websiteId, websiteName, onSuccess }: DeploymentFormProps) {
  const [urls, setUrls] = useState<string[]>([''])
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addUrlField = () => setUrls([...urls, ''])

  const updateUrl = (index: number, value: string) => {
    const newUrls = [...urls]
    newUrls[index] = value
    setUrls(newUrls)
  }

  const removeUrl = (index: number) => {
    setUrls(urls.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Filter out empty URLs
    const validUrls = urls.filter(url => url.trim() !== '')

    if (validUrls.length === 0) {
      setError('Please add at least one URL')
      setLoading(false)
      return
    }

    if (!summary.trim()) {
      setError('Please add a summary')
      setLoading(false)
      return
    }

    try {
      await createDeployment(websiteId, validUrls, summary)
      onSuccess()
      // Reset form
      setUrls([''])
      setSummary('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create deployment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">
          Log Deployment: {websiteName}
        </h2>
      </div>

      {/* URLs Section */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Changed URLs
        </label>
        {urls.map((url, index) => (
          <div key={index} className="flex gap-2 mb-2">
            <input
              type="url"
              value={url}
              onChange={(e) => updateUrl(index, e.target.value)}
              placeholder="https://example.com/page"
              className="flex-1 px-3 py-2 border rounded"
            />
            {urls.length > 1 && (
              <button
                type="button"
                onClick={() => removeUrl(index)}
                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded"
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addUrlField}
          className="text-sm text-blue-600 hover:underline"
        >
          + Add another URL
        </button>
      </div>

      {/* Summary Section */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Summary (Markdown)
        </label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="- Updated homepage&#10;- Added new features&#10;- Fixed bugs"
          rows={8}
          className="w-full px-3 py-2 border rounded font-mono text-sm"
        />
        <p className="text-xs text-gray-500 mt-1">
          Use markdown formatting. This will be sent to the client via email.
        </p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Creating Deployment...' : 'Log Deployment'}
      </button>
    </form>
  )
}
```

---

## Viewing Deployments

### API Request

**Endpoint:** `GET https://api.pixelversestudios.io/api/websites/:websiteId/deployments`

**Query Parameters:**
- `limit` (optional) - Number of results (default: 20, max: 100)
- `offset` (optional) - Pagination offset (default: 0)

### TypeScript Implementation

```typescript
interface Deployment {
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

interface DeploymentsResponse {
  website_id: string
  website_title: string
  total: number
  limit: number
  offset: number
  deployments: Deployment[]
}

async function fetchDeployments(
  websiteId: string,
  limit = 20,
  offset = 0
): Promise<DeploymentsResponse> {
  const url = `https://api.pixelversestudios.io/api/websites/${websiteId}/deployments?limit=${limit}&offset=${offset}`

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch deployments: ${response.statusText}`)
  }

  return response.json()
}
```

### Understanding Status

**Deployment Status:**
```typescript
// Open/Pending deployment
deployment.indexed_at === null
// ❌ At least one URL not indexed yet

// Completed deployment
deployment.indexed_at !== null
// ✅ All URLs have been indexed
```

**Per-URL Status:**
```typescript
// Pending URL
url.indexed_at === null
// ❌ Not yet re-indexed in Google Search Console

// Indexed URL
url.indexed_at !== null
// ✅ Re-indexed in Google Search Console
```

### React Example: Deployment List

```tsx
import { useEffect, useState } from 'react'
import { format } from 'date-fns'

interface DeploymentListProps {
  websiteId: string
}

export function DeploymentList({ websiteId }: DeploymentListProps) {
  const [data, setData] = useState<DeploymentsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'open' | 'completed'>('all')

  useEffect(() => {
    loadDeployments()
  }, [websiteId])

  const loadDeployments = async () => {
    setLoading(true)
    try {
      const result = await fetchDeployments(websiteId)
      setData(result)
    } catch (error) {
      console.error('Failed to load deployments:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div>Loading deployments...</div>
  if (!data) return <div>Failed to load deployments</div>

  // Filter deployments
  const filteredDeployments = data.deployments.filter(d => {
    if (filter === 'open') return d.indexed_at === null
    if (filter === 'completed') return d.indexed_at !== null
    return true
  })

  // Count stats
  const stats = {
    total: data.deployments.length,
    open: data.deployments.filter(d => d.indexed_at === null).length,
    completed: data.deployments.filter(d => d.indexed_at !== null).length
  }

  return (
    <div className="space-y-4">
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{data.website_title} Deployments</h2>
        <div className="flex gap-4 text-sm">
          <span>Total: {stats.total}</span>
          <span className="text-orange-600">Open: {stats.open}</span>
          <span className="text-green-600">Completed: {stats.completed}</span>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('open')}
          className={`px-3 py-1 rounded ${filter === 'open' ? 'bg-orange-600 text-white' : 'bg-gray-200'}`}
        >
          🔴 Open ({stats.open})
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`px-3 py-1 rounded ${filter === 'completed' ? 'bg-green-600 text-white' : 'bg-gray-200'}`}
        >
          ✅ Completed ({stats.completed})
        </button>
      </div>

      {/* Deployment Cards */}
      <div className="space-y-4">
        {filteredDeployments.map(deployment => (
          <DeploymentCard
            key={deployment.id}
            deployment={deployment}
            onUpdate={loadDeployments}
          />
        ))}
      </div>
    </div>
  )
}
```

---

## Tracking Indexing Progress

### Option 1: Mark Single URL

**Use when:** User re-indexes URLs one at a time in Google Search Console

**Endpoint:** `PATCH https://api.pixelversestudios.io/api/deployments/:deploymentId/urls/indexed`

**Request Body:**
```typescript
{
  url: string // The URL that was just indexed
}
```

### Option 2: Mark Entire Deployment

**Use when:** User already indexed all URLs and wants to mark complete

**Endpoint:** `PATCH https://api.pixelversestudios.io/api/deployments/:deploymentId/indexed`

**Request Body:** None

### TypeScript Implementation

```typescript
// Mark single URL as indexed
async function markUrlAsIndexed(
  deploymentId: string,
  url: string
): Promise<Deployment> {
  const response = await fetch(
    `https://api.pixelversestudios.io/api/deployments/${deploymentId}/urls/indexed`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url })
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to mark URL as indexed: ${response.statusText}`)
  }

  return response.json()
}

// Mark entire deployment as indexed
async function markDeploymentAsIndexed(
  deploymentId: string
): Promise<Deployment> {
  const response = await fetch(
    `https://api.pixelversestudios.io/api/deployments/${deploymentId}/indexed`,
    {
      method: 'PATCH',
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to mark deployment as indexed: ${response.statusText}`)
  }

  return response.json()
}
```

### React Example: Deployment Card

```tsx
interface DeploymentCardProps {
  deployment: Deployment
  onUpdate: () => void
}

function DeploymentCard({ deployment, onUpdate }: DeploymentCardProps) {
  const [marking, setMarking] = useState<string | null>(null)

  // Calculate progress
  const totalUrls = deployment.changed_urls.length
  const indexedUrls = deployment.changed_urls.filter(u => u.indexed_at !== null).length
  const progressPercent = (indexedUrls / totalUrls) * 100

  // Status
  const isCompleted = deployment.indexed_at !== null
  const statusColor = isCompleted ? 'text-green-600' : 'text-orange-600'
  const statusText = isCompleted ? '✅ Completed' : '🔴 Open'

  // Mark individual URL
  const handleMarkUrl = async (url: string) => {
    setMarking(url)
    try {
      await markUrlAsIndexed(deployment.id, url)
      onUpdate() // Refresh the list
    } catch (error) {
      console.error('Failed to mark URL:', error)
      alert('Failed to mark URL as indexed')
    } finally {
      setMarking(null)
    }
  }

  // Mark entire deployment
  const handleMarkAll = async () => {
    if (!confirm('Mark all URLs as indexed?')) return

    setMarking('all')
    try {
      await markDeploymentAsIndexed(deployment.id)
      onUpdate() // Refresh the list
    } catch (error) {
      console.error('Failed to mark deployment:', error)
      alert('Failed to mark deployment as indexed')
    } finally {
      setMarking(null)
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={`font-semibold ${statusColor}`}>
              {statusText}
            </span>
            <span className="text-sm text-gray-500">
              {format(new Date(deployment.created_at), 'MMM d, yyyy h:mm a')}
            </span>
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {indexedUrls}/{totalUrls} URLs indexed ({progressPercent.toFixed(0)}%)
          </div>
        </div>

        {!isCompleted && (
          <button
            onClick={handleMarkAll}
            disabled={marking !== null}
            className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
          >
            Mark All Indexed
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${
            isCompleted ? 'bg-green-600' : 'bg-orange-500'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Summary */}
      <div className="prose prose-sm max-w-none">
        <div className="text-sm text-gray-700 whitespace-pre-line">
          {deployment.summary}
        </div>
      </div>

      {/* URLs List */}
      <div className="space-y-2">
        <div className="text-sm font-medium">URLs:</div>
        {deployment.changed_urls.map((urlObj, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-2 bg-gray-50 rounded"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-lg">
                {urlObj.indexed_at ? '✅' : '⏳'}
              </span>
              <a
                href={urlObj.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline truncate"
              >
                {urlObj.url}
              </a>
            </div>

            {!urlObj.indexed_at && !isCompleted && (
              <button
                onClick={() => handleMarkUrl(urlObj.url)}
                disabled={marking !== null}
                className="ml-2 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                {marking === urlObj.url ? 'Marking...' : 'Mark Indexed'}
              </button>
            )}

            {urlObj.indexed_at && (
              <span className="ml-2 text-xs text-gray-500">
                {format(new Date(urlObj.indexed_at), 'MMM d, h:mm a')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## Complete UI Examples

### Full Page Component

```tsx
import { useState } from 'react'

interface Website {
  id: string
  title: string
}

export function DeploymentTrackingPage() {
  const [selectedWebsite, setSelectedWebsite] = useState<Website | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [websites] = useState<Website[]>([
    { id: 'b5e2e350-3015-4adc-8ace-7a4598cc14b9', title: 'PixelVerse Studios' },
    { id: '06b4c7ca-e8ef-4d84-8ea8-419d6055848a', title: '360 Degree Care' },
  ])

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Deployment Tracking</h1>

      {/* Website Selector */}
      <div className="flex gap-4 items-center">
        <label className="font-medium">Website:</label>
        <select
          value={selectedWebsite?.id || ''}
          onChange={(e) => {
            const website = websites.find(w => w.id === e.target.value)
            setSelectedWebsite(website || null)
            setShowForm(false)
          }}
          className="px-3 py-2 border rounded"
        >
          <option value="">Select a website...</option>
          {websites.map(website => (
            <option key={website.id} value={website.id}>
              {website.title}
            </option>
          ))}
        </select>

        {selectedWebsite && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="ml-auto px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : '+ Log New Deployment'}
          </button>
        )}
      </div>

      {/* Form or List */}
      {selectedWebsite && (
        <div>
          {showForm ? (
            <DeploymentForm
              websiteId={selectedWebsite.id}
              websiteName={selectedWebsite.title}
              onSuccess={() => {
                setShowForm(false)
                // List will refresh automatically
              }}
            />
          ) : (
            <DeploymentList websiteId={selectedWebsite.id} />
          )}
        </div>
      )}
    </div>
  )
}
```

---

## Filtering & Sorting Examples

```typescript
// Client-side filtering
function filterDeployments(deployments: Deployment[], filter: string) {
  switch (filter) {
    case 'open':
      return deployments.filter(d => d.indexed_at === null)

    case 'completed':
      return deployments.filter(d => d.indexed_at !== null)

    case 'recent':
      return deployments
        .sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        .slice(0, 10)

    default:
      return deployments
  }
}

// Get completion percentage
function getCompletionPercent(deployment: Deployment): number {
  const total = deployment.changed_urls.length
  const indexed = deployment.changed_urls.filter(u => u.indexed_at !== null).length
  return (indexed / total) * 100
}

// Get pending URLs
function getPendingUrls(deployment: Deployment) {
  return deployment.changed_urls.filter(u => u.indexed_at === null)
}

// Sort by completion status
function sortByCompletion(deployments: Deployment[]) {
  return [...deployments].sort((a, b) => {
    const aPercent = getCompletionPercent(a)
    const bPercent = getCompletionPercent(b)
    return aPercent - bPercent
  })
}
```

---

## Summary: UI Checklist

### ✅ Create Deployment Form
- [ ] Website selector
- [ ] URL input (multiple)
- [ ] Markdown summary textarea
- [ ] Validation
- [ ] Success/error handling

### ✅ Deployment List View
- [ ] Fetch deployments for selected website
- [ ] Display status (open/completed)
- [ ] Show progress (X/Y URLs indexed)
- [ ] Filter by status
- [ ] Sort by date

### ✅ Individual URL Tracking
- [ ] Show all URLs in deployment
- [ ] Display indexed status per URL
- [ ] "Mark as Indexed" button per URL
- [ ] Visual indicator (✅ vs ⏳)
- [ ] Timestamp when indexed

### ✅ Bulk Actions
- [ ] "Mark All Indexed" button
- [ ] Confirmation dialog
- [ ] Loading states

### ✅ Polish
- [ ] Progress bars
- [ ] Color coding (red=open, green=complete)
- [ ] Timestamps formatted nicely
- [ ] Responsive design
- [ ] Loading skeletons

---

## API Base URL

**Production:** `https://api.pixelversestudios.io`
**Development:** `http://localhost:5001` (or your local port)

Use environment variables to switch between them:

```typescript
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.pixelversestudios.io'
```

---

## Need Help?

- Review the complete API docs: `DEPLOYMENT_GUIDE_STEP_1.md`, `DEPLOYMENT_GUIDE_STEP_2.md`, `DEPLOYMENT_GUIDE_STEP_3.md`
- Check TypeScript types in the examples above
- Test endpoints with cURL or Postman first
- Server returns detailed error messages for debugging
