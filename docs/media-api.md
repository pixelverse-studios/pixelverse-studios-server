# Media Manager API Contract

This document is the frontend integration contract for the Iffer's Pictures
media manager. The API owns durable catalog records, protected R2 object
operations, and cache revalidation. Permanent R2 credentials stay server-side.

Use `websiteSlug = "iffers-pictures"` for Iffer's Pictures.

Admin endpoints require the HTTP-only media admin session cookie from
`/api/media-admin/auth/*`. Browser calls to admin routes must use
`credentials: "include"`.

## Data Model

Catalog responses use the frontend-compatible media catalog shape:

```json
{
  "version": 1,
  "publicBaseUrl": "https://pub.example.r2.dev",
  "bucket": "iffers-pictures",
  "items": [
    {
      "id": 123,
      "key": "events/baby-shower/baby-shower-15.jpg",
      "filename": "baby-shower-15.jpg",
      "src": "https://pub.example.r2.dev/events/baby-shower/baby-shower-15.jpg",
      "alt": "Mother-to-be opening gifts at baby shower",
      "library": "portfolio",
      "siteCategory": null,
      "service": "Events",
      "subCategory": "Baby Shower",
      "aspectRatio": "portrait",
      "status": "published",
      "sortOrder": 0
    }
  ]
}
```

Admin catalog responses also include:

```json
{
  "createdAt": "2026-05-31T12:00:00.000Z",
  "updatedAt": "2026-05-31T12:30:00.000Z",
  "archivedAt": null,
  "archivedBy": null,
  "archivedFromStatus": null
}
```

Allowed values:

| Field | Values |
| --- | --- |
| `status` | `draft`, `published`, `archived` |
| `library` | `portfolio`, `site` |
| `siteCategory` | `Home`, `About`, `Brand`, `Misc` |
| `aspectRatio` | `portrait`, `landscape`, `square`, `video` |
| `service` | `Events`, `Family`, `Maternity`, `Couples`, `Portrait` |

Allowed sub-categories:

| Service | Sub-categories |
| --- | --- |
| `Events` | `Baby Shower`, `Bridal Shower`, `Gender Reveal`, `Birthday`, `Baptism` |
| `Family` | `Family` |
| `Maternity` | `Maternity` |
| `Couples` | `Engagement`, `Proposal` |
| `Portrait` | `Portrait` |

## Error Shape

Media endpoints return structured media errors when validation or expected
operational failures occur:

```json
{
  "error": {
    "code": "media.destination_collision",
    "message": "An image already exists at that destination.",
    "details": {
      "field": "destination_key",
      "key": "events/baby-shower/baby.jpg"
    }
  }
}
```

Common codes:

| Code | Meaning |
| --- | --- |
| `media.invalid_payload` | Request body failed route/controller validation. |
| `media.invalid_content_type` | Upload content type is not allowed. |
| `media.file_too_large` | Upload exceeds `MEDIA_MAX_UPLOAD_BYTES`. |
| `media.invalid_service` | Service is not one of the allowed values. |
| `media.invalid_sub_category` | Sub-category is missing/invalid for the service. |
| `media.invalid_library` | Library is not `portfolio` or `site`. |
| `media.invalid_site_category` | Site category is not one of the allowed values. |
| `media.invalid_aspect_ratio` | Aspect ratio is not allowed. |
| `media.invalid_status` | Status is not `draft`, `published`, or `archived`. |
| `media.missing_alt_text` | Publish attempted without alt text. |
| `media.missing_service` | Publish attempted without service. |
| `media.missing_sub_category` | Publish attempted without sub-category. |
| `media.missing_site_category` | Publish attempted on site media without site category. |
| `media.missing_aspect_ratio` | Publish attempted without aspect ratio. |
| `media.duplicate_key` | Catalog already has an item with the key. |
| `media.destination_collision` | Catalog or R2 already has the destination key. |
| `media.published_location_locked` | Published object location cannot be changed by generic patch/move. |
| `media.archived_locked` | Archived item must be restored before metadata/object edits. |
| `media.invalid_placement_slot` | Placement slot key is not allowed for the website. |
| `media.unpublished_assignment_forbidden` | Draft media cannot be assigned to a placement. |
| `media.archived_assignment_forbidden` | Archived media cannot be assigned to a placement. |
| `media.r2_not_configured` | R2 bucket/base URL or credentials are missing. |
| `media.website_not_found` | Website slug was not found. |
| `media.not_found` | Media item was not found for the website. |
| `media.revalidation_failed` | Frontend revalidation webhook returned a failure or timed out. |

## Public Catalog

`GET /api/media/:websiteSlug/catalog`

Returns published portfolio items only. Draft, archived, and `library: "site"`
items are excluded. Admin-only timestamps/archive metadata are excluded.

Default response header:

`Cache-Control: public, max-age=60, stale-while-revalidate=300`

Server overrides:

| Variable | Default |
| --- | --- |
| `MEDIA_PUBLIC_CATALOG_MAX_AGE_SECONDS` | `60` |
| `MEDIA_PUBLIC_CATALOG_STALE_WHILE_REVALIDATE_SECONDS` | `300` |

Frontend use:

```ts
const res = await fetch(`${apiBase}/api/media/iffers-pictures/catalog`, {
  next: { revalidate: 60 },
});
const catalog = await res.json();
```

## Public Placements

`GET /api/media/:websiteSlug/placements`

Returns explicit frontend placement assignments whose assigned media item is
`published`. Draft and archived media are excluded from the public response.

Response headers match the public catalog:

`Cache-Control: public, max-age=60, stale-while-revalidate=300`

Response:

```json
{
  "version": 1,
  "publicBaseUrl": "https://media.ifferspictures.com",
  "placements": [
    {
      "slotKey": "home.hero",
      "media": {
        "id": 123,
        "key": "events/baby-shower/baby-shower-01.jpg",
        "filename": "baby-shower-01.jpg",
        "src": "https://media.ifferspictures.com/events/baby-shower/baby-shower-01.jpg",
        "alt": "Mother-to-be opening gifts at baby shower",
        "library": "portfolio",
        "siteCategory": null,
        "service": "Events",
        "subCategory": "Baby Shower",
        "aspectRatio": "portrait",
        "status": "published"
      }
    }
  ]
}
```

## Admin Auth

Auth details live in `docs/media-admin-auth.md`. The frontend flow is:

1. Request link: `POST /api/media-admin/auth/magic-link`
2. Exchange token: `POST /api/media-admin/auth/callback`
3. Check session: `GET /api/media-admin/auth/session`
4. Logout: `POST /api/media-admin/auth/logout`

All admin media calls require the session cookie:

```ts
await fetch(`${apiBase}/api/media/iffers-pictures/admin/catalog`, {
  credentials: "include",
});
```

## Admin Catalog

`GET /api/media/:websiteSlug/admin/catalog`

Returns draft, published, and archived items with admin metadata. Protected.
This endpoint includes both `portfolio` and `site` library items.

Response headers include `Cache-Control: no-store`.

## Admin Placements

`GET /api/media/:websiteSlug/admin/placements`

Protected. Returns every allowed placement slot for the website, with current
assignment state when a slot has an assigned media item.

Response headers include `Cache-Control: no-store`.

The Iffer's Pictures registry includes the Inquire page image slot:

```json
{
  "slotKey": "inquire.what_happens_next",
  "pageLabel": "Inquire",
  "sectionLabel": "What Happens Next",
  "description": "Image used beside the What Happens Next steps on the inquire page.",
  "expectedAspectRatios": ["landscape", "portrait"],
  "affectedPaths": ["/inquire"],
  "assignment": null
}
```

`assignment` is `null` until a published media item is assigned through the
same placement mutation endpoint used by homepage slots.

```json
{
  "version": 1,
  "publicBaseUrl": "https://media.ifferspictures.com",
  "slots": [
    {
      "slotKey": "home.hero",
      "pageLabel": "Home",
      "sectionLabel": "Hero",
      "description": "Primary homepage hero image.",
      "expectedAspectRatios": ["landscape", "portrait"],
      "affectedPaths": ["/"],
      "assignment": {
        "id": 10,
        "updatedBy": "jenn@example.com",
        "createdAt": "2026-06-06T12:00:00.000Z",
        "updatedAt": "2026-06-06T12:30:00.000Z",
        "media": {
          "id": 123,
          "key": "events/baby-shower/baby-shower-01.jpg",
          "filename": "baby-shower-01.jpg",
          "src": "https://media.ifferspictures.com/events/baby-shower/baby-shower-01.jpg",
          "alt": "Mother-to-be opening gifts at baby shower",
          "library": "portfolio",
          "siteCategory": null,
          "service": "Events",
          "subCategory": "Baby Shower",
          "aspectRatio": "portrait",
          "status": "published"
        }
      }
    }
  ]
}
```

`PUT /api/media/:websiteSlug/admin/placements/:slotKey`

Protected. Assigns or replaces the media item for a placement slot. Only
published media can be assigned. Draft and archived media are rejected.
Successful assignment or replacement writes a non-blocking audit log and
triggers targeted frontend revalidation for the slot's `affectedPaths`.

Request:

```json
{
  "media_id": 123
}
```

`DELETE /api/media/:websiteSlug/admin/placements/:slotKey`

Protected. Clears a placement assignment by deleting the assignment row.
Successful clears write a non-blocking audit log with the old placement state
and trigger targeted frontend revalidation for the slot's `affectedPaths`.

Response:

```json
{
  "cleared": true,
  "slotKey": "home.hero"
}
```

## Presigned Upload

`POST /api/media/:websiteSlug/admin/uploads/presign`

Protected. Creates a short-lived direct-upload URL for R2. Uploads default to
draft only after the frontend creates the catalog item.

Request:

```json
{
  "filename": "baby-shower-15.jpg",
  "content_type": "image/jpeg",
  "folder": "events/baby-shower",
  "size": 1234567
}
```

Allowed content types:

- `image/jpeg`
- `image/png`
- `image/webp`

Response:

```json
{
  "presigned_url": "https://...",
  "public_url": "https://pub.example.r2.dev/events/baby-shower/1712345678-baby-shower-15.jpg",
  "r2_key": "events/baby-shower/1712345678-baby-shower-15.jpg",
  "expires_at": "2026-05-31T12:15:00.000Z",
  "request_id": "1d462f43-2d43-4a5a-94c5-3be6b1279d1c"
}
```

Upload the file directly to `presigned_url` with the exact `Content-Type` and
`Content-Length` used for presign.

## Create Draft Catalog Item

`POST /api/media/:websiteSlug/admin/items`

Protected. Call this after the R2 PUT succeeds.

Request:

```json
{
  "key": "events/baby-shower/1712345678-baby-shower-15.jpg",
  "filename": "baby-shower-15.jpg",
  "src": "https://pub.example.r2.dev/events/baby-shower/1712345678-baby-shower-15.jpg",
  "alt": "",
  "library": "portfolio",
  "siteCategory": null,
  "service": null,
  "subCategory": null,
  "aspectRatio": null,
  "sortOrder": 0
}
```

Only `key` is required. The server derives `filename` from `key`, `src` from the
configured public base URL, stores `status: "draft"` when omitted, and defaults
missing `library` to `"portfolio"`.

Site image draft example:

```json
{
  "key": "site/about/jenn-portrait.jpg",
  "library": "site",
  "siteCategory": "About",
  "alt": "",
  "aspectRatio": null
}
```

Site images use the same bucket and public base URL. Recommended folders are
`site/home/`, `site/about/`, `site/brand/`, and `site/misc/`.

## Complete Uploaded Drafts In Batch

`POST /api/media/:websiteSlug/admin/items/batch`

Protected. Call this after one or more direct R2 PUTs succeed when the frontend
wants one response that preserves per-file partial success and failure state.
The endpoint creates catalog draft records sequentially and does not roll back
successful files when a later file fails.

Request:

```json
{
  "items": [
    {
      "key": "events/baby-shower/1712345678-baby-shower-15.jpg",
      "filename": "baby-shower-15.jpg",
      "src": "https://pub.example.r2.dev/events/baby-shower/1712345678-baby-shower-15.jpg",
      "alt": "",
      "library": "portfolio",
      "service": null,
      "subCategory": null,
      "aspectRatio": null,
      "sortOrder": 0
    }
  ]
}
```

Response when every draft is created:

```json
{
  "request_id": "1d462f43-2d43-4a5a-94c5-3be6b1279d1c",
  "status": "completed",
  "items": [
    {
      "index": 0,
      "key": "events/baby-shower/1712345678-baby-shower-15.jpg",
      "ok": true,
      "item": {
        "id": 123,
        "key": "events/baby-shower/1712345678-baby-shower-15.jpg",
        "status": "draft"
      }
    }
  ],
  "summary": {
    "requested": 1,
    "succeeded": 1,
    "failed": 0
  }
}
```

Response when some files fail uses HTTP `207` and preserves created drafts:

```json
{
  "request_id": "1d462f43-2d43-4a5a-94c5-3be6b1279d1c",
  "status": "partial_success",
  "items": [
    {
      "index": 0,
      "key": "events/baby-shower/one.jpg",
      "ok": true,
      "item": {
        "id": 123,
        "key": "events/baby-shower/one.jpg",
        "status": "draft"
      }
    },
    {
      "index": 1,
      "key": "events/baby-shower/two.jpg",
      "ok": false,
      "error": {
        "status": 503,
        "code": "media.upload_temporary_unavailable",
        "message": "Media storage is temporarily busy. Retry this upload shortly.",
        "retryable": true
      }
    }
  ],
  "summary": {
    "requested": 2,
    "succeeded": 1,
    "failed": 1
  }
}
```

## Update Metadata, Publish, Archive, Restore, Reorder

`PATCH /api/media/:websiteSlug/admin/items/:id`

Protected. Accepts any subset of:

```json
{
  "alt": "Mother-to-be opening gifts at baby shower",
  "library": "portfolio",
  "siteCategory": null,
  "service": "Events",
  "subCategory": "Baby Shower",
  "aspectRatio": "portrait",
  "sortOrder": 12,
  "status": "published"
}
```

Portfolio publish requirements:

- `alt` must be non-empty.
- `service` is required.
- `subCategory` is required and must match `service`.
- `aspectRatio` is required.

Site publish requirements:

- `alt` must be non-empty.
- `siteCategory` is required.
- `aspectRatio` is required.
- `service` and `subCategory` are not required and are stored as `null`.

Archive:

```json
{
  "status": "archived"
}
```

Archive preserves `archivedAt`, `archivedBy`, and `archivedFromStatus`.

Restore:

```json
{
  "status": "draft"
}
```

When `archivedFromStatus` exists, restore returns the item to that prior status
instead of the submitted non-archived status. Restore archived items first, then
send a separate metadata edit.

Published location safety:

- Generic patch cannot change `key`, `filename`, or `src` for published media.
- The dedicated object move route also blocks published media.
- Draft media can be renamed/moved safely through the move route.

## List R2 Objects

`GET /api/media/:websiteSlug/admin/objects?prefix=events/baby-shower`

Protected. Lists up to 1000 R2 objects for the configured bucket/prefix.

Response:

```json
{
  "bucket": "iffers-pictures",
  "prefix": "events/baby-shower",
  "objects": [
    {
      "key": "events/baby-shower/baby.jpg",
      "public_url": "https://pub.example.r2.dev/events/baby-shower/baby.jpg",
      "size": 123456,
      "last_modified": "2026-05-31T12:00:00.000Z",
      "etag": "abc123"
    }
  ]
}
```

Response headers include `Cache-Control: no-store`.

## Check Destination

`POST /api/media/:websiteSlug/admin/objects/check-destination`

Protected. Use before displaying a move/rename confirmation.

Request:

```json
{
  "destination_key": "events/baby-shower/new-name.jpg",
  "exclude_media_id": 123
}
```

Response:

```json
{
  "destination_key": "events/baby-shower/new-name.jpg",
  "catalog_exists": false,
  "r2_exists": false,
  "available": true
}
```

## Move Or Rename Draft Object

`POST /api/media/:websiteSlug/admin/items/:id/move`

Protected. Copies the R2 object to the destination key, updates the catalog
record, then deletes the source object. The operation refuses to overwrite by
default.

Request:

```json
{
  "destination_key": "events/baby-shower/new-name.jpg"
}
```

Response:

```json
{
  "item": {
    "id": 123,
    "key": "events/baby-shower/new-name.jpg",
    "filename": "new-name.jpg",
    "src": "https://pub.example.r2.dev/events/baby-shower/new-name.jpg",
    "alt": "",
    "library": "portfolio",
    "siteCategory": null,
    "service": null,
    "subCategory": null,
    "aspectRatio": null,
    "status": "draft",
    "sortOrder": 0,
    "createdAt": "2026-05-31T12:00:00.000Z",
    "updatedAt": "2026-05-31T12:30:00.000Z",
    "archivedAt": null,
    "archivedBy": null,
    "archivedFromStatus": null
  },
  "source_key": "events/baby-shower/old-name.jpg",
  "destination_key": "events/baby-shower/new-name.jpg",
  "source_deleted": true
}
```

If `source_deleted` is `false`, the catalog move succeeded but the old R2 object
cleanup failed. Surface that to an operator instead of retrying blindly.

## Revalidation

`POST /api/media/:websiteSlug/admin/revalidate`

Protected. Use this for an explicit admin refresh/retry action.

Request:

```json
{
  "reason": "manual",
  "media_id": 123,
  "media_key": "events/baby-shower/baby.jpg"
}
```

`reason` defaults to `manual`. Allowed values:

- `manual`
- `published`
- `archived`
- `restored`
- `metadata_edited`
- `reorder_changed`
- `renamed_moved`
- `placement_assigned`
- `placement_replaced`
- `placement_cleared`

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
  "triggered_at": "2026-05-31T12:00:00.000Z"
}
```

Automatic non-blocking revalidation runs after catalog mutations that affect
public output:

- publishing a draft
- archiving published media
- restoring media to published
- editing published alt text, category, or aspect ratio
- changing published sort order

Automatic non-blocking revalidation also runs after placement mutations. Catalog
mutations use the full media-heavy path list. Placement mutations use the
targeted `affectedPaths` from the backend slot registry, for example
`home.* -> ["/"]`, `about.hero -> ["/about"]`, and
`services.events.hero -> ["/services/events"]`.

Webhook failures during automatic revalidation are logged and do not roll back
the completed catalog or placement mutation.

Placement assignment, replacement, and clearing also write non-blocking
`media_audit_logs` rows with actions `placement_assigned`,
`placement_replaced`, and `placement_cleared`. The audit payload stores previous
and new placement state in `old_values` and `new_values`, including `slotKey`,
`mediaId`, `mediaKey`, `src`, filename, metadata, and actor context where
available.

## Frontend Revalidation Webhook

Configure the API server:

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
  "media_id": 123,
  "media_key": "events/baby-shower/baby.jpg",
  "actor": "jenn@example.com",
  "triggered_at": "2026-05-31T12:00:00.000Z"
}
```

The Next.js route handler should:

1. Validate `Authorization: Bearer ${MEDIA_REVALIDATION_SECRET}` when configured.
2. Ignore payloads for unknown `website_slug` values.
3. Call `revalidatePath` for every `affected_paths` entry.
4. Return a 2xx response only after paths are queued/revalidated.

## Environment

Server runtime:

| Variable | Required | Purpose |
| --- | --- | --- |
| `R2_ACCESS_KEY_ID` | yes | Server-only Cloudflare R2 access key. |
| `R2_SECRET_ACCESS_KEY` | yes | Server-only Cloudflare R2 secret key. |
| `R2_ACCOUNT_ID` | yes | Cloudflare account id for the S3-compatible endpoint. |
| `R2_BUCKET_NAME` | fallback | Fallback bucket when no per-client config exists. |
| `R2_PUBLIC_BASE_URL` | fallback | Fallback public object base URL. |
| `R2_PRESIGN_EXPIRES_SECONDS` | no | Presign expiry. Defaults to `900`. |
| `R2_CONNECTION_TIMEOUT_MS` | no | R2 S3 connection timeout. Defaults to `2000`. |
| `R2_REQUEST_TIMEOUT_MS` | no | R2 S3 request timeout. Defaults to `8000`. |
| `MEDIA_MAX_UPLOAD_BYTES` | no | Max upload size. Defaults to 10 MB. |
| `MEDIA_UPLOAD_BATCH_MAX_ITEMS` | no | Max batch draft-completion items. Defaults to `10`. |
| `MEDIA_REVALIDATION_WEBHOOK_URL` | no | Frontend revalidation webhook. |
| `MEDIA_REVALIDATION_SECRET` | no | Optional webhook bearer token. |
| `MEDIA_REVALIDATION_TIMEOUT_MS` | no | Webhook timeout. Defaults to `5000`. |
| `MEDIA_PUBLIC_CATALOG_MAX_AGE_SECONDS` | no | Public catalog max-age. Defaults to `60`. |
| `MEDIA_PUBLIC_CATALOG_STALE_WHILE_REVALIDATE_SECONDS` | no | Public catalog stale window. Defaults to `300`. |

Per-client/per-website R2 config is read from `media_r2_configs` before the
fallback env values:

```json
{
  "bucket": "iffers-pictures",
  "public_base_url": "https://pub.example.r2.dev",
  "key_prefix": ""
}
```

## Suggested Frontend Flows

Upload:

1. Request a presigned URL.
2. PUT the file directly to R2 with the returned URL.
3. Create a draft catalog item with `key: r2_key` and `src: public_url`, or call
   batch draft completion after several direct PUTs succeed.
4. Let Jenn fill alt/category/aspect metadata.
5. Publish with `status: "published"` after required metadata is present.

Upload-related retryable server error codes:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `media.upload_timeout` | `504` | R2/provider operation timed out. Retry the affected file. |
| `media.upload_temporary_unavailable` | `503` | R2/provider reported temporary pressure or rate limiting. Retry after a short delay. |
| `media.upload_provider_error` | `502` | R2/provider failed without a more specific timeout/busy signal. Retryable. |
| `media.upload_catalog_create_failed` | `500` | The object may be in R2, but the draft catalog row failed. Refresh catalog and retry draft completion for that file. |

Rename or move draft media:

1. Check destination.
2. Call move endpoint.
3. Refresh admin catalog.

Archive published media:

1. PATCH `status: "archived"`.
2. Server removes it from public catalog output.
3. Server triggers non-blocking public cache revalidation when configured.

Restore media:

1. PATCH any non-archived status, usually `status: "draft"`.
2. Server restores to `archivedFromStatus` when present.
3. Send a second PATCH for metadata edits if needed.
