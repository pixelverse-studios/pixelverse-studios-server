# Deployment Tracking - API Documentation

**Complete API reference for the deployment tracking system**

---

## Overview

These guides document all API endpoints for managing deployment records across client websites. Use these to integrate deployment tracking into your dashboard or automation workflows.

**Key Architecture:** Everything is website-scoped following the hierarchy: **Client → Website → Deployments**

---

## The Guides

### **Step 1: Fetch Deployments for a Website**
📄 `DEPLOYMENT_GUIDE_STEP_1.md`

**Endpoint:** `GET /api/websites/:websiteId/deployments`

**What it does:**
- Get all deployments for a specific website
- Supports pagination with limit/offset
- Returns both pending and indexed deployments
- Client-side filtering for pending vs indexed

**Time to read:** 5 minutes

---

### **Step 2: Mark Deployment as Indexed**
📄 `DEPLOYMENT_GUIDE_STEP_2.md`

**Endpoint:** `PATCH /api/deployments/:deploymentId/indexed`

**What it does:**
- Updates deployment with `indexed_at` timestamp
- Marks deployment as complete
- No request body required

**Time to read:** 3 minutes

---

### **Step 3: Create a New Deployment**
📄 `DEPLOYMENT_GUIDE_STEP_3.md`

**Endpoint:** `POST /api/deployments`

**What it does:**
- Creates new deployment record
- Accepts changed URLs and markdown summary
- Sends email notification (if contact_email configured)
- Integrates with GitHub Actions or Netlify webhooks

**Time to read:** 5 minutes

---

### **Step 4: Get All Clients and Websites**
📄 `DEPLOYMENT_GUIDE_STEP_4.md`

**Endpoint:** `GET /api/clients`

**What it does:**
- Returns all clients with nested websites
- Use for dashboard navigation
- Build website lookup for UUIDs → names

**Time to read:** 5 minutes

---

### **Step 5: API Reference Summary**
📄 `DEPLOYMENT_GUIDE_STEP_5.md`

**What it provides:**
- Quick reference for all endpoints
- Complete workflow examples
- Common cURL queries
- Error handling reference

**Time to read:** 10 minutes

---

## Quick Start

1. Start with `DEPLOYMENT_GUIDE_STEP_1.md` to understand fetching deployments
2. Read `DEPLOYMENT_GUIDE_STEP_2.md` for marking deployments as indexed
3. Read `DEPLOYMENT_GUIDE_STEP_3.md` for creating deployments from webhooks
4. Read `DEPLOYMENT_GUIDE_STEP_4.md` for navigation/lookup data
5. Reference `DEPLOYMENT_GUIDE_STEP_5.md` as needed

---

## What You Can Build

After reading all guides, you'll understand how to:
- ✅ Fetch deployment history for any website
- ✅ Mark deployments as indexed after GSC re-indexing
- ✅ Automatically create deployments from CI/CD pipelines
- ✅ Build client/website navigation
- ✅ Display pending vs indexed deployment counts
- ✅ Paginate through deployment history

---

## Complete API Endpoints

**Deployments:**
- `GET /api/websites/:websiteId/deployments` - Get deployment history
- `PATCH /api/deployments/:deploymentId/indexed` - Mark as indexed
- `POST /api/deployments` - Create new deployment

**Clients/Websites:**
- `GET /api/clients` - Get all clients with nested websites

---

## Data Model

### Deployment Object
```json
{
  "id": "uuid",
  "website_id": "uuid",
  "changed_urls": ["https://..."],
  "summary": "- Markdown changes",
  "created_at": "2025-11-24T00:17:37.328336+00:00",
  "indexed_at": "2025-11-24T15:30:45.123456+00:00" // or null
}
```

### Website Object (nested in client)
```json
{
  "id": "uuid",
  "title": "Website Name",
  "domain": "www.example.com",
  "website_slug": "example",
  "type": "Static",
  "client_id": "uuid",
  "contact_email": "contact@example.com"
}
```

---

## Integration Examples

### GitHub Actions
```yaml
- name: Notify Deployment
  run: |
    curl -X POST https://api.pixelversestudios.io/api/deployments \
      -H "Content-Type: application/json" \
      -d '{
        "website_id": "${{ secrets.WEBSITE_ID }}",
        "changed_urls": ["https://example.com/page1"],
        "summary": "- Deployed from ${{ github.sha }}"
      }'
```

### Netlify Function
```javascript
exports.handler = async (event) => {
  await fetch('https://api.pixelversestudios.io/api/deployments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      website_id: process.env.WEBSITE_ID,
      changed_urls: event.body.changed_files,
      summary: `- ${event.body.title}`
    })
  })
}
```

---

## Workflow Overview

```
1. Deployment happens (GitHub/Netlify)
   ↓
2. Webhook creates deployment record (POST /api/deployments)
   ↓
3. Email notification sent to website contact
   ↓
4. Dashboard displays pending deployments (GET /api/websites/:id/deployments)
   ↓
5. User manually re-indexes URLs in Google Search Console
   ↓
6. User marks deployment as indexed (PATCH /api/deployments/:id/indexed)
   ↓
7. Deployment removed from pending list
```

---

## Additional Resources

**Comprehensive Guide:**
📄 `DEPLOYMENT_TRACKING_GUIDE.md`
- Complete API reference
- Advanced examples
- Email notification details

**Architecture Reference:**
📄 `DEPLOYMENT_GUIDE_CORRECTED_FLOW.md`
- Explains website-scoped architecture
- Shows correct vs incorrect approaches

**Backend Documentation:**
📄 `CLAUDE.md`
- Server architecture
- Database schema
- Implementation details

---

## Summary

**Total Reading Time:** 30 minutes

**Result:** Complete understanding of the deployment tracking API to integrate into your dashboard and automation workflows.

**Architecture:** All endpoints follow website-scoped design. Never fetch all deployments system-wide.

**Get Started:** Open `DEPLOYMENT_GUIDE_STEP_1.md` and start reading!

---
