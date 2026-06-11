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
| `MEDIA_ADMIN_MAGIC_LINK_REQUEST_COOLDOWN_SECONDS` | no | Cooldown for suppressing duplicate sends for a recently issued unused link while returning the generic public response. Defaults to `60`. |
| `MEDIA_ADMIN_MAGIC_LINK_RATE_LIMIT_SECONDS` | no | Optional email-level request rate limit. Defaults to `0` disabled. |
| `MEDIA_ADMIN_MAGIC_LINK_CLOCK_SKEW_SECONDS` | no | Grace window for callback expiry checks. Defaults to `120`. |
| `MEDIA_ADMIN_SESSION_TTL_HOURS` | no | Session cookie lifetime. Defaults to `12`. |
| `MEDIA_ADMIN_REQUEST_MIN_RESPONSE_MS` | no | Minimum magic-link request duration to reduce email approval probing. Defaults to `350`. |
| `MEDIA_ADMIN_COOKIE_DOMAIN` | no | Optional session cookie domain for cross-subdomain deployments. |
| `MEDIA_ADMIN_COOKIE_SAME_SITE` | no | Optional `lax`, `strict`, or `none`; defaults to `lax`. `none` forces `Secure`. |
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

Returns `200` for approved and unapproved emails without revealing approval
status. Approved emails are persisted and sent before the success response is
returned. Unapproved emails, already-pending links, rate-limited requests, and
transient send/persistence failures receive the same public `sent` shape. Those
internal outcomes are recorded in server logs with request IDs.

```json
{
  "ok": true,
  "status": "sent",
  "message": "If that email is approved, a sign-in link has been sent."
}
```

Invalid payloads return a stable error envelope:

| Status | Code |
| --- | --- |
| `400` | `media_admin_auth.invalid_payload` |

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
  "ok": true,
  "status": "authenticated",
  "email": "jenn@example.com",
  "expiresAt": "2026-05-27T12:00:00.000Z"
}
```

Important failure states:

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `media_admin_auth.invalid_payload` | Invalid payload. |
| `401` | `media_admin_auth.invalid_token` | Invalid sign-in link. |
| `403` | `media_admin_auth.unapproved_email` | Email is no longer approved. |
| `410` | `media_admin_auth.expired_token` | Link expired outside the configured skew window. |
| `410` | `media_admin_auth.reused_token` | Link was already used or lost the one-time claim race. |
| `503` | `media_admin_auth.session_creation_failed` | The token was claimed but session persistence failed. |

### Current Session

`GET /api/media-admin/auth/session`

Requires the `pvs_media_admin_session` cookie. Returns `401` when missing or
expired and `403` when the session email is no longer approved.

```json
{
  "ok": true,
  "status": "authenticated",
  "email": "jenn@example.com",
  "expiresAt": "2026-05-27T12:00:00.000Z"
}
```

Session failures return `media_admin_auth.session_required`,
`media_admin_auth.session_expired`, or `media_admin_auth.unapproved_email`.

## Error Envelope

Auth failures use this shape:

```json
{
  "ok": false,
  "error": {
    "code": "media_admin_auth.invalid_token",
    "message": "Invalid sign-in link.",
    "requestId": "req_123"
  }
}
```

`requestId` is either the inbound `x-request-id` header or a generated UUID.
Logs include request ID, email, link/session ids, lifecycle event, and duration,
but never raw callback tokens or session cookie values.

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
