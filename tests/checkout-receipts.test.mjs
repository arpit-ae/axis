import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";
import { database } from "./receipt-db.mjs";

const origin = "https://goaxis.in";
const address = { line1: "41 Test Road", line2: "", city: "Patna", state: "Bihar", postal: "800001", country: "India" };
const orderData = { name: "Test Customer", phone: "9876543210", email: "checkout@example.test", package_ids: ["invoice-basic", "invoice-challan"], address };
const enquiry = { name: "Test Customer", email: "enquiry@example.test", service: "Website design", message: "Please send details.", consent: true };
function setup(t) {
  const env = { DB: database(), RESEND_API_KEY: "mock", CASHFREE_APP_ID: "mock", CASHFREE_SECRET_KEY: "test-secret", CASHFREE_ENV: "sandbox" };
  const gateway = new Map(), emails = [];
  const spec = { env, gateway, emails, fail: "" };
  t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
    if (String(url) === "https://sandbox.cashfree.com/pg/orders") {
      const body = JSON.parse(opts.body);
      assert.equal(opts.headers["x-idempotency-key"].length, 36);
      gateway.set(body.order_id, { ...body, order_status: "ACTIVE", payment_session_id: "sandbox-session" });
      return Response.json(gateway.get(body.order_id));
    }
    if (String(url).startsWith("https://sandbox.cashfree.com/pg/orders/")) return Response.json(gateway.get(String(url).split("/").pop()));
    assert.equal(String(url), "https://api.resend.com/emails");
    const mail = JSON.parse(opts.body);
    if (spec.fail === mail.to[0]) return Response.json({}, { status: 429 });
    emails.push({ ...mail, key: opts.headers["Idempotency-Key"] });
    return Response.json({ id: "m-" + emails.length });
  });
  spec.api = (path, body, headers = {}) => worker.fetch(new Request(origin + path, { method: body ? "POST" : "GET",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: body && JSON.stringify(body) }), env);
  spec.signed = (id, state) => {
    const event = { data: { order: { order_id: id }, payment: { payment_status: state } } };
    const ts = String(Date.now());
    return spec.api("/api/cashfree/webhook", event, { "x-webhook-timestamp": ts,
      "x-webhook-signature": createHmac("sha256", env.CASHFREE_SECRET_KEY).update(ts + JSON.stringify(event)).digest("base64") });
  };
  return spec;
}

test("concurrent enquiry submissions produce one receipt and one message per recipient; replay after a day stays sent", async t => {
  const s = setup(t), data = { ...enquiry, request_id: crypto.randomUUID() };
  const [a,b] = await Promise.all([s.api("/api/enquiry", data), s.api("/api/enquiry", data)]);
  assert.equal((await a.json()).reference,(await b.json()).reference);
  s.env.DB.prepare("UPDATE ReceiptMail SET first_attempt=unixepoch()-100000").run();
  const replay = await (await s.api("/api/enquiry", data)).json();
  assert.equal(replay.email_sent, true); assert.equal(s.emails.length,2);
  assert.equal((await s.api("/api/enquiry",{ ...data, message:"A different enquiry" })).status,409);
});
test("a partial enquiry email failure retries only the outstanding copy without another form submission", async t => {
  const s=setup(t); s.fail=enquiry.email;
  const data = await (await s.api("/api/enquiry",enquiry)).json();
  assert.deepEqual(data.delivery,{ owner:"sent",customer:"pending" });
  s.fail=""; s.env.DB.prepare("UPDATE ReceiptMail SET next_attempt=0").run();
  await worker.scheduled({},s.env); await worker.scheduled({},s.env);
  assert.equal(s.emails.length,2); assert.match(s.emails[1].text,/Please send details/);
});
test("a customer using the owner inbox receives one combined receipt", async t=>{
  const s=setup(t);
  const d=await (await s.api("/api/enquiry",{...enquiry,email:"goaxis.in@gmail.com"})).json();
  assert.equal(s.emails.length,1); assert.deepEqual(d.delivery,{owner:"sent",customer:"sent"});
});
test("checkout requires a valid address and uses catalogue prices for multiple packages and agreed amounts for custom payments", async t => {
  const s=setup(t);
  assert.equal((await s.api("/api/cashfree/create-order",{...orderData,address:{}})).status,400);
  assert.equal((await s.api("/api/cashfree/create-order",{...orderData,address:{...address,postal:"123"}})).status,400);
  assert.equal(s.gateway.size,0);
  const id=crypto.randomUUID(), data={...orderData,request_id:id,amount:1};
  const a=await (await s.api("/api/cashfree/create-order",data)).json();
  const b=await (await s.api("/api/cashfree/create-order",data)).json();
  assert.equal(a.total,1500); assert.equal(a.items.length,2); assert.equal(a.order_id,b.order_id); assert.equal(s.gateway.size,1);
  assert.equal((await s.api("/api/cashfree/create-order",{...data,phone:"8765432190"})).status,409);
  const custom=await (await s.api("/api/cashfree/create-order",{...orderData,package_ids:[],purpose:"Agreed balance",amount:"300.25"})).json();
  assert.equal(custom.total,300.25); assert.equal(s.emails.length,0);
});
test("verified return and signed webhook racing send exactly two addressed itemised receipts; unverified requests cannot show a paid receipt", async t => {
  const s=setup(t), created=await (await s.api("/api/cashfree/create-order",orderData)).json();
  const id=created.order_id, url="/api/cashfree/order/"+id, headers={"X-Receipt-Token":created.receipt_token};
  assert.equal((await s.api("/api/cashfree/webhook",{data:{}})).status,401);
  assert.equal((await (await s.api(url+"?status=PAID",null,headers)).json()).receipt,undefined);
  const order=s.gateway.get(id); order.order_status="PAID"; order.order_amount=1;
  assert.equal((await s.api(url,null,headers)).status,409); assert.equal(s.emails.length,0);
  order.order_amount=1500;
  await Promise.all([s.signed(id,"SUCCESS"),s.api(url,null,headers)]);
  const receipt=(await (await s.api(url,null,headers)).json()).receipt;
  assert.deepEqual(receipt.delivery,{owner:"sent",customer:"sent"}); assert.equal(receipt.items.length,2); assert.deepEqual(receipt.address,address);
  const publicReceipt=(await (await s.api(url)).json()).receipt;
  assert.equal(publicReceipt.customer_email,undefined); assert.equal(publicReceipt.address,undefined); assert.equal(publicReceipt.items,undefined);
  assert.equal(s.emails.length,2); assert.equal(new Set(s.emails.map(m=>m.key)).size,2);
  for(const mail of s.emails){ assert.match(mail.from,/sales@goaxis.in/); assert.match(mail.text,/41 Test Road/); assert.match(mail.text,/₹1,500.00/); assert.match(mail.text,/Invoice Template/); }
});
