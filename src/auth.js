// GOAXIS customer + admin authentication (Cloudflare Worker + D1).
// Customers: email + password stored as PBKDF2-SHA256 hashes in the Users table.
// Admin: credentials kept only as Worker secrets ADMIN_EMAIL and ADMIN_PASSWORD.
// Sessions: random token in an HttpOnly cookie; only its SHA-256 hash is stored in D1.

const COOKIE = "goaxis_session";
const CUSTOMER_TTL = 60 * 60 * 24 * 7; // 7 days
const ADMIN_TTL = 60 * 60 * 8;         // 8 hours
const PBKDF2_ITERATIONS = 100000;
const MAX_FAILED_PER_15_MIN = 10;
const LEAD_STATUSES = ["new", "contacted", "in-progress", "completed", "closed"];

export async function handleAuthRoute(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (!env.DB) return json({ ok: false, error: "Account storage is not configured yet." }, 503);

  if (method !== "GET" && !sameOrigin(request, url, env)) {
    return json({ ok: false, error: "Cross-origin requests are not accepted." }, 403);
  }

  try {
    if (path === "/api/auth/signup" && method === "POST") return signup(request, env, url);
    if (path === "/api/auth/login" && method === "POST") return login(request, env, url);
    if (path === "/api/auth/admin-login" && method === "POST") return adminLogin(request, env, url);
    if (path === "/api/auth/logout" && method === "POST") return logout(request, env, url);
    if (path === "/api/auth/me" && method === "GET") return me(request, env);
    if (path === "/api/my/enquiries" && method === "GET") return myEnquiries(request, env);
    if (path === "/api/admin/leads" && method === "GET") return adminLeads(request, env, url);
    if (path.startsWith("/api/admin/leads/") && method === "POST") return adminUpdateLead(request, env, path);
    if (path === "/api/admin/users" && method === "GET") return adminUsers(request, env);
  } catch (error) {
    console.error("GOAXIS auth error", error);
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
  return json({ ok: false, error: "Not found." }, 404);
}

/* ---------- customer ---------- */

async function signup(request, env, url) {
  const data = await readJson(request);
  if (!data) return json({ ok: false, error: "Invalid request." }, 400);

  const name = clean(data.name, 100);
  const email = clean(data.email, 254).toLowerCase();
  const phone = clean(data.phone, 25);
  const password = typeof data.password === "string" ? data.password : "";

  if (name.length < 2) return json({ ok: false, error: "Please enter your full name." }, 400);
  if (!validEmail(email)) return json({ ok: false, error: "Please enter a valid email address." }, 400);
  if (phone && !/^[+0-9() .-]{7,25}$/.test(phone)) return json({ ok: false, error: "Please enter a valid phone number." }, 400);
  if (password.length < 8 || password.length > 128) return json({ ok: false, error: "Password must be 8 to 128 characters." }, 400);
  if (data.consent !== true) return json({ ok: false, error: "Please accept the Terms and Privacy Policy." }, 400);
  if (env.ADMIN_EMAIL && email === String(env.ADMIN_EMAIL).toLowerCase()) {
    return json({ ok: false, error: "This email cannot be used for a customer account." }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM Users WHERE email = ?").bind(email).first();
  if (existing) return json({ ok: false, error: "An account with this email already exists. Please log in." }, 409);

  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const result = await env.DB.prepare(
    "INSERT INTO Users (name, email, phone, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)"
  ).bind(name, email, phone || null, hash, salt).run();

  const userId = result.meta?.last_row_id;
  const cookie = await createSession(env, url, userId, "customer", CUSTOMER_TTL);
  return json({ ok: true, role: "customer", redirect: "/dashboard.html" }, 201, { "Set-Cookie": cookie });
}

async function login(request, env, url) {
  const ip = clientIp(request);
  if (await tooManyAttempts(env, ip)) {
    return json({ ok: false, error: "Too many login attempts. Please wait 15 minutes and try again." }, 429);
  }
  const data = await readJson(request);
  if (!data) return json({ ok: false, error: "Invalid request." }, 400);

  const email = clean(data.email, 254).toLowerCase();
  const password = typeof data.password === "string" ? data.password : "";

  const user = await env.DB.prepare("SELECT id, password_hash, password_salt FROM Users WHERE email = ?").bind(email).first();
  // Hash even when the user is missing so response time does not reveal which emails exist.
  const hash = await hashPassword(password, user ? user.password_salt : "00000000000000000000000000000000");
  if (!user || !timingSafeEqual(hash, user.password_hash)) {
    await recordFailure(env, ip);
    return json({ ok: false, error: "Incorrect email or password." }, 401);
  }

  const cookie = await createSession(env, url, user.id, "customer", CUSTOMER_TTL);
  return json({ ok: true, role: "customer", redirect: "/dashboard.html" }, 200, { "Set-Cookie": cookie });
}

async function myEnquiries(request, env) {
  const session = await getSession(request, env);
  if (!session || session.role !== "customer") return json({ ok: false, error: "Please log in." }, 401);
  const user = await env.DB.prepare("SELECT email FROM Users WHERE id = ?").bind(session.user_id).first();
  if (!user) return json({ ok: false, error: "Please log in." }, 401);
  const { results } = await env.DB.prepare(
    "SELECT reference, service, status, created_at FROM Leads WHERE email = ? ORDER BY created_at DESC LIMIT 100"
  ).bind(user.email).all();
  return json({ ok: true, enquiries: results || [] });
}

/* ---------- admin ---------- */

async function adminLogin(request, env, url) {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    return json({ ok: false, error: "Admin login is not configured yet." }, 503);
  }
  const ip = clientIp(request);
  if (await tooManyAttempts(env, ip)) {
    return json({ ok: false, error: "Too many login attempts. Please wait 15 minutes and try again." }, 429);
  }
  const data = await readJson(request);
  if (!data) return json({ ok: false, error: "Invalid request." }, 400);

  const email = clean(data.email, 254).toLowerCase();
  const password = typeof data.password === "string" ? data.password : "";
  const emailOk = timingSafeEqual(await sha256Hex(email), await sha256Hex(String(env.ADMIN_EMAIL).toLowerCase()));
  const passOk = timingSafeEqual(await sha256Hex(password), await sha256Hex(String(env.ADMIN_PASSWORD)));
  if (!emailOk || !passOk) {
    await recordFailure(env, ip);
    return json({ ok: false, error: "Incorrect admin email or password." }, 401);
  }

  const cookie = await createSession(env, url, null, "admin", ADMIN_TTL);
  return json({ ok: true, role: "admin", redirect: "/admin.html" }, 200, { "Set-Cookie": cookie });
}

async function adminLeads(request, env, url) {
  if (!(await isAdmin(request, env))) return json({ ok: false, error: "Admin login required." }, 401);
  const status = clean(url.searchParams.get("status") || "", 30);
  const q = clean(url.searchParams.get("q") || "", 100);
  let sql = "SELECT id, reference, name, email, phone, service, business_name, business_type, message, status, admin_note, created_at FROM Leads WHERE 1=1";
  const binds = [];
  if (status && LEAD_STATUSES.includes(status)) { sql += " AND status = ?"; binds.push(status); }
  if (q) {
    sql += " AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR reference LIKE ? OR service LIKE ?)";
    const like = `%${q}%`;
    binds.push(like, like, like, like, like);
  }
  sql += " ORDER BY created_at DESC LIMIT 500";
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  const counts = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM Leads GROUP BY status").all();
  return json({ ok: true, leads: results || [], counts: counts.results || [], statuses: LEAD_STATUSES });
}

async function adminUpdateLead(request, env, path) {
  if (!(await isAdmin(request, env))) return json({ ok: false, error: "Admin login required." }, 401);
  const id = Number(path.slice("/api/admin/leads/".length));
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: "Invalid lead." }, 400);
  const data = await readJson(request);
  if (!data) return json({ ok: false, error: "Invalid request." }, 400);
  const status = clean(data.status, 30);
  const note = clean(data.admin_note ?? "", 2000);
  if (!LEAD_STATUSES.includes(status)) return json({ ok: false, error: "Invalid status." }, 400);
  const res = await env.DB.prepare("UPDATE Leads SET status = ?, admin_note = ? WHERE id = ?").bind(status, note || null, id).run();
  if (!res.meta?.changes) return json({ ok: false, error: "Lead not found." }, 404);
  return json({ ok: true });
}

async function adminUsers(request, env) {
  if (!(await isAdmin(request, env))) return json({ ok: false, error: "Admin login required." }, 401);
  const { results } = await env.DB.prepare(
    "SELECT id, name, email, phone, created_at FROM Users ORDER BY created_at DESC LIMIT 500"
  ).all();
  return json({ ok: true, users: results || [] });
}

/* ---------- shared ---------- */

async function me(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ ok: true, loggedIn: false });
  if (session.role === "admin") return json({ ok: true, loggedIn: true, role: "admin", user: { name: "Admin" } });
  const user = await env.DB.prepare("SELECT name, email, phone, created_at FROM Users WHERE id = ?").bind(session.user_id).first();
  if (!user) return json({ ok: true, loggedIn: false });
  return json({ ok: true, loggedIn: true, role: "customer", user });
}

async function logout(request, env, url) {
  const token = readCookie(request, COOKIE);
  if (token) await env.DB.prepare("DELETE FROM Sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": buildCookie(url, "", 0) });
}

async function createSession(env, url, userId, role, ttl) {
  const token = randomHex(32);
  const expires = Math.floor(Date.now() / 1000) + ttl;
  await env.DB.prepare("DELETE FROM Sessions WHERE expires_at < ?").bind(Math.floor(Date.now() / 1000)).run();
  await env.DB.prepare("INSERT INTO Sessions (token_hash, user_id, role, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, role, expires).run();
  return buildCookie(url, token, ttl);
}

async function getSession(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT user_id, role, expires_at FROM Sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token)).first();
  if (!row || row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return row;
}

async function isAdmin(request, env) {
  const s = await getSession(request, env);
  return !!s && s.role === "admin";
}

function buildCookie(url, value, maxAge) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

async function tooManyAttempts(env, ip) {
  const since = Math.floor(Date.now() / 1000) - 15 * 60;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM LoginAttempts WHERE ip = ? AND created_at > ?").bind(ip, since).first();
  return (row?.n || 0) >= MAX_FAILED_PER_15_MIN;
}

async function recordFailure(env, ip) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT INTO LoginAttempts (ip, created_at) VALUES (?, ?)").bind(ip, now).run();
  await env.DB.prepare("DELETE FROM LoginAttempts WHERE created_at < ?").bind(now - 86400).run();
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

function sameOrigin(request, url, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const siteUrl = String(env.SITE_URL || "").replace(/\/$/, "");
  return origin === url.origin || (siteUrl && origin === siteUrl);
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

function bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(request) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.includes("application/json")) return null;
  if (Number(request.headers.get("Content-Length") || 0) > 8000) return null;
  try {
    const data = await request.json();
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clean(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, maxLength);
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders }
  });
}
