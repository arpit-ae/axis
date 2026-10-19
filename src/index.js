export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/enquiry") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405, { Allow: "POST" });
      }
      return handleEnquiry(request, env, url);
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
    // Quietly accept automated honeypot submissions without storing them.
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
