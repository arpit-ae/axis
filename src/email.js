import { addressText, rupees } from "../catalog.js";
import { deliverReceipt, queueMail, sendMail } from "./mail-queue.js";

export const OWNER = "goaxis.in@gmail.com";
const CONTACT = "GOAXIS Contact <contact@goaxis.in>";
const SALES = "GOAXIS Sales <sales@goaxis.in>";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function receiptMessage(from, to, replyTo, subject, introduction, rows) {
  const table = rows.map(([key, value]) => "<tr><th align='left' valign='top'>" + escapeHtml(key) +
    "</th><td style='white-space:pre-wrap'>" + escapeHtml(value) + "</td></tr>").join("");
  return {
    from, to: [to], reply_to: replyTo, subject,
    text: [introduction, ...rows.map(([key, value]) => key + ": " + value)].join("\n"),
    html: "<div style='max-width:640px;font:16px/1.5 Arial,sans-serif;color:#172b4d'><h2>GOAXIS CONSULTANCY</h2><p>" +
      escapeHtml(introduction) + "</p><table cellpadding='8'>" + table + "</table></div>"
  };
}

export function enquiryMessages(db, lead) {
  const { reference, name, email, phone, service, businessName, businessType, message } = lead;
  const rows = [["Receipt number", reference], ["Name", name], ["Email", email], ["Service", service],
    ["Phone", phone], ["Business", businessName], ["Business type", businessType], ["Message", message]].filter(([, v]) => v);
  const guard = "EXISTS (SELECT 1 FROM Leads WHERE reference=? AND request_id=?)";
  const args = [reference, lead.requestId];
  const customer = receiptMessage(CONTACT, email, "contact@goaxis.in", "We received your enquiry • " + reference,
    "Hello " + name + ", we received your enquiry. Reply to this email with your receipt number if you have more details.", rows);
  const statements = [];
  if (email !== OWNER) {
    const owner = receiptMessage(CONTACT, OWNER, email, "New GOAXIS enquiry • " + reference,
      "A customer sent this enquiry through goaxis.in. Reply to contact the customer.", rows);
    statements.push(queueMail(db, reference, "owner", "goaxis-enquiry-admin-" + reference, owner, guard, args));
  }
  statements.push(queueMail(db, reference, email === OWNER ? "both" : "customer", "goaxis-enquiry-confirm-" + reference, customer, guard, args));
  return statements;
}

export async function readCashfreeOrder(env, orderId) {
  const base = env.CASHFREE_ENV === "sandbox" ? "https://sandbox.cashfree.com/pg/orders/" : "https://api.cashfree.com/pg/orders/";
  const response = await fetch(base + encodeURIComponent(orderId), {
    headers: { "x-api-version": "2025-01-01", "x-client-id": env.CASHFREE_APP_ID, "x-client-secret": env.CASHFREE_SECRET_KEY },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("Cashfree status HTTP " + response.status);
  const order = await response.json();
  if (order.order_id !== orderId || order.order_currency !== "INR" || !(Number(order.order_amount) > 0)) {
    throw new Error("Cashfree order details did not match");
  }
  return order;
}

export async function sendPaidReceipt(env, order, checkout) {
  if (order.order_status !== "PAID") throw new Error("Order is not paid");
  const id = order.order_id;
  const amount = Number(order.order_amount);
  if (checkout && Math.round(checkout.total * 100) !== Math.round(amount * 100)) throw new Error("Verified amount mismatch");
  const customer = order.customer_details || {};
  const email = checkout?.email || String(customer.customer_email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Verified order lacks a receipt email");
  const name = checkout?.name || customer.customer_name || "Customer";
  const items = checkout?.items || [{ title: order.order_note || "Business service payment", quantity: 1, price: amount }];
  const rows = [["Receipt number", id], ["Order ID", id], ["Name", name], ["Email", email],
    ["Phone", checkout?.phone || customer.customer_phone || ""],
    ...items.map(item => ["Item", item.title + " × " + item.quantity + " — " + rupees(item.price * item.quantity)]),
    ["Total paid", rupees(amount)], ["Payment status", "PAID"]];
  if (checkout) rows.push(["Delivery address", addressText(checkout.address)]);
  const old = await env.DB.prepare("SELECT customer_sent_at, admin_sent_at FROM PaymentNotifications WHERE order_id=?").bind(id).first();
  const statements = [env.DB.prepare(`INSERT OR IGNORE INTO PaymentNotifications
    (order_id, customer_email, customer_name, purpose, amount) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, email, name, items.map(item => item.title).join(", "), amount)];
  const same = email === OWNER;
  const customerMail = receiptMessage(SALES, email, "sales@goaxis.in", "Payment confirmed • " + id,
    "Hello " + name + ", GOAXIS has verified your payment with Cashfree. Keep this order receipt for your records.", rows);
  statements.push(queueMail(env.DB, id, same ? "both" : "customer", "goaxis-receipt-" + id,
    customerMail, "1", [], old?.customer_sent_at || (same && old?.admin_sent_at) || null));
  if (!same) {
    const ownerMail = receiptMessage(SALES, OWNER, email, "GOAXIS paid order • " + id, "Cashfree confirmed a paid GOAXIS order.", rows);
    statements.push(queueMail(env.DB, id, "owner", "goaxis-admin-payment-" + id, ownerMail, "1", [], old?.admin_sent_at));
  }
  await env.DB.batch(statements);
  const delivery = await deliverReceipt(env, id);
  await env.DB.prepare(`UPDATE PaymentNotifications SET
    customer_sent_at=CASE WHEN ?='sent' THEN COALESCE(customer_sent_at,CURRENT_TIMESTAMP) ELSE customer_sent_at END,
    admin_sent_at=CASE WHEN ?='sent' THEN COALESCE(admin_sent_at,CURRENT_TIMESTAMP) ELSE admin_sent_at END
    WHERE order_id=? AND (customer_sent_at IS NULL OR admin_sent_at IS NULL)`)
    .bind(delivery.customer, delivery.owner, id).run();
  return delivery;
}

export async function notifyVerifiedPayment(env, id, paymentStatus) {
  if (paymentStatus !== "SUCCESS" || !/^GOAXIS_[A-Z0-9_]+$/.test(id)) return { code: 200, body: { ok: true, ignored: true } };
  if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY || !env.DB) return { code: 503, body: { ok: false } };
  try {
    const order = await readCashfreeOrder(env, id);
    // Ask the gateway to retry if its signed SUCCESS event arrived before its order switched to PAID.
    if (order.order_status !== "PAID") return { code: 503, body: { ok: false, pending: true } };
    const record = await env.DB.prepare("SELECT checkout FROM CheckoutOrders WHERE order_id=?").bind(id).first();
    const delivery = await sendPaidReceipt(env, order, record && JSON.parse(record.checkout));
    return { code: 200, body: { ok: true, delivery, notified: delivery.owner === "sent" && delivery.customer === "sent" } };
  } catch (error) {
    console.error("GOAXIS payment confirmation unavailable", { id, error: String(error) });
    return { code: 503, body: { ok: false, error: "Payment verification is temporarily unavailable." } };
  }
}

export async function sendOrbitCode(env, code, challenge) {
  return sendMail(env, {
    from: CONTACT, to: ["orbitgloble@gmail.com"], subject: "Orbit Global billing sign-in code",
    text: `Enter ${code} on the Orbit Global billing page to sign in. This code expires in 10 minutes. If you did not request it, you can ignore this email.`
  }, "orbit-signin-" + challenge);
}
