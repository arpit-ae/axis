import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";

function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../migrations/0003_orbit_billing.sql", import.meta.url), "utf8"));
  return {
    prepare(query) {
      const stmt = sql.prepare(query);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        run() { return {meta:stmt.run(...args)}; },
        first() { return stmt.get(...args); },
        all() { return {results:stmt.all(...args)}; }
      };
    },
    batch(statements) {
      sql.exec("BEGIN");
      try {
        const result = statements.map(s=>s.run());
        sql.exec("COMMIT");
        return result;
      } catch (err) { sql.exec("ROLLBACK"); throw err; }
    }
  };
}

test("two verified devices can open and update a bill, with independent sessions and stale-edit protection", async t => {
  const origin = "https://goaxis.in";
  const env = { DB:database(), RESEND_API_KEY:"test" };
  let code;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url),"https://api.resend.com/emails");
    const mail = JSON.parse(options.body);
    assert.deepEqual(mail.to,["orbitgloble@gmail.com"]);
    code = mail.text.match(/\b\d{8}\b/)[0];
    return new Response("{}",{status:200});
  });
  function api(path, method="GET", body, cookie="", requestOrigin=origin) {
    return worker.fetch(new Request(origin+"/api/orbit/"+path, {
      method, headers:{Origin:requestOrigin, Cookie:cookie, "Content-Type":"application/json"},
      body:body && JSON.stringify(body)
    }),env);
  }
  async function login() {
    const {challenge} = await (await api("code","POST",{})).json();
    assert.ok(challenge);
    assert.equal((await api("code","POST",{})).status,429);
    assert.equal((await api("verify","POST",{challenge,code:"invalid"})).status,400);
    const response = await api("verify","POST",{challenge,code});
    assert.equal(response.status,200);
    assert.equal((await api("verify","POST",{challenge,code})).status,401);
    return response.headers.get("set-cookie").split(";")[0];
  }
  assert.equal((await api("documents")).status,401);
  assert.equal((await api("code","POST",{},"","https://other.test")).status,403);
  const phone=await login();
  env.DB.prepare("UPDATE OrbitChallenges SET created=created-61").run();
  const laptop=await login();
  const id=crypto.randomUUID(), path="documents/"+id;
  const doc={version:1, mode:"Tax Invoice", number:"INV-001", date:"2026-11-24", buyer:{name:"Sample"}, seller:{name:"Orbit Global"},items:[{description:"Sample item"}]};
  const put=(cookie,revision,document)=>api(path,"PUT",{document,revision},cookie);
  assert.equal((await (await put(phone,0,doc)).json()).revision,1);
  assert.equal((await (await put(phone,0,doc)).json()).revision,1);
  assert.equal((await (await api("documents","GET",undefined,laptop)).json()).documents[0].id,id);
  assert.deepEqual((await (await api(path,"GET",undefined,laptop)).json()).document,doc);
  const changed={...doc,buyer:{name:"Changed"}};
  assert.equal((await (await put(laptop,1,changed)).json()).revision,2);
  assert.equal((await put(phone,1,doc)).status,409);
  assert.equal((await api("documents/"+crypto.randomUUID(),"PUT",{revision:0,document:doc},phone)).status,409);
  await api("logout","POST",{},laptop);
  assert.equal((await api(path,"GET",undefined,laptop)).status,401);
  assert.equal((await api(path,"GET",undefined,phone)).status,200);
});
