import test from "node:test";
import assert from "node:assert/strict";
import { notifyVerifiedPayment } from "../src/email.js";

function fakeDatabase() {
  const data = new Map();
  return {
    data,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() {
          const id = args[0];
          if (sql.includes("INSERT OR IGNORE INTO PaymentNotifications")) {
            if (!data.has(id)) data.set(id, { customer_sent_at: null, admin_sent_at: null, processing: false });
            return { meta: { changes: 1 } };
          }
          const row = data.get(id);
          if (!row) throw new Error("Missing order");
          if (sql.includes("processing_until=datetime")) {
            if (row.processing) return { meta: { changes: 0 } };
            row.processing = true;
            return { meta: { changes: 1 } };
          }
          if (sql.includes("customer_sent_at=CURRENT_TIMESTAMP")) row.customer_sent_at = "sent";
          if (sql.includes("admin_sent_at=CURRENT_TIMESTAMP")) row.admin_sent_at = "sent";
          if (sql.includes("processing_until=NULL")) row.processing = false;
          return { meta: { changes: 1 } };
        },
        async first() {
          const row = data.get(args[0]);
          if (!row) return null;
          return { customer_sent_at: row.customer_sent_at, admin_sent_at: row.admin_sent_at };
        }
      };
    }
  };
}
function environment(db) {
  return { CASHFREE_APP_ID: "fake-app-id", CASHFREE_SECRET_KEY: "fake-secret",
    RESEND_API_KEY: "fake-resend-key", CASHFREE_ENV: "sandbox", DB: db };
}
function paid(orderId="GOAXIS_TEST_123") {
  return { order_id: orderId, order_status: "PAID", order_currency: "INR",
    order_amount: 800, order_note: "Purchase + Sales Invoice Templates",
    customer_details: { customer_name: "Test User", customer_email: "test@example.com",
      customer_phone: "+919876543210" } };
}

test("ignores unverified webhook status without contacting payment or mail provider", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Should not fetch for failed payment"); };
  try {
    const result = await notifyVerifiedPayment(environment(fakeDatabase()), "GOAXIS_TEST_123", "FAILED");
    assert.equal(result.code, 200);
    assert.equal(result.body.ignored, true);
  } finally { globalThis.fetch = prev; }
});

test("never sends receipts if Cashfree says PENDING after signed success event", async () => {
  const prev = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async url => {
    paths.push(String(url));
    return new Response(JSON.stringify({ ...paid(), order_status: "ACTIVE" }), { status: 200 });
  };
  try {
    const result = await notifyVerifiedPayment(environment(fakeDatabase()), "GOAXIS_TEST_123", "SUCCESS");
    assert.equal(result.code, 200);
    assert.equal(result.body.ignored, true);
    assert.equal(paths.length, 1);
    assert.match(paths[0], /sandbox\.cashfree\.com/);
  } finally { globalThis.fetch = prev; }
});

test("sends exactly one payment receipt and one admin notice for repeated verified callback", async () => {
  const prev = globalThis.fetch;
  const db = fakeDatabase();
  const sent = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("sandbox.cashfree.com")) return new Response(JSON.stringify(paid()), { status: 200 });
    if (String(url).includes("api.resend.com")) {
      const message = JSON.parse(options.body);
      sent.push(message);
      return new Response(JSON.stringify({ id: "fake-message-id" }), { status: 200 });
    }
    throw new Error("Unexpected URL: " + url);
  };
  try {
    const env = environment(db);
    const first = await notifyVerifiedPayment(env, "GOAXIS_TEST_123", "SUCCESS");
    const second = await notifyVerifiedPayment(env, "GOAXIS_TEST_123", "SUCCESS");
    assert.equal(first.code, 200);
    assert.equal(second.code, 200);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map(x => x.to[0]), ["test@example.com", "goaxis.in@gmail.com"]);
    assert.equal(sent[0].from, "GOAXIS Sales <sales@goaxis.in>");
    assert.match(sent[0].text, /Order ID: GOAXIS_TEST_123/);
    assert.match(sent[0].text, /₹800\.00/);
    assert.ok(db.data.get("GOAXIS_TEST_123").customer_sent_at);
    assert.ok(db.data.get("GOAXIS_TEST_123").admin_sent_at);
  } finally { globalThis.fetch = prev; }
});
