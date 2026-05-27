# Media Admin Auth Contract

DEV-935 adds lightweight magic-link auth for the Iffer's Pictures media manager.
Permanent R2 credentials stay server-side; future media endpoints should protect
admin mutations with `requireMediaAdminSession`.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `MEDIA_ADMIN_EMAILS` | yes | Comma-separated approved admin email addresses. |
| `MEDIA_ADMIN_APP_BASE_URL` | yes | Frontend base URL used in magic-link emails. |
| `MEDIA_ADMIN_MAGIC_LINK_TTL_MINUTES` | no | Magic-link expiry window. Defaults to `15`. |
| `MEDIA_ADMIN_SESSION_TTL_HOURS` | no | Session cookie lifetime. Defaults to `12`. |
| `MEDIA_ADMIN_REQUEST_MIN_RESPONSE_MS` | no | Minimum magic-link request duration to reduce email approval probing. Defaults to `350`. |
| `GMAIL_USER` | yes | Sender account for Nodemailer. |
| `GMAIL_APP_PASSWORD` | yes | Gmail app password for Nodemailer. |

## Routes

### Request Magic Link

`POST /api/media-admin/auth/magic-link`

```json
{
  "email": "jenn@example.com"
}
```

Returns `200` for approved and unapproved emails so approval status is not
leaked through the response. Persistence or email-send failures are logged
server-side and still return the same generic response.

```json
{
  "message": "If that email is approved, a sign-in link has been sent."
}
```

### Complete Sign-In

The emailed URL points to:

`{MEDIA_ADMIN_APP_BASE_URL}/admin/media/auth/callback?token=...`

The Next.js callback page should read the `token` query param and exchange it:

`POST /api/media-admin/auth/callback`

```json
{
  "token": "one-time-token-from-email"
}
```

On success, the API sets the HTTP-only `pvs_media_admin_session` cookie.

```json
{
  "email": "jenn@example.com",
  "expiresAt": "2026-05-27T12:00:00.000Z"
}
```

Important failure states:

| Status | Meaning |
| --- | --- |
| `400` | Invalid payload. |
| `401` | Invalid sign-in link. |
| `403` | Email is no longer approved. |
| `410` | Link expired or was already used. |
| `500` | Unexpected callback/session persistence failure. |

### Current Session

`GET /api/media-admin/auth/session`

Requires the `pvs_media_admin_session` cookie. Returns `401` when missing or
expired and `403` when the session email is no longer approved.

```json
{
  "email": "jenn@example.com",
  "expiresAt": "2026-05-27T12:00:00.000Z"
}
```

### Logout

`POST /api/media-admin/auth/logout`

Revokes the stored session hash when a session cookie is present and always
clears the browser cookie, including already-expired or already-revoked
sessions.

```json
{
  "message": "Logged out"
}
```

## Frontend Notes

Use `credentials: "include"` when calling session-protected endpoints from the
browser. If the API is not same-origin with the Next.js app, deploy behind a
same-origin rewrite/proxy or configure CORS and cookie policy explicitly before
turning on cross-origin browser access.
