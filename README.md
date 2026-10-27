# GOAXIS CONSULTANCY — Phase 1 Working Forms

Repository: `arpit-ae/axis`. The public site is served as static assets by a Cloudflare Worker; Phase 1 adds a Worker API route at `POST /api/enquiry` and a D1 `Leads` table.

## Files added
- `src/index.js`: Worker API plus static asset fallback.
- `forms.js`: sends the homepage and service quotation forms to the API.
- `migrations/0001_phase1_enquiries.sql`: creates the enquiry table and indexes.
- `wrangler.toml`: Worker asset and D1 binding configuration.

## Safety before production
- Confirm this Wrangler config targets the intended Cloudflare account and existing `goaxis` Worker.
- Confirm the D1 database ID in Cloudflare before applying migrations.
- Apply the D1 migration only after checking existing migration/table state.
- Preview-test the homepage and service forms, and verify their records in D1.
- Review and complete the Privacy Policy and Terms before collecting real customer information.
- The customer login/signup and admin pages remain prototypes; this phase does not implement secure authentication, admin access, payments or a customer dashboard.
- Do not run a production deploy until the binding and migration have been verified.

## Suggested local checks
```sh
node --check app.js
node --check forms.js
node --check part2.js
node --check src/index.js
```

Production uses Cloudflare Worker static assets. The API handles `/api/*`; other requests are passed to the existing static asset service.
## Phase 2: Customer and admin login

- `src/auth.js`: signup, login, logout, session (`/api/auth/*`), customer enquiries (`/api/my/enquiries`) and admin APIs (`/api/admin/*`).
- `migrations/0002_auth.sql`: `Users`, `Sessions`, `LoginAttempts` tables and `Leads.admin_note`.
- `login.html` (login + create account), `dashboard.html` (customer), `admin.html` (admin), `portal.js`, `portal.css`.
- Passwords are PBKDF2-SHA256 hashed; sessions are HttpOnly, Secure, SameSite=Lax cookies; 10 failed logins per IP per 15 minutes are blocked.

### Deploy steps

```
npx wrangler d1 migrations apply goaxis-consultancy-db --remote
npx wrangler secret put ADMIN_EMAIL      # e.g. goaxis.in@gmail.com
npx wrangler secret put ADMIN_PASSWORD   # long, unique password
npx wrangler deploy
```

Customers see enquiries that were sent with the same email as their account. Email verification is not added yet.
