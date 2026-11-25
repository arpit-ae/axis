import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { database as makeDb } from "./receipt-db.mjs";

const sample = { name: "Example Customer", email: "customer@example.test",
  phone: "9876543210", service: "Business Starter Suite",
  businessName: "Example Business", businessType: "Proprietor",
  message: "Please send details about the business website and invoice suite.",
  consent: true, website: "" };

test("contact form emails admin and customer separately from contact@goaxis.in", async () => {
  const oldFetch = globalThis.fetch;
  const mails = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    mails.push({ ...JSON.parse(init.body), idempotency: init.headers["Idempotency-Key"] });
    return new Response(JSON.stringify({ id: "mock-resend" }), { status: 200 });
  };
  try {
    const db = makeDb();
    const response = await worker.fetch(new Request("https://goaxis.in/api/enquiry", {
      method: "POST", headers: { "content-type": "application/json", Origin: "https://goaxis.in" },
      body: JSON.stringify(sample)
    }), { DB: db, RESEND_API_KEY: "test-key" });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.email_sent, true);
    assert.match(data.reference, /^ENQ-\d{4}-[A-F0-9]+$/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM Leads").first().n, 1);
    assert.equal(mails.length, 2);
    assert.deepEqual(mails.map(m => m.to[0]), ["goaxis.in@gmail.com", "customer@example.test"]);
    for (const mail of mails) assert.equal(mail.from, "GOAXIS Contact <contact@goaxis.in>");
    assert.match(mails[0].text, /Example Business/);
    assert.match(mails[1].subject, /We received your enquiry/);
    assert.ok(mails[0].idempotency !== mails[1].idempotency);
  } finally { globalThis.fetch = oldFetch; }
});

test("customer confirmation escapes any HTML", async () => {
  const oldFetch = globalThis.fetch;
  const mails = [];
  globalThis.fetch = async (_, init) => {
    mails.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "test-id" }), { status: 200 });
  };
  try {
    await worker.fetch(new Request("https://goaxis.in/api/enquiry", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...sample, name: "<b>Example customer</b>", message: "<script>example</script>" })
    }), { RESEND_API_KEY: "test-key", DB: makeDb() });
    assert.equal(mails.length, 2);
    assert.doesNotMatch(mails[0].html, /<script>alert/);
    assert.doesNotMatch(mails[1].html, /<img src=x/);
    assert.match(mails[1].html, /&lt;b&gt;/);
    assert.match(mails[1].html, /&lt;script&gt;/);
  } finally { globalThis.fetch = oldFetch; }
});

test("missing outbound secret saves reference but does not claim email delivery", async () => {
  const db = makeDb();
  const response = await worker.fetch(new Request("https://goaxis.in/api/enquiry", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample)
  }), { DB: db });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(db.prepare("SELECT count(*) AS n FROM Leads").first().n, 1);
  assert.equal(data.email_sent, false);
});

test("repeat email submissions are rate-limited on server", async () => {
  const db = makeDb();
  for (let i = 0; i < 4; i++) {
    const response = await worker.fetch(new Request("https://goaxis.in/api/enquiry", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample)
    }), { DB: db });
    if (i < 3) assert.equal(response.status, 200);
    else assert.equal(response.status, 429);
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM Leads").first().n, 3);
});

test("cross-origin requests fail before sending any emails", async () => {
  const response = await worker.fetch(new Request("https://goaxis.in/api/enquiry", {
    method: "POST", headers: { "content-type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify(sample)
  }), { DB: makeDb(), RESEND_API_KEY: "test-key" });
  assert.equal(response.status, 403);
});
