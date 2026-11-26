import { OWNER, enquiryMessages, notifyVerifiedPayment, readCashfreeOrder, sendPaidReceipt } from "./email.js";
import { deliverReceipt, retryMail } from "./mail-queue.js";
import { packages, orderLines } from "../catalog.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

import { orbitBilling } from "./orbit-billing.js";

export default {
  async scheduled(_event, env) { await retryMail(env); },
  async fetch(request, env) {
    const url = new URL(request.url);

    // Cashfree approves goaxis.in as the checkout origin. Canonicalise public
    // www page visits before the form can create an order from another origin.
    if (url.hostname.toLowerCase() === "www.goaxis.in" && !url.pathname.startsWith("/api/")) {
      url.hostname = "goaxis.in";
      return Response.redirect(url.toString(), 308);
    }

    if (url.pathname.startsWith("/api/orbit/")) return orbitBilling(request, env, url);

    if (url.pathname === "/api/enquiry") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405, { Allow: "POST" });
      }
      return handleEnquiry(request, env, url);
    }

    if (url.pathname === "/api/cashfree/create-order") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405, { Allow: "POST" });
      }
      return handleCashfreeCreateOrder(request, env, url);
    }

    if (url.pathname.startsWith("/api/cashfree/order/")) {
      if (request.method !== "GET") {
        return json({ ok: false, error: "Method not allowed." }, 405, { Allow: "GET" });
      }
      const orderId = decodeURIComponent(url.pathname.slice("/api/cashfree/order/".length));
      return handleCashfreeOrderStatus(orderId, env, request.headers.get("X-Receipt-Token"));
    }

    if (url.pathname === "/api/cashfree/webhook") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405, { Allow: "POST" });
      }
      return handleCashfreeWebhook(request, env);
    }

    // Do not publish deployment configuration, migrations, or Worker source files.
    if (
      url.pathname === "/README.md" ||
      url.pathname === "/PAYMENT_SETUP.md" ||
      url.pathname === "/EMAIL_SETUP.md" ||
      url.pathname.startsWith("/tests/") ||
      url.pathname === "/wrangler.toml" ||
      url.pathname.startsWith("/src/") ||
      url.pathname.startsWith("/migrations/") ||
      url.pathname.startsWith("/.github/") ||
      url.pathname.startsWith("/netlify/") ||
      ["/admin.html", "/admin.js", "/dashboard.html", "/login.html", "/signup.html"].includes(url.pathname)
    ) {
      return new Response("Not found", { status: 404 });
    }

    // Serve the existing static website without changing its routes.
    return env.ASSETS.fetch(request);
  }
};

async function handleEnquiry(request, env, url) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) {
    return json({ ok: false, error: "Cross-origin requests are not accepted." }, 403);
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ ok: false, error: "Send the enquiry as JSON." }, 415);
  }

  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 12000) return json({ ok: false, error: "Enquiry is too large." }, 413);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ ok: false, error: "Invalid enquiry." }, 400);
  }
  if (String(data.website || "").trim()) {
    return json({ ok: true, reference: "ENQ-RECEIVED" });
  }

  const name = clean(data.name, 100);
  const email = clean(data.email, 254).toLowerCase();
  const phone = clean(data.phone, 25);
  const service = clean(data.service, 150);
  const businessName = clean(data.businessName, 150);
  const businessType = clean(data.businessType, 100);
  const message = clean(data.message, 3000);
  const consent = data.consent === true;

  if (name.length < 2) return json({ ok: false, error: "Please enter your full name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Please enter a valid email address." }, 400);
  }
  if (phone && !/^[+0-9() .-]{7,25}$/.test(phone)) {
    return json({ ok: false, error: "Please enter a valid phone number." }, 400);
  }
  if (!service) return json({ ok: false, error: "Please choose a service." }, 400);
  if (message.length < 5) return json({ ok: false, error: "Please describe your requirement." }, 400);
  if (!consent) return json({ ok: false, error: "Please agree to the enquiry privacy notice." }, 400);
  if (!env.DB) return json({ ok: false, error: "Enquiry storage is not configured yet. Please try again later." }, 503);

  const requestId = data.request_id ?? crypto.randomUUID();
  if (typeof requestId !== "string" || !uuid.test(requestId)) return json({ ok: false, error: "Invalid enquiry request. Reload the form." }, 400);
  const reference = "ENQ-" + new Date().getUTCFullYear() + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14).toUpperCase();
  const lead = { requestId, reference, name, email, phone, service, businessName, businessType, message };
  try {
    // The lead, rate limit and both email jobs commit together, including on simultaneous submissions.
    const insert = env.DB.prepare(`INSERT INTO Leads
      (reference, name, email, phone, service, business_name, business_type, message, request_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE
        (SELECT count(*) FROM Leads WHERE email=? AND created_at>=datetime('now','-15 minutes'))<3
      ON CONFLICT(request_id) DO NOTHING`).bind(reference, name, email, phone || null, service, businessName || null, businessType || null, message, requestId, email);
    await env.DB.batch([insert, ...enquiryMessages(env.DB, lead)]);
    const existing = await env.DB.prepare("SELECT * FROM Leads WHERE request_id=?").bind(requestId).first();
    if (!existing) return json({ ok: false, error: "Too many recent enquiries for this email. Please try again in 15 minutes." }, 429);
    if (existing.email !== email || existing.name !== name || existing.service !== service || existing.message !== message ||
        (existing.phone || "") !== phone || (existing.business_name || "") !== businessName || (existing.business_type || "") !== businessType) {
      return json({ ok: false, error: "The reviewed enquiry has changed. Open a new review." }, 409);
    }
    const delivery = await deliverReceipt(env, existing.reference);
    return json({ ok: true, reference: existing.reference, delivery, owner_email: OWNER,
      email_sent: delivery.owner === "sent" && delivery.customer === "sent" });
  } catch (error) {
    console.error("GOAXIS enquiry service unavailable", String(error));
    return json({ ok: false, error: "We could not confirm your enquiry yet. Please retry using the same form." }, 503);
  }
}

async function handleCashfreeCreateOrder(request, env, url) {
  const pickup = !!env.CANTEEN_GATEWAY_SECRET && timingSafeEqual(request.headers.get("X-Canteen-Gateway") || "", env.CANTEEN_GATEWAY_SECRET);
  if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) {
    return json({ ok: false, error: "Cashfree production credentials are not configured in Cloudflare yet." }, 503);
  }

  const origin = request.headers.get("Origin");
  const siteUrl = String(env.SITE_URL || url.origin).replace(/\/$/, "");
  if (origin && origin !== url.origin && origin !== siteUrl) {
    return json({ ok: false, error: "Cross-origin requests are not accepted." }, 403);
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ ok: false, error: "Send payment details as JSON." }, 415);
  }
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 12000) return json({ ok: false, error: "Payment request is too large." }, 413);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid payment request." }, 400);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ ok: false, error: "Invalid payment request." }, 400);
  }

  const name = clean(data.name, 100);
  const email = clean(data.email, 254).toLowerCase();
  const suppliedPhone = clean(data.phone, 30);
  let phone = suppliedPhone.replace(/\D/g, "");
  // Accept either a 10-digit Indian mobile or the same number prefixed by country code 91.
  if (phone.length === 12 && phone.startsWith("91")) phone = phone.slice(2);
  const ids = data.package_ids ?? (data.package_id ? [data.package_id] : []);
  if (!Array.isArray(ids) || ids.length > Object.keys(packages).length || new Set(ids).size !== ids.length ||
      ids.some(id => typeof id !== "string" || !Object.hasOwn(packages, id))) {
    return json({ ok: false, error: "One of the selected packages is unavailable." }, 400);
  }
  const items = orderLines(ids, clean(data.purpose, 200), Number(data.amount));
  const purpose = items.map(item => item.title).join(" + ");
  const amount = items.reduce((total, item) => total + item.price * item.quantity, 0);

  if (name.length < 2) return json({ ok: false, error: "Please enter your full name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ ok: false, error: "Please enter a valid email address." }, 400);
  if ((!pickup || phone) && !/^[6-9]\d{9}$/.test(phone)) return json({ ok: false, code: "PHONE_REQUIRED", error: "Enter a valid 10-digit Indian mobile number." }, 400);
  if (!purpose) return json({ ok: false, error: "Please enter the payment purpose." }, 400);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
    return json({ ok: false, error: "Payment amount must be between ₹1 and ₹10,00,000." }, 400);
  }

  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) {
    return json({ ok: false, error: "Use at most two decimal places for the amount." }, 400);
  }
  const rawAddress = data.address || {};
  const address = {};
  for (const [key, max] of Object.entries({ line1: 160, line2: 160, city: 80, state: 80, postal: 16, country: 80 })) {
    address[key] = clean(rawAddress[key], max);
    if (String(rawAddress[key] ?? "").trim().length > max) return json({ ok: false, error: "A delivery address field is too long." }, 400);
  }
  if (!pickup && (address.line1.length < 3 || address.city.length < 2 || address.state.length < 2 || address.country.length < 2 ||
      !/^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$/.test(address.postal) ||
      (/^(India|IN)$/i.test(address.country) && !/^[1-9]\d{5}$/.test(address.postal)))) {
    return json({ ok: false, error: "Enter the delivery street, city, state, country and a valid postal code." }, 400);
  }
  const requestId = data.request_id ?? crypto.randomUUID();
  if (typeof requestId !== "string" || !uuid.test(requestId)) return json({ ok: false, error: "Invalid checkout request. Reload checkout." }, 400);
  const checkout = JSON.stringify({ name, email, phone, items, total: amount, address });
  if (!env.DB) return json({ ok: false, error: "Checkout storage is temporarily unavailable." }, 503);
  let saved;
  try {
    const id = "GOAXIS_" + crypto.randomUUID().replace(/-/g, "").toUpperCase();
    await env.DB.prepare(`INSERT INTO CheckoutOrders(order_id,request_id,checkout,receipt_token)
      VALUES(?,?,?,?) ON CONFLICT(request_id) DO NOTHING`).bind(id, requestId, checkout, crypto.randomUUID()).run();
    saved = await env.DB.prepare("SELECT * FROM CheckoutOrders WHERE request_id=?").bind(requestId).first();
  } catch {
    return json({ ok: false, error: "Could not save your checkout. Please retry." }, 503);
  }
  if (!saved || saved.checkout !== checkout) return json({ ok: false, error: "The reviewed order has changed. Review it again." }, 409);
  const orderId = saved.order_id;
  const environment = String(env.CASHFREE_ENV || "production").toLowerCase() === "sandbox" ? "sandbox" : "production";
  const endpoint = environment === "sandbox" ? "https://sandbox.cashfree.com/pg/orders" : "https://api.cashfree.com/pg/orders";
  const apiVersion = "2025-01-01";

  const resultFor = session => json({ ok: true, order_id: orderId, receipt_token: saved.receipt_token,
    payment_session_id: session, environment, total: amount, items });
  if (saved.payment_session_id) {
    try {
      const current = await readCashfreeOrder(env, orderId);
      if (current.order_status === "PAID") return json({ ok: true, paid: true, order_id: orderId, receipt_token: saved.receipt_token });
      if (current.order_status !== "ACTIVE") return json({ ok: false, code: "ORDER_CLOSED", error: "This payment session is closed. Review the order again to start a new session." }, 409);
      return resultFor(saved.payment_session_id);
    } catch {
      return json({ ok: false, error: "Cannot check the existing payment session. Please retry." }, 503);
    }
  }

  const payload = {
    order_id: orderId,
    order_amount: Number(amount.toFixed(2)),
    order_currency: "INR",
    customer_details: {
      customer_id: "CUST_" + orderId.slice(7),
      customer_name: name,
      customer_email: email,
      ...(phone ? {customer_phone: `+91${phone}`} : {})
    },
    order_note: purpose.slice(0, 200),
    order_meta: {
      return_url: pickup ? `${siteUrl}/canteen/orders` : `${siteUrl}/payment-return.html?order_id={order_id}#receipt=${saved.receipt_token}`,
      notify_url: `${siteUrl}/api/cashfree/webhook`
    }
  };

  try {
    const response = await cashfreeFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": apiVersion,
        "x-client-id": env.CASHFREE_APP_ID,
        "x-client-secret": env.CASHFREE_SECRET_KEY,
        "x-idempotency-key": requestId
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.payment_session_id || result.order_id !== orderId) {
      // Never log the full Cashfree response: validation messages can contain customer phone/email data.
      const code = typeof result?.code === "string" ? result.code.slice(0, 120) : "missing_payment_session_id";
      console.error("Cashfree create order failed", { httpStatus: response.status, code });
      if (pickup && !phone && response.status === 400 && /phone/i.test(code+" "+String(result.message||""))) {
        return json({ok:false,code:"PHONE_REQUIRED",error:"Cashfree requires your mobile number for this transaction."},400);
      }
      if (code === "customer_details.customer_phone_invalid") {
        return json({ ok: false, error: "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9. You may include +91." }, 400);
      }
      if (response.status === 400) {
        return json({ ok: false, error: "Cashfree rejected the payment details. Check the name, mobile number, email and amount, then try again." }, 400);
      }
      if (response.status === 401 || response.status === 403) {
        return json({ ok: false, error: "The payment service could not authorize this request. Please contact GOAXIS support." }, 502);
      }
      return json({ ok: false, error: "The payment service could not create an order. Please try again in a moment. No payment was taken." }, 502);
    }

    await env.DB.prepare("UPDATE CheckoutOrders SET payment_session_id=? WHERE order_id=?").bind(result.payment_session_id, orderId).run();
    return resultFor(result.payment_session_id);
  } catch (error) {
    console.error("Cashfree create order request failed", error);
    return json({ ok: false, error: "Payment service is temporarily unavailable. Please try again." }, 502);
  }
}

async function handleCashfreeOrderStatus(orderId, env, token) {
  if (!/^GOAXIS_[A-Z0-9_]{1,64}$/.test(orderId)) return json({ ok: false, error: "Invalid order ID." }, 400);
  if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY || !env.DB) return json({ ok: false, error: "Payment verification unavailable." }, 503);
  try {
    const verified = await readCashfreeOrder(env, orderId);
    const record = await env.DB.prepare("SELECT checkout, receipt_token FROM CheckoutOrders WHERE order_id=?").bind(orderId).first();
    const checkout = record && JSON.parse(record.checkout);
    if (checkout && Math.round(checkout.total * 100) !== Math.round(Number(verified.order_amount) * 100)) {
      return json({ ok: false, error: "The payment amount needs verification. Contact GOAXIS with your order number." }, 409);
    }
    const order = { order_id: orderId, order_status: verified.order_status, verified_status: verified.order_status,
      order_amount: verified.order_amount, order_currency: verified.order_currency };
    if (verified.order_status !== "PAID") return json({ ok: true, order });
    let delivery;
    if (record) {
      delivery = await sendPaidReceipt(env, verified, checkout);
    } else {
      // An old receipt link must not initiate a new mailing for a historical transaction.
      const old = await env.DB.prepare("SELECT admin_sent_at,customer_sent_at FROM PaymentNotifications WHERE order_id=?").bind(orderId).first();
      delivery = { owner: old?.admin_sent_at ? "sent" : "pending", customer: old?.customer_sent_at ? "sent" : "pending" };
    }
    const privateReceipt = record && token && timingSafeEqual(token, record.receipt_token)
      ? { items: checkout.items, address: checkout.address, customer_email: checkout.email } : {};
    return json({ ok: true, order, receipt: { number: orderId, delivery, owner_email: OWNER, ...privateReceipt } });
  } catch (error) {
    console.error("GOAXIS order verification unavailable", { orderId, error: String(error) });
    return json({ ok: false, error: "We could not verify this payment yet. Please check again." }, 503);
  }
}

async function cashfreeFetch(url, init) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15000)
  });
}

async function handleCashfreeWebhook(request, env) {
  if (!env.CASHFREE_SECRET_KEY) return json({ ok: false, error: "Webhook secret is not configured." }, 503);

  const timestamp = request.headers.get("x-webhook-timestamp");
  const signature = request.headers.get("x-webhook-signature");
  if (!timestamp || !signature) return json({ ok: false, error: "Missing webhook signature." }, 401);

  const rawBody = await request.text();
  const expected = await hmacBase64(env.CASHFREE_SECRET_KEY, `${timestamp}${rawBody}`);
  if (!timingSafeEqual(signature, expected)) return json({ ok: false, error: "Invalid webhook signature." }, 401);

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "Invalid webhook payload." }, 400);
  }

  const orderId = clean(event?.data?.order?.order_id, 100);
  const paymentStatus = clean(event?.data?.payment?.payment_status, 50);
  // Only signed SUCCESS events qualify. The mail helper rechecks PAID directly with
  // Cashfree before issuing customer and admin messages, with D1 deduplication.
  const result = await notifyVerifiedPayment(env, orderId, paymentStatus);
  return json(result.body, result.code);
}

async function hmacBase64(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return arrayBufferToBase64(signature);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function clean(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, maxLength);
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      ...extraHeaders
    }
  });
}
