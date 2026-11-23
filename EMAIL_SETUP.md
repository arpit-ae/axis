# GOAXIS transactional email and inbound aliases

## Current scope
- Outbound sending domain goaxis.in: verified with Resend, with Cloudflare DNS DKIM, SPF and DMARC monitoring policy.
- Server-side senders: sales@goaxis.in for order confirmations and enquiry@goaxis.in for enquiry alerts. Reply-to support@goaxis.in.
- Incoming mail: Cloudflare Email Routing **enabled, ready and synced**. Five active forwarding rules for contact@, enquiry@, sales@, billing@ and support@ goaxis.in all forward to verified destination goaxis.in@gmail.com. These are forward-only aliases, not independent inboxes.
- Cloudflare has provisioned three root MX records. All five aliases were independently tested from another Gmail account and the messages were verified in the GOAXIS Gmail Inbox on 23 Nov 2026.

## Finish automated transactional email
1. Completed: RESEND_API_KEY is installed as a secret_text Worker binding on axis. Never add the key to HTML, public JavaScript, repository files, or plain-text configuration.
2. Confirm both D1 migrations are applied in goaxis-consultancy-db.
3. Deploy Worker source and site static assets from the same GitHub commit. The Cloudflare Worker handles signed Cashfree webhooks and independently checks PAID before sending customer and business notifications.
4. In Cashfree dashboard, ensure notification URL https://goaxis.in/api/cashfree/webhook is registered for successful payments.
5. Test in Cashfree sandbox with a legitimate sandbox transaction and safe test addresses, check webhook delivery, receipt and admin notification, then check duplicate webhooks do not create duplicate messages.
6. Ensure a separate process exists for providing project deliverables and legal/tax invoices. The automatic email is only a payment confirmation, not a GST tax invoice.

## Business catalog (INR)
- Invoice template: ₹500 (package invoice-basic)
- Purchase + sales invoice templates: ₹800 (invoice-purchase-sale)
- Purchase + sales + delivery challan templates: ₹1,000 (invoice-challan)
- 10-page website with first-year agreed domain/hosting and basic enquiry database: ₹2,000 (website-ten-page)
- Existing 5-page starter package: ₹1,000 by separate quotation.

Hosting/domain renewals, paid third-party services, tax requirements, custom integrations, and revisions beyond quoted scope require clear disclosure before taking an order.

## Production code publishing
- GitHub main contains tested website and Worker source, but Cloudflare's current live Worker retains the earlier code and static assets.
- GitHub Actions workflow .github/workflows/deploy-production.yml provides a manual, CI-tested Wrangler deployment of script plus static assets, followed by page checks.
- This requires adding a **GitHub Actions repository secret** named CLOUDFLARE_API_TOKEN with minimum necessary Cloudflare Workers Scripts edit permissions for the verified account. Do not place the token in Git commits or chat.
- Cloudflare's connected API successfully creates Worker versions, but direct static assets upload returns HTTP 401 because the upload endpoint requires a separate upload-session token that the connector cannot pass. Do not assume a GitHub push deployed the site.
