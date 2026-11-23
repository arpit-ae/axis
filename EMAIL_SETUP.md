# GOAXIS transactional email and inbound aliases

## Current scope
- Outbound sending domain goaxis.in: verified with Resend, with Cloudflare DNS DKIM, SPF and DMARC monitoring policy.
- Server-side senders: sales@goaxis.in for order confirmations and enquiry@goaxis.in for enquiry alerts. Reply-to support@goaxis.in.
- Incoming mail: Cloudflare Email Routing **enabled, ready and synced**. Five active forwarding rules for contact@, enquiry@, sales@, billing@ and support@ goaxis.in all forward to verified destination goaxis.in@gmail.com. These are forward-only aliases, not independent inboxes.
- Cloudflare has provisioned three root MX records. A test message sent from another connected Gmail account to contact@goaxis.in arrived in the verified GOAXIS Gmail inbox; other aliases have API-confirmed active rules but their individual delivery was not tested.

## Finish automated transactional email
1. In Cloudflare Workers & Pages → axis → Settings → Variables and Secrets, add encrypted secret RESEND_API_KEY, using a goaxis.in scoped Resend sending_access key. Never add the key to HTML, JavaScript assets, repository files or plain text variables.
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
