import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pages = [
  "index.html", "services.html", "website-builder.html", "documents.html",
  "faq.html", "service.html", "business-suite-demo.html", "payment-return.html",
  "privacy.html", "terms.html", "refunds-cancellations.html"
];
test("Pay Now is directly reachable in the header of every public service page", () => {
  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    const header = html.match(/<header\b[\s\S]*?<\/header>/i)?.[0];
    assert.ok(header, `missing site header in ${page}`);
    assert.match(header, /class="header-pay-now"[^>]*href="pay-now\.html"/, `missing Pay Now in ${page}`);
    assert.match(header, />\s*Pay Now\s*</, `missing visible Pay Now label in ${page}`);
    assert.doesNotMatch(html, /https?:\/\/(?:wa\.me|api\.whatsapp\.com)/i, `WhatsApp CTA in ${page}`);
  }
});
test("payment page retains working Cashfree checkout form and Pay Now submit button", () => {
  const html = readFileSync("pay-now.html", "utf8");
  assert.match(html, /id="payment-form"/);
  assert.match(html, /id="pay-button"[^>]*type="submit">Pay Now/);
  assert.match(html, /sdk\.cashfree\.com\/js\/v3\/cashfree\.js/);
  assert.match(html, /src="cf-launch\.js/);
});
test("homepage preserves both clear Pay Now shortcut and email Send enquiry", () => {
  const html = readFileSync("index.html", "utf8");
  assert.match(html, /class="button button-secondary hero-pay-now" href="pay-now\.html"/);
  assert.match(html, /id="enquiry-form"/);
  assert.match(html, /type="submit">Send/);
});
test("all-in-one suite includes website, purchase/sales invoices and delivery challan", () => {
  const home = readFileSync("index.html", "utf8");
  const suite = readFileSync("website-builder.html", "utf8");
  const backend = readFileSync("src/index.js", "utf8");
  assert.match(home, /₹2,000/);
  assert.match(suite, /[Pp]urchase/);
  assert.match(suite, /[Ss]ales/);
  assert.match(suite, /[Dd]elivery [Cc]hallan/);
  assert.match(backend, /"website-ten-page":\s*\{\s*amount:\s*2000/);
});
test("Pay Now remains visible on mobile with the new glass styling", () => {
  const styles = readFileSync("premium.css", "utf8");
  assert.match(styles, /\.header-pay-now\{/);
  assert.match(styles, /@media\(max-width:600px\)/);
});
