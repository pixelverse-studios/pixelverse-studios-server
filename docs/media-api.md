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
| `media.invalid_aspect_ratio` | Aspect ratio is not allowed. |
| `media.invalid_status` | Status is not `draft`, `published`, or `archived`. |
| `media.missing_alt_text` | Publish attempted without alt text. |
| `media.missing_service` | Publish attempted without service. |
| `media.missing_sub_category` | Publish attempted without sub-category. |
| `media.missing_aspect_ratio` | Publish attempted without aspect ratio. |
| `media.duplicate_key` | Catalog already has an item with the key. |
| `media.destination_collision` | Catalog or R2 already has the destination key. |
| `media.published_location_locked` | Published object location cannot be changed by generic patch/move. |
| `media.archived_locked` | Archived item must be restored before metadata/object edits. |
| `media.r2_not_configured` | R2 bucket/base URL or credentials are missing. |
| `media.website_not_found` | Website slug was not found. |
| `media.not_found` | Media item was not found for the website. |
| `media.revalidation_failed` | Frontend revalidation webhook returned a failure or timed out. |

## Public Catalog

`GET /api/media/:websiteSlug/catalog`

Returns published items only. Draft and archived items are excluded.
Admin-only timestamps/archive metadata are excluded.

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

Response headers include `Cache-Control: no-store`.

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
  "expires_at": "2026-05-31T12:15:00.000Z"
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
  "service": null,
  "subCategory": null,
  "aspectRatio": null,
  "sortOrder": 0
}
```

Only `key` is required. The server derives `filename` from `key`, `src` from the
configured public base URL, and stores `status: "draft"` when omitted.

## Update Metadata, Publish, Archive, Restore, Reorder

`PATCH /api/media/:websiteSlug/admin/items/:id`

Protected. Accepts any subset of:

```json
{
  "alt": "Mother-to-be opening gifts at baby shower",
  "service": "Events",
  "subCategory": "Baby Shower",
  "aspectRatio": "portrait",
  "sortOrder": 12,
  "status": "published"
}
```

Publish requirements:

- `alt` must be non-empty.
- `service` is required.
- `subCategory` is required and must match `service`.
- `aspectRatio` is required.

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

Webhook failures during automatic revalidation are logged and do not roll back
the completed catalog mutation.

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
| `MEDIA_MAX_UPLOAD_BYTES` | no | Max upload size. Defaults to 10 MB. |
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
3. Create a draft catalog item with `key: r2_key` and `src: public_url`.
4. Let Jenn fill alt/category/aspect metadata.
5. Publish with `status: "published"` after required metadata is present.

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
