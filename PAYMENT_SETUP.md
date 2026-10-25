# GOAXIS Cashfree Payment Setup

The site now has a separate **Pay Now** button, a customer amount form, Cashfree hosted checkout, server-side order creation/status verification, and a signed webhook endpoint.

## Netlify environment variables

Add these in the deployed site's environment variables (never put the secret in HTML/JS):

- `CASHFREE_APP_ID` = Cashfree App ID
- `CASHFREE_SECRET_KEY` = Cashfree Secret Key
- `CASHFREE_ENV` = `sandbox` for testing, then `production` for live payments
- `SITE_URL` = `https://goaxis.in` (or the exact deployed HTTPS domain)

Redeploy after changing environment variables.

## Cashfree dashboard

1. Create/complete the Cashfree merchant account and required KYC/bank onboarding.
2. Start with Sandbox credentials and test UPI/cards/payment status.
3. Configure the webhook/notify URL as:
   `https://goaxis.in/api/cashfree/webhook`
4. Use production credentials only after the sandbox flow is verified.

## Important

The Cashfree secret key must stay server-side. The browser receives only the payment session ID needed to open Cashfree Checkout. Payment status is checked server-side before the return page marks a payment as successful.
