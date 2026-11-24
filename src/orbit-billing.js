import { sendOrbitCode } from "./email.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE = "__Host-orbit_session";
const MAX_BYTES = 800000;
const now = () => Math.floor(Date.now() / 1000);
const cookie = (token, seconds) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
const reply = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers }
});
const error = (message, status) => reply({ error: message }, status);

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

async function startLogin(env) {
  const id = crypto.randomUUID();
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000000).padStart(8, "0");
  const time = now();
  const hashed = await digest(id + ":" + code);
  const db = env.DB;
  const results = await db.batch([
    db.prepare("DELETE FROM OrbitChallenges WHERE created < ?").bind(time - 3600),
    db.prepare("DELETE FROM OrbitSessions WHERE expires <= ?").bind(time),
    db.prepare(`INSERT INTO OrbitChallenges(id,digest,created) SELECT ?,?,?
      WHERE (SELECT count(*) FROM OrbitChallenges) < 6
      AND NOT EXISTS(SELECT 1 FROM OrbitChallenges WHERE created > ?)`).bind(id, hashed, time, time - 60)
  ]);
  if (!results[2].meta.changes) return error("Please wait before requesting another code. Up to six codes can be sent per hour.", 429);
  try {
    await sendOrbitCode(env, code, id);
  } catch {
    return error("The sign-in email could not be sent. Try again in a minute.", 503);
  }
  return reply({ challenge: id });
}

async function verifyLogin(env, input) {
  if (!UUID.test(input.challenge) || !/^\d{8}$/.test(input.code)) return error("Enter the eight-digit code from your email.", 400);
  const hashed = await digest(input.challenge + ":" + input.code);
  const token = crypto.randomUUID() + crypto.randomUUID();
  const session = await digest(token);
  // Atomically consume the challenge and establish a session only for its successful claimant.
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE OrbitChallenges SET attempts=attempts+1, claim=CASE WHEN digest=? THEN ? END
      WHERE id=? AND claim IS NULL AND attempts<5 AND created>?`).bind(hashed, session, input.challenge, now()-600),
    env.DB.prepare(`INSERT INTO OrbitSessions(digest, expires) SELECT ?,? WHERE EXISTS(SELECT 1 FROM OrbitChallenges WHERE id=? AND claim=?)`).bind(session, now()+604800, input.challenge, session)
  ]);
  if (!results[1].meta.changes) return error("Code incorrect or expired. Check your email or request a new code.", 401);
  return reply({ signedIn: true }, 200, { "Set-Cookie": cookie(token, 604800) });
}

async function saveDocument(db, id, input) {
  const { document: doc, revision } = input;
  if (!Number.isSafeInteger(revision) || revision < 0 || !doc || doc.version !== 1 ||
      !["Tax Invoice","Delivery Challan"].includes(doc.mode) || typeof doc.number !== "string" ||
      !/^[A-Za-z0-9/-]{1,16}$/.test(doc.number) || !/^\d{4}-\d{2}-\d{2}$/.test(doc.date) ||
      !Array.isArray(doc.items) || !doc.items.length || doc.items.length > 500 ||
      typeof doc.buyer?.name !== "string" || !doc.seller) {
    return error("Check the document number, issue date and items before saving.", 400);
  }
  const date = new Date(doc.date+"T00:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==doc.date) return error("Check the issue date.", 400);
  const year = date.getUTCFullYear() - (date.getUTCMonth()<3 ? 1 : 0);
  const body = JSON.stringify(doc);
  const fields = [doc.mode, year, doc.number, doc.buyer.name.slice(0,300), doc.date, now(), body];
  const write = revision === 0
    ? db.prepare(`INSERT OR IGNORE INTO OrbitDocuments(mode,year,number,buyer,date,updated,body,id,revision)
        VALUES(?,?,?,?,?,?,?,?,1)`).bind(...fields, id)
    : db.prepare(`UPDATE OR IGNORE OrbitDocuments SET mode=?,year=?,number=?,buyer=?,date=?,updated=?,body=?,revision=revision+1
        WHERE id=? AND revision=?`).bind(...fields, id, revision);
  const result = await write.run();
  if (result.meta.changes) return reply({ id, revision: revision+1 });
  const current = await db.prepare("SELECT body,revision FROM OrbitDocuments WHERE id=?").bind(id).first();
  if (current?.body === body) return reply({ id, revision: current.revision });
  if (current && current.revision !== revision) return error("This bill has newer edits on another device. Download a backup of your draft, then reopen the bill from Saved bills.", 409);
  return error("This document number is already in use for this financial year. Choose another number or open the original from Saved bills.", 409);
}

export async function orbitBilling(request, env, url) {
  const path = url.pathname.slice("/api/orbit/".length);
  const method = request.method;
  if (!["GET","POST","PUT"].includes(method)) return error("Method not allowed.", 405);
  if (method !== "GET" && (request.headers.get("Origin") !== url.origin ||
      !request.headers.get("Content-Type")?.startsWith("application/json"))) return error("Use the Orbit Global billing page.", 403);
  try {
    let input = {};
    if (method !== "GET") {
      const limit = path.startsWith("documents/") ? MAX_BYTES : 1024;
      const length = Number(request.headers.get("Content-Length"));
      if (length > limit) return error("Document too large.", 413);
      // Limit streamed bodies as well as requests with a Content-Length header.
      const reader = request.body?.getReader();
      if (!reader) return error("Missing request body.", 400);
      const decoder = new TextDecoder();
      let received = 0, raw = "";
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > limit) { await reader.cancel(); return error("Document too large.", 413); }
        raw += decoder.decode(value, {stream:true});
      }
      try { input = JSON.parse(raw + decoder.decode()); } catch { return error("Invalid JSON.", 400); }
      if (!input || typeof input !== "object" || Array.isArray(input)) return error("Invalid request.", 400);
    }
    if (path === "code" && method === "POST") return await startLogin(env);
    if (path === "verify" && method === "POST") return await verifyLogin(env,input);
    const token = (request.headers.get("Cookie") || "").split(/;\s*/).find(s=>s.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);
    const hash = token && token.length === 72 ? await digest(token) : "";
    const session = hash && await env.DB.prepare("SELECT 1 AS ok FROM OrbitSessions WHERE digest=? AND expires>?").bind(hash,now()).first();
    if (path === "session" && method === "GET") return reply({ signedIn: Boolean(session) });
    if (!session) return error("Sign in to access saved bills.", 401);
    if (path === "logout" && method === "POST") {
      await env.DB.prepare("DELETE FROM OrbitSessions WHERE digest=?").bind(hash).run();
      return reply({ signedIn:false }, 200, { "Set-Cookie": cookie("",0) });
    }
    if (path === "documents" && method === "GET") {
      const offset = Number(url.searchParams.get("offset") || 0);
      if (!Number.isSafeInteger(offset) || offset<0) return error("Invalid page.",400);
      const list = await env.DB.prepare("SELECT id,mode,number,buyer,date FROM OrbitDocuments ORDER BY updated DESC,id LIMIT 51 OFFSET ?").bind(offset).all();
      return reply({ documents:list.results.slice(0,50), more:list.results.length>50 });
    }
    const id = path.split("/")[1];
    if (path === "documents/"+id && UUID.test(id)) {
      if (method === "PUT") return await saveDocument(env.DB,id,input);
      if (method === "GET") {
        const row = await env.DB.prepare("SELECT body,revision FROM OrbitDocuments WHERE id=?").bind(id).first();
        return row ? reply({ id, revision:row.revision, document:JSON.parse(row.body) }) : error("Bill not found.",404);
      }
    }
    return error("Not found.",404);
  } catch {
    return error("Online billing is temporarily unavailable. Your local draft is still on this device.",503);
  }
}
