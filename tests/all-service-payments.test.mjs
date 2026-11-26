import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { packages, orderLines } from "../catalog.js";
const expected = {"udyam":100,"gst":499,"fssai":200,"iec":700,"website-five-page":1000,"website-ten-page":2000,"invoice-basic":500,"invoice-purchase-sale":800,"invoice-challan":1000};
const read = path => readFileSync(path, "utf8");
test("all advertised offers are available at fixed server-side prices", () => {
  assert.equal(Object.keys(packages).length, Object.keys(expected).length);
  for (const [id, price] of Object.entries(expected)) {
    assert.equal(packages[id].amount, price);
    assert.equal(orderLines([id], "tampered", 1)[0].price, price);
    for (const page of ["index.html", "services.html"]) assert.ok(read(page).includes("pay-now.html?package="+id), page+" "+id);
    assert.ok(read("pay-now.html").includes('value="'+id+'"'));
  }
  assert.equal(orderLines(["udyam","gst"],"tampered",1).reduce((a,x)=>a+x.price,0),599);
});
test("quote-based service payments retain customer-agreed amount flow", () => {
  for (const title of ["APEDA & Export Documentation","Business Documents","Custom Business Support"]) {
    assert.ok(read("services.html").includes("pay-now.html?purpose="+encodeURIComponent(title)));
  }
  assert.equal(orderLines([], "Agreed quotation", 375)[0].price,375);
  assert.ok(read("service.html").includes('id="service-payment"'));
  assert.ok(read("website-builder.html").includes("pay-now.html?package=website-five-page"));
});