// Server-side transactional mail for GOAXIS. Never expose RESEND_API_KEY in site assets.
const ADMIN_EMAIL = "goaxis.in@gmail.com";
const FROM_SALES = "GOAXIS Sales <sales@goaxis.in>";
const FROM_ENQUIRIES = "GOAXIS Enquiries <enquiry@goaxis.in>";

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
  const state = { adminSent: false, customerSent: false };
  if (!env.RESEND_API_KEY) return state;

  const fields = [
    ["Reference", lead.reference],
    ["Name", lead.name],
    ["Customer email", lead.email],
    ["Phone", lead.phone || "Not provided"],
    ["Requested service", lead.service],
    ["Business name", lead.businessName || "Not provided"],
    ["Business type", lead.businessType || "Not provided"],
    ["Message", lead.message]
  ];
  const table = fields.map(([label, value]) =>
    "<tr><th align='left' style='padding:10px;color:#495671'>" + escapeHtml(label) +
    "</th><td style='padding:10px;white-space:pre-wrap'>" + escapeHtml(value) + "</td></tr>"
  ).join("");
  const from = "GOAXIS <contact@goaxis.in>";
  try {
    await sendMail(env, {
      from,
      to: ["contact@goaxis.in"],
      reply_to: lead.email,
      subject: "New GOAXIS website message • " + lead.reference,
      text: fields.map(([label, value]) => label + ": " + value).join("\n"),
      html: "<div style='max-width:660px;margin:auto;font:15px/1.7 Arial,sans-serif;color:#202c47'><h2 style='color:#2c3c84'>A new message for GOAXIS ✨</h2><p>A visitor submitted the secure website form.</p><table style='width:100%;border-collapse:collapse;background:#f7f7ff'>" + table +
        "</table><p>Reply to the customer using their supplied address. The enquiry is also saved in D1.</p></div>"
    }, "goaxis-contact-owner-" + lead.reference);
    state.adminSent = true;
  } catch (error) {
    console.error("GOAXIS contact owner email failed", { reference: lead.reference, error: String(error) });
    return state;
  }

  const messageLines = [
    "GOAXIS CONSULTANCY — We received your message",
    "Hello " + lead.name + ",",
    "Thank you for reaching out to GOAXIS. Your enquiry has been safely received.",
    "Reference: " + lead.reference,
    "Service: " + lead.service,
    "Your message: " + lead.message,
    "We will review your request and respond using your contact details.",
    "For follow-up, email contact@goaxis.in and include your reference number.",
    "This is an enquiry confirmation, not a payment receipt or service approval."
  ];
  try {
    await sendMail(env, {
      from,
      to: [lead.email],
      reply_to: "contact@goaxis.in",
      subject: "Your message is with us • " + lead.reference,
      text: messageLines.join("\n\n"),
      html: "<div style='max-width:620px;margin:auto;padding:28px;font:16px/1.7 Arial,sans-serif;background:#fff;color:#24314d;border:1px solid #e3e8fa;border-radius:22px'>" +
        "<p style='color:#6d58ac;font-weight:800;letter-spacing:.1em'>GOAXIS CONSULTANCY ♡</p>" +
        "<h1 style='font-size:28px;color:#25346b'>Thank you for reaching out.</h1>" +
        "<p>Hello " + escapeHtml(lead.name) + ", we have received your message and we appreciate you choosing to connect with us.</p>" +
        "<p style='padding:16px;background:#f5f2ff;border-radius:12px'><strong>Reference:</strong> " + escapeHtml(lead.reference) +
        "<br><strong>Service:</strong> " + escapeHtml(lead.service) + "</p>" +
        "<p><strong>Your message</strong></p><p style='white-space:pre-wrap'>" + escapeHtml(lead.message) + "</p>" +
        "<p>Our team will review your request. You can reply to this email to follow up.</p>" +
        "<p style='color:#73809b;font-size:13px'>This confirms receipt of your enquiry only; it does not confirm payment or service acceptance.</p></div>"
    }, "goaxis-contact-customer-" + lead.reference);
    state.customerSent = true;
  } catch (error) {
    console.error("GOAXIS contact customer email failed", { reference: lead.reference, error: String(error) });
  }
  return state;
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
