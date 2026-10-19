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