# GOAXIS CONSULTANCY

Static business website and Cloudflare Worker API for GOAXIS CONSULTANCY. The production hostname is `https://goaxis.in`. The repo is designed for Cloudflare Workers static assets, with a D1 database for enquiries and Cashfree for hosted online checkout, and Resend for authenticated transactional email.

## Architecture

- `index.html`, `services.html`, `service.html`, `website-builder.html`: public service pages and enquiry forms.
- `pay-now.html`, `payment.js`: payment form and Cashfree hosted checkout launch.
- `payment-return.html`: server-verified payment result page.
- `src/index.js`: Cloudflare Worker API and static asset fallback.
- `forms.js`, `experience.js`, `app.js`, `part2.js`: secure Send enquiry, liquid-glass motion, navigation and service-page behavior.
- `migrations/0001_phase1_enquiries.sql`: D1 `Leads` table.
- `migrations/0002_payment_notifications.sql`: D1 paid-order notification deduplication.
- `src/email.js`: payment-verified Resend confirmations and lead notifications.
- `premium.css`, `documents.html`, `faq.html`: premium design and documented fixed-price packages.
- `wrangler.toml`: Worker, static asset routing and D1 binding.
- `.assetsignore`: prevents internal source/prototype/legacy files from being uploaded as public assets.

## Production setup

In **Cloudflare Dashboard → Workers & Pages → axis → Settings → Variables and Secrets**, select **Production** and configure:

- Secret: `CASHFREE_APP_ID` (production App ID)
- Secret: `CASHFREE_SECRET_KEY` (matching production Secret Key)
- Secret: `RESEND_API_KEY` (restricted **sending_access** key for verified `goaxis.in` Resend domain)
- Variable: `CASHFREE_ENV=production`
- Variable: `SITE_URL=https://goaxis.in`

The Worker also requires the D1 database binding named `DB`, targeting `goaxis-consultancy-db`. Confirm that both D1 migrations have been applied in the intended database before relying on enquiry storage. Never commit secret values. See [EMAIL_SETUP.md](EMAIL_SETUP.md) for forwarding verification and email setup, and [PAYMENT_SETUP.md](PAYMENT_SETUP.md) for the production payment checklist.

## API routes

- `POST /api/enquiry`: validates and stores a lead in D1.
- `POST /api/cashfree/create-order`: validates details and creates a Cashfree order.
- `GET /api/cashfree/order/{order_id}`: obtains order status directly from Cashfree.
- `POST /api/cashfree/webhook`: verifies Cashfree webhook signatures, independently checks the order is paid and sends deduplicated payment emails.

The Indian payment form accepts a 10-digit mobile number starting with 6–9; an optional `+91` prefix is normalized server-side. Payment success is displayed only after a server-side Cashfree lookup returns `PAID`. A return URL or browser message alone is not sufficient.

## Deployment and checks

The Cloudflare deployment should publish both the Worker and allowed static assets as one version. After a change is merged/pushed, confirm that the Production deployment succeeded in Cloudflare before testing `goaxis.in`.

Run the syntax checks locally with Node.js:

```sh
node --check app.js
node --check forms.js
node --check part2.js
node --check payment.js
node --check experience.js
node --check src/index.js
node --check src/email.js
node --check cf-launch.js
node --check admin.js
```

CI also checks core file syntax and important route/asset wiring. Test the enquiry form and verify its reference in D1; test Cashfree in sandbox before enabling production payments.

## Access and limitations

- `admin.html`, `admin.js`, `dashboard.html`, `login.html` and `signup.html` are prototypes, not a real authenticated customer/admin portal; the Worker intentionally does not publish them.
- The legacy `netlify/functions/` code is not used by the Cloudflare Worker deployment and is excluded from public assets.
- No card number, CVV, OTP or UPI PIN should be collected by GOAXIS forms.
- Review service scope and policy text whenever pricing, data handling, delivery periods or third-party providers change.

## November 2026 Business Starter Suite update
- ₹2,000 includes the agreed starter 10-page website, purchase and sales invoice features, delivery challan tools, simple owner controls and two-sided email enquiries. The demo at `business-suite-demo.html` is browser-only; client systems are customized by scope.
- Contact forms use Send and `POST /api/enquiry`, not a messaging-app button. Server-side Resend sends two separate emails using verified `contact@goaxis.in`: admin lead to `goaxis.in@gmail.com` and acknowledgment to customer, with a truthful `email_sent` field.
- Security: honeypot, same-origin checks, D1 Leads per-recipient throttling, HTML escaping and idempotent Resend sends.
- Cloudflare Workers Builds is linked to GitHub `main` and deploys automatically; optional `.github/workflows/deploy-production.yml` remains manual and requires its separate `CLOUDFLARE_API_TOKEN` repository secret if used. Do not assume the optional manual workflow is configured.
