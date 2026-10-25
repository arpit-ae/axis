export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
      return handleCashfreeOrderStatus(orderId, env);
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
      url.pathname === "/wrangler.toml" ||
      url.pathname.startsWith("/src/") ||
      url.pathname.startsWith("/migrations/") ||
      url.pathname.startsWith("/.github/")
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

  const reference = "ENQ-" + new Date().getUTCFullYear() + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();

  try {
    await env.DB.prepare(
      `INSERT INTO Leads
       (reference, name, email, phone, service, business_name, business_type, message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`
    ).bind(reference, name, email, phone || null, service, businessName || null, businessType || null, message).run();
  } catch (error) {
    console.error("Could not save GOAXIS enquiry", error);
    return json({ ok: false, error: "We could not save your enquiry. Please try again later." }, 500);
  }

  return json({ ok: true, reference });
}

async function handleCashfreeCreateOrder(request, env, url) {
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

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid payment request." }, 400);
  }

  const name = clean(data?.name, 100);
  const email = clean(data?.email, 254).toLowerCase();
  const phone = clean(data?.phone, 20).replace(/\D/g, "");
  const purpose = clean(data?.purpose, 200);
  const amount = Number(data?.amount);

  if (name.length < 2) return json({ ok: false, error: "Please enter your full name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "Please enter a valid email address." }, 400);
  if (!/^\d{10,15}$/.test(phone)) return json({ ok: false, error: "Please enter a valid mobile number." }, 400);
  if (!purpose) return json({ ok: false, error: "Please enter the payment purpose." }, 400);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
    return json({ ok: false, error: "Payment amount must be between ₹1 and ₹10,00,000." }, 400);
  }

  const orderId = `GOAXIS_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const environment = String(env.CASHFREE_ENV || "production").toLowerCase() === "sandbox" ? "sandbox" : "production";
  const endpoint = environment === "sandbox" ? "https://sandbox.cashfree.com/pg/orders" : "https://api.cashfree.com/pg/orders";
  const apiVersion = "2025-01-01";

  const payload = {
    order_id: orderId,
    order_amount: Number(amount.toFixed(2)),
    order_currency: "INR",
    customer_details: {
      customer_id: `CUST_${phone}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
      customer_name: name,
      customer_email: email,
      customer_phone: phone
    },
    order_note: purpose.slice(0, 200),
    order_meta: {
      return_url: `${siteUrl}/payment-return.html?order_id={order_id}`,
      notify_url: `${siteUrl}/api/cashfree/webhook`
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": apiVersion,
        "x-client-id": env.CASHFREE_APP_ID,
        "x-client-secret": env.CASHFREE_SECRET_KEY,
        "x-idempotency-key": crypto.randomUUID()
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.payment_session_id) {
      console.error("Cashfree create order failed", response.status, result);
      return json({ ok: false, error: "Cashfree could not create the payment order. Please try again." }, 502);
    }

    return json({
      ok: true,
      order_id: result.order_id || orderId,
      payment_session_id: result.payment_session_id,
      environment
    });
  } catch (error) {
    console.error("Cashfree create order request failed", error);
    return json({ ok: false, error: "Payment service is temporarily unavailable. Please try again." }, 502);
  }
}

async function handleCashfreeOrderStatus(orderId, env) {
  if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) {
    return json({ ok: false, error: "Cashfree production credentials are not configured." }, 503);
  }
  if (!/^GOAXIS_[A-Z0-9_]+$/.test(orderId)) {
    return json({ ok: false, error: "Invalid order ID." }, 400);
  }

  const environment = String(env.CASHFREE_ENV || "production").toLowerCase() === "sandbox" ? "sandbox" : "production";
  const base = environment === "sandbox" ? "https://sandbox.cashfree.com/pg/orders/" : "https://api.cashfree.com/pg/orders/";

  try {
    const response = await fetch(base + encodeURIComponent(orderId), {
      headers: {
        "x-api-version": "2025-01-01",
        "x-client-id": env.CASHFREE_APP_ID,
        "x-client-secret": env.CASHFREE_SECRET_KEY
      }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ ok: false, error: "Could not verify the Cashfree order." }, 502);

    return json({
      ok: true,
      order: {
        order_id: result.order_id || orderId,
        order_amount: result.order_amount,
        order_currency: result.order_currency,
        order_status: result.order_status,
        verified_status: result.order_status === "PAID" ? "PAID" : result.order_status
      }
    });
  } catch (error) {
    console.error("Cashfree order status request failed", error);
    return json({ ok: false, error: "Payment verification is temporarily unavailable." }, 502);
  }
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
  console.log("Verified Cashfree webhook", { orderId, paymentStatus, eventType: event?.type || "unknown" });

  // Cashfree remains the source of truth. The return page also performs a fresh
  // server-side order lookup before displaying a successful payment.
  return json({ ok: true });
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
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders }
  });
}
