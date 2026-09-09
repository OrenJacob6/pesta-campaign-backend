# Pesta Campaigns — Webflow Cloud Backend

Minimal Astro backend for the Property Communication Audit flow.

## Production routes

When the Webflow Cloud environment is mounted at `/backend`:

- `GET /backend/api/health`
- `POST /backend/api/lead-lookup`
- `POST /backend/api/delete-old-submissions`

## Required Webflow Cloud environment variables

Create both as **Secret** variables:

### `WEBFLOW_API_TOKEN`

Use a **Pesta Campaigns site token** with **Forms: Read & Write** access.
It is required to list and delete form submissions.

### `CLEANUP_SECRET`

Use a long random secret (32+ random bytes / 64+ hex characters recommended).

Example generation locally:

```bash
openssl rand -hex 32
```

Do not put either value in browser JavaScript or commit them to GitHub.

## Why the cleanup token exists

The public browser never receives permission to delete arbitrary Webflow
submission IDs.

`lead-lookup` finds existing records and returns a short-lived, HMAC-signed
`cleanup_token`. Only the server can create a valid token.

After BOTH new native Webflow form submissions succeed, the browser sends that
signed token to `delete-old-submissions`. The server verifies it, then deletes
only the old submission IDs that were captured before the new records existed.

## Stable `lead_id`

- Existing email: preserves the newest existing `lead_id`.
- New email: generates a new UUID.
- Historical duplicate records with the same email are all included in cleanup,
  so they can be removed after the replacement submissions succeed.

## Webflow IDs used

Site:

`6aa16b2ba4e8d6c33da5a1bc`

Lead Details form element:

`f2ad309f-cf9c-50fc-bc33-1459e82c1c64`

Property Communication Audit form element:

`e07072da-0ad9-f6af-08e4-401b7dca2c3a`

The backend intentionally uses `formElementId` instead of a domain-specific
`formId`, so lookups work across the custom domain and Webflow subdomain.

## Setup

1. Push this repository to GitHub.
2. In **Pesta Campaigns → Site settings → Webflow Cloud**:
   - New project → Create app
   - Connect this GitHub repository
3. Create the production environment:
   - Branch: `main`
   - Mount path: `/backend`
4. Add the two Secret environment variables.
5. Push a commit to `main` to deploy.
6. Verify:
   - `/backend/api/health` returns `{"ok":true}`.
7. Then connect the Webflow page JavaScript to the two POST routes.
