# Media Manager API Contract

This server owns the protected media catalog and R2 operations for Iffer's
Pictures. Admin endpoints require the HTTP-only media admin session cookie from
`/api/media-admin/auth/*`; browser calls should use `credentials: "include"`.

## Public Catalog

`GET /api/media/:websiteSlug/catalog`

Returns published media only. Draft and archived items are excluded, and
archive/admin timestamps are not included.

The response is cacheable with:

`Cache-Control: public, max-age=60, stale-while-revalidate=300`

Those values can be overridden with
`MEDIA_PUBLIC_CATALOG_MAX_AGE_SECONDS` and
`MEDIA_PUBLIC_CATALOG_STALE_WHILE_REVALIDATE_SECONDS`.

## Admin Revalidation

`POST /api/media/:websiteSlug/admin/revalidate`

Protected by `requireMediaAdminSession`. Use this after an admin action if the
frontend needs an explicit refresh button or retry path.

Request body:

```json
{
  "reason": "manual",
  "media_id": 123,
  "media_key": "events/baby-shower/baby.jpg"
}
```

`reason` is optional and defaults to `manual`. Allowed values:

- `manual`
- `published`
- `archived`
- `restored`
- `metadata_edited`
- `reorder_changed`
- `renamed_moved`

Response when `MEDIA_REVALIDATION_WEBHOOK_URL` is configured:

```json
{
  "configured": true,
  "triggered": true,
  "skipped": false,
  "reason": "manual",
  "website_slug": "iffers-pictures",
  "affected_paths": [
    "/",
    "/portfolio",
    "/services",
    "/services/events",
    "/services/family",
    "/services/maternity",
    "/services/couples-engagement",
    "/services/portrait",
    "/investment",
    "/faq"
  ],
  "triggered_at": "2026-05-31T12:00:00.000Z",
  "status": 200
}
```

Response when no webhook is configured:

```json
{
  "configured": false,
  "triggered": false,
  "skipped": true,
  "reason": "manual",
  "website_slug": "iffers-pictures",
  "affected_paths": ["/", "/portfolio"],
  "triggered_at": "2026-05-31T12:00:00.000Z"
}
```

The full `affected_paths` list is always returned by the API; the shortened
example above only shows the response shape.

## Automatic Revalidation

The server also triggers the same webhook in the background after catalog
mutations that affect public output:

- publishing a draft
- archiving published media
- restoring media to published
- editing published alt text, category, or aspect ratio
- changing published sort order

Webhook delivery is non-blocking for these mutations. If the frontend webhook
fails, the mutation still succeeds and the server logs the failure.

## Frontend Webhook

Configure:

| Variable | Purpose |
| --- | --- |
| `MEDIA_REVALIDATION_WEBHOOK_URL` | Next.js route handler URL that revalidates public pages. |
| `MEDIA_REVALIDATION_SECRET` | Optional bearer token sent as `Authorization: Bearer ...`. |
| `MEDIA_REVALIDATION_TIMEOUT_MS` | Optional webhook timeout. Defaults to `5000`. |

The webhook receives:

```json
{
  "website_slug": "iffers-pictures",
  "reason": "published",
  "affected_paths": ["/", "/portfolio"],
  "media_id": 123,
  "media_key": "events/baby-shower/baby.jpg",
  "actor": "jenn@example.com",
  "triggered_at": "2026-05-31T12:00:00.000Z"
}
```

The Next.js app should validate the bearer token when configured, call
`revalidatePath` for each `affected_paths` entry, and return a 2xx response.
