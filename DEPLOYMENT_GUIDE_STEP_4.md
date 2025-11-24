# Step 4: Get All Clients and Websites

**Goal:** Fetch all clients with their nested websites for building navigation/dashboard.

---

## Endpoint

```
GET /api/clients
```

**Base URL:** `https://api.pixelversestudios.io`

**Query Parameters:** None

---

## Example Request

```
GET /api/clients
```

---

## Response

### Success (200 OK)

```json
[
  {
    "id": "client-uuid-1",
    "firstname": "PixelVerse",
    "lastname": "Studios",
    "email": null,
    "phone": null,
    "websites": [
      {
        "id": "b5e2e350-3015-4adc-8ace-7a4598cc14b9",
        "title": "PixelVerse Studios",
        "domain": "www.pixelversestudios.io",
        "website_slug": "pvs",
        "type": "Static",
        "client_id": "client-uuid-1",
        "contact_email": "contact@pixelversestudios.io"
      }
    ]
  },
  {
    "id": "client-uuid-2",
    "firstname": "Kyle",
    "lastname": "Jones",
    "email": "kyle@example.com",
    "phone": "+1234567890",
    "websites": [
      {
        "id": "website-uuid-2",
        "title": "Client Website 1",
        "domain": "example.com",
        "website_slug": "example",
        "type": "CMS",
        "client_id": "client-uuid-2",
        "contact_email": "admin@example.com"
      },
      {
        "id": "website-uuid-3",
        "title": "Client Website 2",
        "domain": "example2.com",
        "website_slug": "example2",
        "type": "Static",
        "client_id": "client-uuid-2",
        "contact_email": null
      }
    ]
  }
]
```

### Empty Result (200 OK)

```json
[]
```

---

## Response Fields

### Client Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID of the client |
| `firstname` | string | Client first name |
| `lastname` | string | Client last name |
| `email` | string \| null | Client email (optional) |
| `phone` | string \| null | Client phone (optional) |
| `websites` | array | Array of website objects for this client |

### Website Object (nested in client)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID of the website |
| `title` | string | Website title/name |
| `domain` | string | Website domain (e.g., "www.example.com") |
| `website_slug` | string | URL-friendly slug |
| `type` | string | "Static" or "CMS" |
| `client_id` | string | UUID of the parent client |
| `contact_email` | string \| null | Email for deployment notifications (optional) |

---

## Use Cases

### Building Website Lookup

Use this endpoint to create a mapping of `website_id` → website details:

```javascript
const response = await fetch('https://api.pixelversestudios.io/api/clients')
const clients = await response.json()

const websiteLookup = {}
clients.forEach(client => {
  if (client.websites) {
    client.websites.forEach(website => {
      websiteLookup[website.id] = {
        ...website,
        client: {
          firstname: client.firstname,
          lastname: client.lastname,
          id: client.id
        }
      }
    })
  }
})

// Now you can look up website details:
const website = websiteLookup['b5e2e350-3015-4adc-8ace-7a4598cc14b9']
console.log(website.title) // "PixelVerse Studios"
console.log(website.client.firstname) // "PixelVerse"
```

### Dashboard Navigation

Use this to build a hierarchical dashboard:

1. Show list of clients
2. Under each client, show their websites
3. Click a website to view its deployments (Step 1)

---

## cURL Examples

### Basic request
```bash
curl https://api.pixelversestudios.io/api/clients
```

### With pretty print
```bash
curl https://api.pixelversestudios.io/api/clients | jq
```

### Filter to specific client by name
```bash
curl https://api.pixelversestudios.io/api/clients | jq '.[] | select(.firstname == "PixelVerse")'
```

### Get all website IDs
```bash
curl https://api.pixelversestudios.io/api/clients | jq '[.[].websites[].id]'
```

---

## Dashboard Workflow

### Full Navigation Flow

1. **Fetch all clients and websites**
   `GET /api/clients`

2. **User clicks on a website**
   Navigate to website detail view

3. **Fetch deployments for that website**
   `GET /api/websites/{websiteId}/deployments` (Step 1)

4. **Display deployment history**
   Show pending and indexed deployments

5. **User marks deployment as indexed**
   `PATCH /api/deployments/{deploymentId}/indexed` (Step 2)

---

## Example Dashboard Structure

```
Clients Dashboard
├─ PixelVerse Studios
│  └─ PixelVerse Studios (www.pixelversestudios.io)
│     [View Deployments] → Fetches deployments for this website
│
├─ Kyle Jones
│  ├─ Client Website 1 (example.com)
│  │  [View Deployments]
│  └─ Client Website 2 (example2.com)
│     [View Deployments]
```

---

## Performance Notes

- This endpoint returns all clients and their websites in one request
- Response is typically fast since it's a simple join query
- Consider caching this data client-side for 5-10 minutes
- Client/website data doesn't change frequently

---

## Next Steps

- Use website IDs from this response to fetch deployments (Step 1)
- Build client/website navigation in your dashboard
- Create website lookup for displaying names instead of UUIDs
