# Webhook Durability Audit (DEV-701)

**Date:** 2026-04-14
**Trigger:** [DEV-701](https://linear.app/pixelverse-studios/issue/DEV-701) — follow-up to the CMS expansion 504 incident where a client deploy summary was dropped during our deploy window.

## Purpose

For each public-facing webhook endpoint, determine:

1. How does the sender behave on failure? (retries, backoff, give-up)
2. What happens today if the endpoint is down during a deploy window?
3. Is the payload **recoverable** (sender can re-trigger) or **irrecoverable** (one-shot, lost if dropped)?
4. Does it warrant a durable-queue mechanism?

## Endpoints in Scope

### 1. `POST /api/deployments` — client website CI/CD

| Question | Answer |
|---|---|
| Sender | GitHub Actions / Netlify post-deploy scripts in each client repo |
| Retries on failure? | **No.** Fire-and-forget `curl`. No retry, no backoff. |
| Payload regeneration possible? | **No.** Built from the build's diff/changelog at a single point in time; the CI job completes and the build artifact is discarded. |
| Human visibility on failure? | None. Robot-to-robot; only noticed days later when a missing email/record is caught manually. |
| Classification | **Irrecoverable — one-shot.** |
| Durability action | **Implemented.** Payload is inserted into `pending_webhook_events` before any fallible processing runs. In-process poller retries on 1min → 5min → 30min cadence, then marks `failed` and logs. See `src/lib/webhook-processor.ts`, `src/controllers/deployments.ts`. |

### 2. `POST /api/leads/new` — public lead form

| Question | Answer |
|---|---|
| Sender | Browser on `pixelversestudios.io` lead form |
| Retries on failure? | No automatic retry; the form shows an error and the user can click submit again. |
| Payload regeneration possible? | **Yes.** The user still has the form open with their data typed; they resubmit. |
| Human visibility on failure? | The user sees the error immediately. |
| Classification | **Recoverable.** |
| Durability action | **Not needed.** The human in the loop is the durability mechanism. Adding a queue would introduce complexity without addressing an actual data-loss path. |

### 3. `POST /api/contact-forms/*` — client website contact forms

| Question | Answer |
|---|---|
| Sender | Browser on various client websites |
| Retries on failure? | No automatic retry. Same UX pattern as leads form. |
| Payload regeneration possible? | **Yes.** User has the form in front of them. |
| Human visibility on failure? | User sees an inline error. |
| Classification | **Recoverable.** |
| Durability action | **Not needed.** Same rationale as leads. |

### 4. `POST /api/audit-requests` — public audit form

| Question | Answer |
|---|---|
| Sender | Browser on `pixelversestudios.io` audit request form |
| Retries on failure? | No automatic retry. |
| Payload regeneration possible? | **Yes.** User still has the form. |
| Human visibility on failure? | User sees an inline error. |
| Classification | **Recoverable.** |
| Durability action | **Not needed.** Same rationale as leads. |

### 5. `POST /api/calendly-webhook` — Calendly booking notifications

| Question | Answer |
|---|---|
| Sender | Calendly's webhook service |
| Retries on failure? | **Yes.** Calendly retries failed webhook deliveries on its own schedule (multiple attempts over several hours per Calendly's public docs). |
| Payload regeneration possible? | The booking data remains in Calendly; the webhook itself is also redelivered. |
| Human visibility on failure? | Calendly exposes webhook delivery logs in their dashboard. |
| Classification | **Recoverable.** |
| Durability action | **Not needed.** Calendly's own retry mechanism covers the deploy-window risk. |

## Summary

| Endpoint | Payload | Durability Added |
|---|---|---|
| `POST /api/deployments` | irrecoverable | ✅ yes — `pending_webhook_events` + in-process poller |
| `POST /api/leads/new` | recoverable (user re-submits) | ❌ not needed |
| `POST /api/contact-forms/*` | recoverable (user re-submits) | ❌ not needed |
| `POST /api/audit-requests` | recoverable (user re-submits) | ❌ not needed |
| `POST /api/calendly-webhook` | recoverable (Calendly retries) | ❌ not needed |

Only one endpoint in the audit scope has a genuine irrecoverable-payload risk. Durability is implemented for that endpoint; justifications are recorded for the rest.
