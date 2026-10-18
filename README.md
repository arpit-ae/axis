# GOAXIS CONSULTANCY — Cloudflare Pages static deployment

This repository is configured as a **static frontend** for Cloudflare Pages. It does not include a production backend, secure authentication, enquiry storage, admin API, or verified payment processing.

## Cloudflare Pages settings
- Connect GitHub repository: `arpit-ae/axis`
- Production branch: `main`
- Framework preset: `None`
- Build command: leave blank (or `exit 0` if the dashboard requires a command)
- Build output directory: `/` (repository root; in Cloudflare's UI use `.` if accepted)
- Root directory: leave blank

Cloudflare Pages will rebuild automatically when commits land on `main`. Do **not** use `npx wrangler deploy` for this static Pages site; that command targets Workers. If deploying from CLI, use `npx wrangler pages deploy . --project-name=goaxis-consultancy --branch=main` after authenticating Wrangler and confirming the Pages project name.

## Before accepting real customers/payments
- Replace placeholder contact details and review draft Terms/Privacy pages.
- Build and configure a server-side API for enquiry submissions, customer accounts and admin access.
- Configure verified payment-gateway webhooks; never trust a browser return URL as proof of payment.
- Add Cloudflare Pages Functions/Workers and configure D1/R2 bindings and secrets only when backend code is ready.
- Do not treat the demo login/signup pages as secure authentication.

The enquiry forms are preview-only and do not transmit or save personal information. The admin page is only a shell and must not be used for real operations.
