# GOAXIS transactional email and inbound aliases

## Current scope
- Outbound sending domain goaxis.in: verified with Resend, with Cloudflare DNS DKIM, SPF and DMARC monitoring policy.
- Server-side senders: sales@goaxis.in for verified order confirmations and contact@goaxis.in for both admin and customer contact-form emails. Customer can reply to contact@goaxis.in. Sales receipts use support@goaxis.in as reply-to.
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
- 10-page business starter suite with first-year agreed domain/hosting, sales/purchase invoice features, delivery challan and owner-ready controls: ₹2,000 (website-ten-page)
- Existing 5-page starter package: ₹1,000 by separate quotation.

Hosting/domain renewals, paid third-party services, tax requirements, custom integrations, and revisions beyond quoted scope require clear disclosure before taking an order.

## Production code publishing
- On 23 Nov 2026 Cloudflare recorded an updated Wrangler production deployment of axis (version 4c7ad6a6-1c6b-477c-bbe7-2f38d53c8716). Its live Worker source was confirmed to include verified-payment Resend notifications and fixed-price package code. Browser Rendering verified that the homepage includes new pricing and that documents.html displays the invoice packages.
- GitHub Actions workflow .github/workflows/deploy-production.yml provides a manual, CI-tested Wrangler deployment of script plus static assets, followed by page checks.
- This requires adding a **GitHub Actions repository secret** named CLOUDFLARE_API_TOKEN with minimum necessary Cloudflare Workers Scripts edit permissions for the verified account. Do not place the token in Git commits or chat.
- GitHub merge alone does not deploy Worker assets. A separate Wrangler deployment did occur and was confirmed through Cloudflare Workers deployment metadata. Future deployments can use the manual GitHub Actions workflow with a scoped token.

- A direct Resend email from sales@goaxis.in to the business Gmail inbox was delivered successfully. Full payment-triggered email remains unverified with an actual Cashfree sandbox payment; no real payment was charged for testing.

## Live double-email form verification (2026-11-24 IST)
- Completed one live POST to /api/enquiry via GitHub Actions using a test-labelled contact form. The Worker responded email_sent=true for reference ENQ-2026-DB10F7AB30.
- Both Resend messages were independently found in GOAXIS Gmail Inbox: an admin lead to goaxis.in@gmail.com and customer acknowledgement to goaxis.in+contact-form-test@gmail.com, both from contact@goaxis.in.
- The domain sender was also independently confirmed by a Resend-to-Gmail delivery test.
- Production is automatically deployed by Cloudflare Workers Builds connected to GitHub main. The optional manual GitHub Actions deploy workflow lacks CLOUDFLARE_API_TOKEN and should not be used until a scoped secret is added.
