// Server-side transactional mail for GOAXIS. Never expose RESEND_API_KEY in site assets.
const ADMIN_EMAIL = "goaxis.in@gmail.com";
const FROM_SALES = "GOAXIS Sales <sales@goaxis.in>";
const FROM_ENQUIRIES = "GOAXIS Contact <contact@goaxis.in>";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}
function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function money(value) {
  return "₹" + Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
async function sendMail(env, message, key) {
  if (!env.RESEND_API_KEY) throw new Error("Resend API key is missing");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": key
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    // Do not log message bodies or customer information from provider responses.
    throw new Error("Resend HTTP " + response.status);
  }
  return true;
}
export async function notifyEnquiry(env, lead) {
  if (!env.RESEND_API_KEY) return { admin_sent: false, customer_sent: false };
  const rows = [
    ["Reference", lead.reference],
    ["Name", lead.name],
    ["Email", lead.email],
    ["Phone", lead.phone || "Not provided"],
    ["Service", lead.service],
    ["Business", lead.businessName || "Not provided"],
    ["Business type", lead.businessType || "Not provided"],
    ["Message", lead.message]
  ];
  const admin = {
    from: FROM_ENQUIRIES,
    to: [ADMIN_EMAIL],
    reply_to: lead.email,
    subject: "New GOAXIS enquiry • " + lead.reference,
    text: rows.map(([label, value]) => label + ": " + value).join("\n"),
    html: "<div style='font:16px/1.7 Arial,sans-serif;max-width:670px;margin:auto;color:#142942'><h1 style='color:#294e84'>GOAXIS • New enquiry</h1><p>Customer enquiry received through goaxis.in.</p><table cellpadding='9' style='border-collapse:collapse;width:100%;background:#f3f7ff'>" +
      rows.map(([label, value]) => "<tr><th align='left' style='vertical-align:top'>" + escapeHtml(label) +
        "</th><td style='white-space:pre-wrap'>" + escapeHtml(value) + "</td></tr>").join("") +
      "</table><p>Reply to this email to respond to the customer.</p></div>"
  };

  const customerText = [
    "Thank you for contacting GOAXIS CONSULTANCY!",
    "Hello " + lead.name + ",",
    "We received your enquiry. Our team will review your requirements and reply by email.",
    "Your reference: " + lead.reference,
    "Service: " + lead.service,
    "Email provided: " + lead.email,
    "If you want to add details, reply to contact@goaxis.in and mention your reference.",
    "We will never ask for your password, OTP or full bank-card details by email.",
    "GOAXIS CONSULTANCY • https://goaxis.in"
  ].join("\n\n");
  const customer = {
    from: FROM_ENQUIRIES,
    to: [lead.email],
    reply_to: "contact@goaxis.in",
    subject: "We received your enquiry • " + lead.reference + " | GOAXIS",
    text: customerText,
    html: "<div style='font:16px/1.7 Arial,sans-serif;max-width:620px;margin:auto;padding:28px;border-radius:22px;background:#f7faff;color:#142942'>" +
      "<p style='font-size:12px;letter-spacing:.16em;color:#4665a0'>GOAXIS CONSULTANCY</p>" +
      "<h1 style='line-height:1.2;color:#183e73'>Thanks for reaching out! ✨</h1>" +
      "<p>Hi " + escapeHtml(lead.name) + ", we've received your enquiry and will review it with care.</p>" +
      "<div style='background:#fff;border:1px solid #e2eafa;border-radius:16px;padding:20px'>" +
      "<p><strong>Your reference:</strong> " + escapeHtml(lead.reference) + "</p>" +
      "<p><strong>Service:</strong> " + escapeHtml(lead.service) + "</p></div>" +
      "<p>Have more questions? Simply reply to <a href='mailto:contact@goaxis.in'>contact@goaxis.in</a>.</p>" +
      "<p style='font-size:13px;color:#526782'>For security, please don't share passwords, OTPs or complete card details.</p>" +
      "<a href='https://goaxis.in' style='color:#245c9c'>Explore GOAXIS →</a></div>"
  };

  // Separate idempotency keys ensure retries cannot duplicate the other's email.
  const results = await Promise.allSettled([
    sendMail(env, admin, "goaxis-enquiry-admin-" + lead.reference),
    sendMail(env, customer, "goaxis-enquiry-confirm-" + lead.reference)
  ]);
  if (results[0].status === "rejected") console.error("GOAXIS admin enquiry notification failed", { reference: lead.reference });
  if (results[1].status === "rejected") console.error("GOAXIS customer enquiry confirmation failed", { reference: lead.reference });
  return {
    admin_sent: results[0].status === "fulfilled",
    customer_sent: results[1].status === "fulfilled"
  };
}
export async function notifyVerifiedPayment(env, orderId, paymentStatus) {
  if (paymentStatus !== "SUCCESS" || !/^GOAXIS_[A-Z0-9_]+$/.test(orderId)) {
    return { code: 200, body: { ok: true, ignored: true } };
  }
  if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY || !env.RESEND_API_KEY || !env.DB) {
    return { code: 503, body: { ok: false, error: "Payment notification service is not configured." } };
  }
  const base = String(env.CASHFREE_ENV || "production").toLowerCase() === "sandbox"
    ? "https://sandbox.cashfree.com/pg/orders/"
    : "https://api.cashfree.com/pg/orders/";

  let verified;
  try {
    const resp = await fetch(base + encodeURIComponent(orderId), {
      headers: {
        "x-api-version": "2025-01-01",
        "x-client-id": env.CASHFREE_APP_ID,
        "x-client-secret": env.CASHFREE_SECRET_KEY
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) throw new Error("Cashfree HTTP " + resp.status);
    verified = await resp.json();
  } catch (error) {
    console.error("GOAXIS could not recheck paid Cashfree order", String(error));
    return { code: 503, body: { ok: false, error: "Order verification unavailable." } };
  }
  if (verified?.order_status !== "PAID" || verified?.order_id !== orderId ||
      verified?.order_currency !== "INR" || !(Number(verified.order_amount) > 0)) {
    return { code: 200, body: { ok: true, ignored: true, reason: "Order is not verified paid." } };
  }
  const customer = verified.customer_details || {};
  const recipient = String(customer.customer_email || "").trim().toLowerCase();
  if (!validEmail(recipient)) {
    console.error("GOAXIS paid order missing valid customer email", { orderId });
    return { code: 503, body: { ok: false, error: "Verified order lacks a valid customer email." } };
  }
  const name = String(customer.customer_name || "Customer").slice(0, 100);
  const amount = money(verified.order_amount);
  const purpose = String(verified.order_note || "Business service payment").slice(0, 200);
  const phone = String(customer.customer_phone || "").slice(0, 30);
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO PaymentNotifications (order_id, customer_email, customer_name, purpose, amount) VALUES (?, ?, ?, ?, ?)"
    ).bind(orderId, recipient, name, purpose, verified.order_amount).run();
    // Only one webhook invocation claims a row at a time; duplicate callbacks cannot send twice concurrently.
    const claim = await env.DB.prepare(
      "UPDATE PaymentNotifications SET processing_until=datetime('now','+5 minutes') WHERE order_id=? AND (processing_until IS NULL OR processing_until<CURRENT_TIMESTAMP)"
    ).bind(orderId).run();
    if (!(claim.meta?.changes > 0)) return { code: 200, body: { ok: true, processing: true } };
  } catch (error) {
    console.error("GOAXIS payment notification DB error", String(error));
    return { code: 503, body: { ok: false, error: "Notification database unavailable." } };
  }

  const receiptText = [
    "GOAXIS CONSULTANCY — Payment confirmation",
    "Hello " + name + ",",
    "Your payment has been independently verified with Cashfree.",
    "Order ID: " + orderId,
    "Service: " + purpose,
    "Amount paid: " + amount,
    "Payment status: PAID",
    "Check your order: https://goaxis.in/payment-return.html?order_id=" + encodeURIComponent(orderId),
    "Questions? Reply to support@goaxis.in.",
    "This confirmation is not a tax invoice; a tax invoice, where applicable, is provided separately."
  ].join("\n\n");
  const receiptHtml = "<div style='max-width:620px;margin:auto;font-family:Arial,sans-serif;color:#172b4d;line-height:1.6'>" +
    "<h1 style='color:#102a43'>GOAXIS <span style='color:#2563eb'>CONSULTANCY</span></h1>" +
    "<p style='font-size:20px'>Payment confirmed ✓</p><p>Hello " + escapeHtml(name) +
    ", your payment is verified and recorded.</p><table cellpadding='9' style='width:100%;border-collapse:collapse;background:#f5f8fc'>" +
    [["Order ID",orderId],["Service",purpose],["Amount paid",amount],["Payment status","PAID"]]
      .map(([label,value])=>"<tr><th align='left'>" + escapeHtml(label) + "</th><td>" + escapeHtml(value) + "</td></tr>").join("") +
    "</table><p><a href='https://goaxis.in/payment-return.html?order_id=" + encodeURIComponent(orderId) +
    "'>View your verified payment status</a></p><p>Need help? Reply to support@goaxis.in.</p>" +
    "<small>This is a payment acknowledgement, not a tax invoice. A tax invoice, where applicable, is provided separately.</small></div>";
  try {
    const row = await env.DB.prepare(
      "SELECT customer_sent_at, admin_sent_at FROM PaymentNotifications WHERE order_id=?"
    ).bind(orderId).first();
    if (!row.customer_sent_at) {
      await sendMail(env, {
        from: FROM_SALES, to: [recipient], reply_to: "support@goaxis.in",
        subject: "Payment confirmed • " + orderId, text: receiptText, html: receiptHtml
      }, "goaxis-receipt-" + orderId);
      await env.DB.prepare("UPDATE PaymentNotifications SET customer_sent_at=CURRENT_TIMESTAMP WHERE order_id=?")
        .bind(orderId).run();
    }
    if (!row.admin_sent_at) {
      const adminText = [
        "New verified GOAXIS payment",
        "Order: " + orderId, "Customer: " + name, "Email: " + recipient,
        "Phone: " + phone, "Service: " + purpose, "Amount: " + amount, "Status: PAID"
      ].join("\n");
      await sendMail(env, {
        from: FROM_SALES, to: [ADMIN_EMAIL], reply_to: recipient,
        subject: "GOAXIS paid order • " + orderId,
        text: adminText,
        html: "<h2>New verified GOAXIS payment</h2><pre style='font-family:Arial,sans-serif;white-space:pre-wrap'>" +
          escapeHtml(adminText) + "</pre>"
      }, "goaxis-admin-payment-" + orderId);
      await env.DB.prepare("UPDATE PaymentNotifications SET admin_sent_at=CURRENT_TIMESTAMP WHERE order_id=?")
        .bind(orderId).run();
    }
    return { code: 200, body: { ok: true, notified: true } };
  } catch (error) {
    console.error("GOAXIS paid email delivery failed", { orderId, error: String(error) });
    return { code: 503, body: { ok: false, error: "Payment verified, email service temporarily unavailable." } };
  } finally {
    await env.DB.prepare("UPDATE PaymentNotifications SET processing_until=NULL WHERE order_id=?")
      .bind(orderId).run().catch(() => {});
  }
}
