# GOAXIS transactional email and inbound aliases

## Current scope
- Outbound sending domain: goaxis.in, verified with Resend. DKIM, SPF (send.goaxis.in) and rsend CNAME configured in Cloudflare DNS.
- DMARC: _dmarc.goaxis.in starts with p=none for monitoring; review alignment/delivery before enforcing.
- Mail sender addresses: sales@goaxis.in for payment confirmations, enquiry@goaxis.in for enquiry notifications; support@goaxis.in is the reply-to.
- Receiving: Cloudflare Email Routing aliases contact@, enquiry@, sales@, billing@ and support@ exist as **disabled rules**, forwarding to goaxis.in@gmail.com only after that Gmail destination is verified. They are not inboxes and are not live until Cloudflare Email Routing itself and each rule are enabled.

## Finish inbound setup (user verification required)
1. In goaxis.in@gmail.com, open Cloudflare's verification email and approve this forwarding destination.
2. In Cloudflare → goaxis.in → Email → Email Routing, enable Email Routing; confirm Cloudflare provisions the root-domain MX/TXT records and there is no incompatible mail host.
3. Activate the five existing forwarding rules individually; verify from an external sender to contact@goaxis.in and support@goaxis.in.
4. Never claim routing is live while verification is pending. Outbound sending and inbound forwarding are independent.

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
