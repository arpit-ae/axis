# GOAXIS Payments — Cloudflare Worker + Cashfree

The production website is served by the Cloudflare Worker configured in `wrangler.toml`. The Worker creates Cashfree orders, checks order status server-side, and verifies signed Cashfree webhooks. Do not deploy the legacy Netlify functions for this Cloudflare setup.

## Cloudflare production configuration

In Cloudflare Dashboard, open **Workers & Pages → axis → Settings → Variables and Secrets** and select **Production**.

Set these values:

- **Secret** `CASHFREE_APP_ID`: the production App ID from Cashfree.
- **Secret** `CASHFREE_SECRET_KEY`: the matching production Secret Key.
- **Variable** `CASHFREE_ENV`: `production`.
- **Variable** `SITE_URL`: `https://goaxis.in`.

Keep the App ID/Secret Key in Worker secrets, never in HTML, JavaScript, GitHub commits, screenshots or client-side variables. Sandbox credentials must only be used with `CASHFREE_ENV=sandbox` and Cashfree sandbox. Never mix sandbox and production credentials. If a key has been exposed, rotate it in Cashfree and update the Worker secret.

After changing a Worker variable/secret or source file, confirm the new Production Worker version has deployed successfully. Preview variables are separate; do not rely on Preview settings for the live website.

## Cashfree dashboard

1. Complete Cashfree merchant onboarding and production enablement.
2. Confirm production API credentials belong to the production environment.
3. Configure the webhook/notify URL as `https://goaxis.in/api/cashfree/webhook` if the Cashfree dashboard requires manual registration.
4. Test using an actual valid Indian mobile number. The form accepts a 10-digit Indian mobile starting with 6–9, with an optional `+91` prefix; the Worker normalizes it to 10 digits before calling Cashfree.

## Payment routes

- `POST /api/cashfree/create-order`: validates form details and creates the Cashfree order.
- `GET /api/cashfree/order/{order_id}`: retrieves the order from Cashfree for return-page verification.
- `POST /api/cashfree/webhook`: verifies the Cashfree webhook signature.

The return page only displays payment success after a server-side order lookup confirms `PAID`. A browser redirect alone is not proof of payment. If an order is pending, customers should check its status before trying to pay again.

## Troubleshooting

Open **Workers & Pages → axis → Observability → Logs**, select **Production**, then retry once. The Worker logs the Cashfree HTTP status and error code, not the complete Cashfree error body, because provider validation messages can contain customer information.

- `customer_details.customer_phone_invalid`: check the mobile number; it must be a valid 10-digit Indian mobile number starting with 6–9.
- HTTP 400: review the entered name, email, mobile number, purpose and amount.
- HTTP 401/403: check the production App ID/Secret Key pair and merchant production access in the Cashfree dashboard.
- HTTP 5xx: retry after checking the latest Cloudflare log and Cashfree service status.

Never share API keys or the full payment payload when asking for help.
