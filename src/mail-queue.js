// A persistent row per recipient covers concurrent browser returns, webhooks and retries.
export function queueMail(db, reference, role, key, message, guard, args, sentAt = null) {
  return db.prepare(`INSERT OR IGNORE INTO ReceiptMail (reference, recipient_role, mail_key, message, sent_at)
    SELECT ?, ?, ?, ?, ? WHERE ${guard}`).bind(reference, role, key, sentAt ? null : JSON.stringify(message), sentAt, ...args);
}

export async function sendMail(env, message, key) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(message), signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) {
    const error = new Error("Mail provider HTTP " + res.status);
    error.status = res.status;
    throw error;
  }
  const result = await res.json();
  if (!result.id) throw new Error("Mail provider acceptance unconfirmed");
  return result.id;
}

async function deliverOne(env, key) {
  if (!env.RESEND_API_KEY) return;
  // Stop ambiguous retries before the provider's 24-hour idempotency window ends.
  const row = await env.DB.prepare(`UPDATE ReceiptMail SET lease_until=unixepoch()+60,
      first_attempt=COALESCE(first_attempt,unixepoch()), attempts=attempts+1
    WHERE mail_key=? AND sent_at IS NULL AND blocked=0 AND next_attempt<=unixepoch()
      AND lease_until<=unixepoch() AND (first_attempt IS NULL OR first_attempt>unixepoch()-82800)
    RETURNING message, attempts`).bind(key).first();
  if (!row) return;
  try {
    await sendMail(env, JSON.parse(row.message), key);
  } catch (error) {
    const permanent = [400, 422].includes(error.status);
    const delay = Math.min(1800, 15 * 2 ** Math.min(row.attempts, 7));
    await env.DB.prepare("UPDATE ReceiptMail SET blocked=?, next_attempt=unixepoch()+?, lease_until=0 WHERE mail_key=?")
      .bind(Number(permanent), delay, key).run();
    console.error("GOAXIS receipt mail pending", { key, status: error.status || "unconfirmed" });
    return;
  }
  await env.DB.prepare("UPDATE ReceiptMail SET sent_at=CURRENT_TIMESTAMP, message=NULL, lease_until=0 WHERE mail_key=?")
    .bind(key).run();
}

export async function deliverReceipt(env, reference) {
  const records = await env.DB.prepare("SELECT mail_key FROM ReceiptMail WHERE reference=? AND sent_at IS NULL AND blocked=0")
    .bind(reference).all();
  for (const row of records.results) await deliverOne(env, row.mail_key);
  const status = { owner: "pending", customer: "pending" };
  const rows = await env.DB.prepare(`SELECT recipient_role, sent_at, blocked,
    first_attempt<=unixepoch()-82800 AS expired FROM ReceiptMail WHERE reference=?`).bind(reference).all();
  for (const row of rows.results) {
    const state = row.sent_at ? "sent" : row.blocked || row.expired ? "attention" : "pending";
    if (row.recipient_role === "both") status.owner = status.customer = state;
    else status[row.recipient_role] = state;
  }
  return status;
}

export async function retryMail(env) {
  if (!env.RESEND_API_KEY || !env.DB) return;
  const due = await env.DB.prepare(`SELECT mail_key FROM ReceiptMail WHERE sent_at IS NULL AND blocked=0
    AND next_attempt<=unixepoch() AND lease_until<=unixepoch()
    AND (first_attempt IS NULL OR first_attempt>unixepoch()-82800) ORDER BY next_attempt, rowid LIMIT 18`).all();
  for (const row of due.results) await deliverOne(env, row.mail_key);
}
