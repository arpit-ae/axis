(() => {
  "use strict";
  const page = document.body.dataset.portal;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (s) => { if (!s) return ""; const d = new Date(String(s).replace(" ", "T") + "Z"); return isNaN(d) ? s : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({ ok: false, error: "Unexpected server response." }));
    return { status: res.status, ...data };
  }

  function setMsg(form, text, type = "") {
    const el = form.querySelector(".portal-msg");
    if (el) { el.textContent = text; el.className = "portal-msg " + type; }
  }

  function busy(form, on, label) {
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  function bindLogout() {
    const btn = document.getElementById("logout-btn");
    if (btn) btn.addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }); location.href = page === "admin" ? "admin.html" : "login.html"; });
  }

  const badge = (s) => `<span class="portal-badge s-${esc(s)}">${esc(String(s).replace("-", " "))}</span>`;

  /* ---------- login / signup ---------- */
  async function initLogin() {
    const me = await api("/api/auth/me");
    if (me.loggedIn) { location.replace(me.role === "admin" ? "admin.html" : "dashboard.html"); return; }

    const tabs = document.querySelectorAll("[data-tab]");
    const show = (name) => {
      tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
      document.querySelectorAll("[data-panel]").forEach(p => { p.hidden = p.dataset.panel !== name; });
    };
    tabs.forEach(t => t.addEventListener("click", () => { show(t.dataset.tab); history.replaceState(null, "", "#" + t.dataset.tab); }));
    if (location.hash === "#signup") show("signup");

    const loginForm = document.getElementById("login-form");
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!loginForm.reportValidity()) return;
      const f = new FormData(loginForm);
      busy(loginForm, true, "Logging in…"); setMsg(loginForm, "");
      const r = await api("/api/auth/login", { method: "POST", body: { email: f.get("email"), password: f.get("password") } });
      busy(loginForm, false);
      if (r.ok) location.href = r.redirect || "dashboard.html";
      else setMsg(loginForm, r.error || "Login failed.", "error");
    });

    const signupForm = document.getElementById("signup-form");
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!signupForm.reportValidity()) return;
      const f = new FormData(signupForm);
      if (f.get("password") !== f.get("confirm")) return setMsg(signupForm, "Passwords do not match.", "error");
      busy(signupForm, true, "Creating account…"); setMsg(signupForm, "");
      const r = await api("/api/auth/signup", { method: "POST", body: {
        name: f.get("name"), email: f.get("email"), phone: f.get("phone"), password: f.get("password"), consent: f.get("consent") === "on"
      } });
      busy(signupForm, false);
      if (r.ok) location.href = r.redirect || "dashboard.html";
      else setMsg(signupForm, r.error || "Could not create the account.", "error");
    });
  }

  /* ---------- customer dashboard ---------- */
  async function initDashboard() {
    const me = await api("/api/auth/me");
    if (!me.loggedIn || me.role !== "customer") { location.replace(me.role === "admin" ? "admin.html" : "login.html"); return; }
    document.getElementById("user-name").textContent = me.user.name;
    document.getElementById("user-email").textContent = me.user.email;
    bindLogout();

    const box = document.getElementById("enquiries");
    const r = await api("/api/my/enquiries");
    if (!r.ok) { box.innerHTML = `<p class="portal-msg error">${esc(r.error)}</p>`; return; }
    if (!r.enquiries.length) {
      box.innerHTML = `<div class="portal-empty">No enquiries yet for this email. <a href="index.html#contact">Send your first enquiry →</a></div>`;
      return;
    }
    box.innerHTML = `<div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>Reference</th><th>Service</th><th>Status</th><th>Submitted</th></tr></thead><tbody>${
      r.enquiries.map(q => `<tr><td><strong>${esc(q.reference)}</strong></td><td>${esc(q.service)}</td><td>${badge(q.status)}</td><td>${esc(fmtDate(q.created_at))}</td></tr>`).join("")
    }</tbody></table></div>`;
  }

  /* ---------- admin ---------- */
  async function initAdmin() {
    const loginWrap = document.getElementById("admin-login-wrap");
    const panel = document.getElementById("admin-panel");
    const form = document.getElementById("admin-login-form");

    const openPanel = () => { loginWrap.hidden = true; panel.hidden = false; bindLogout(); loadLeads(); };

    const me = await api("/api/auth/me");
    if (me.loggedIn && me.role === "admin") openPanel();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const f = new FormData(form);
      busy(form, true, "Logging in…"); setMsg(form, "");
      const r = await api("/api/auth/admin-login", { method: "POST", body: { email: f.get("email"), password: f.get("password") } });
      busy(form, false);
      if (r.ok) openPanel(); else setMsg(form, r.error || "Login failed.", "error");
    });

    document.querySelectorAll("[data-admin-tab]").forEach(t => t.addEventListener("click", () => {
      document.querySelectorAll("[data-admin-tab]").forEach(x => x.classList.toggle("active", x === t));
      document.querySelectorAll("[data-admin-panel]").forEach(p => { p.hidden = p.dataset.adminPanel !== t.dataset.adminTab; });
      if (t.dataset.adminTab === "users") loadUsers();
    }));

    const filter = document.getElementById("lead-filter");
    filter.addEventListener("submit", (e) => { e.preventDefault(); loadLeads(); });

    let statuses = [];
    async function loadLeads() {
      const f = new FormData(filter);
      const qs = new URLSearchParams({ q: f.get("q") || "", status: f.get("status") || "" });
      const box = document.getElementById("leads");
      const r = await api("/api/admin/leads?" + qs);
      if (r.status === 401) { panel.hidden = true; loginWrap.hidden = false; return; }
      if (!r.ok) { box.innerHTML = `<p class="portal-msg error">${esc(r.error)}</p>`; return; }

      if (!statuses.length) {
        statuses = r.statuses;
        const sel = filter.querySelector('select[name="status"]');
        statuses.forEach(s => sel.insertAdjacentHTML("beforeend", `<option value="${esc(s)}">${esc(s)}</option>`));
      }
      const total = r.counts.reduce((a, c) => a + c.n, 0);
      document.getElementById("lead-stats").innerHTML = `<div class="portal-stat"><strong>${total}</strong><span>Total</span></div>` +
        statuses.map(s => `<div class="portal-stat"><strong>${(r.counts.find(c => c.status === s) || { n: 0 }).n}</strong><span>${esc(s)}</span></div>`).join("");

      if (!r.leads.length) { box.innerHTML = `<div class="portal-empty">No enquiries match.</div>`; return; }
      box.innerHTML = r.leads.map(l => `
        <article class="portal-lead" data-id="${l.id}">
          <div class="portal-lead-top"><div><strong>${esc(l.name)}</strong> · <small>${esc(l.reference)}</small></div>${badge(l.status)}</div>
          <p><a href="mailto:${esc(l.email)}">${esc(l.email)}</a>${l.phone ? ` · <a href="tel:${esc(l.phone)}">${esc(l.phone)}</a> · <a href="https://wa.me/${esc(String(l.phone).replace(/\D/g, ""))}" target="_blank" rel="noopener">WhatsApp ↗</a>` : ""}</p>
          <p><strong>${esc(l.service)}</strong>${l.business_name ? ` · ${esc(l.business_name)}` : ""}${l.business_type ? ` (${esc(l.business_type)})` : ""}</p>
          <p>${esc(l.message)}</p>
          <small>${esc(fmtDate(l.created_at))}</small>
          <div class="portal-lead-edit">
            <select name="status">${statuses.map(s => `<option value="${esc(s)}"${s === l.status ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
            <textarea name="admin_note" maxlength="2000" placeholder="Private note">${esc(l.admin_note || "")}</textarea>
            <button type="button" class="button button-small" data-save>Save</button>
          </div>
        </article>`).join("");

      box.querySelectorAll("[data-save]").forEach(btn => btn.addEventListener("click", async () => {
        const card = btn.closest(".portal-lead");
        btn.disabled = true; btn.textContent = "Saving…";
        const r2 = await api("/api/admin/leads/" + card.dataset.id, { method: "POST", body: {
          status: card.querySelector('select[name="status"]').value,
          admin_note: card.querySelector('textarea[name="admin_note"]').value
        } });
        btn.disabled = false; btn.textContent = r2.ok ? "Saved ✓" : "Retry";
        if (r2.ok) setTimeout(loadLeads, 600); else alert(r2.error || "Could not save.");
      }));
    }

    async function loadUsers() {
      const box = document.getElementById("users");
      const r = await api("/api/admin/users");
      if (!r.ok) { box.innerHTML = `<p class="portal-msg error">${esc(r.error)}</p>`; return; }
      if (!r.users.length) { box.innerHTML = `<div class="portal-empty">No customer accounts yet.</div>`; return; }
      box.innerHTML = `<div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th></tr></thead><tbody>${
        r.users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone || "")}</td><td>${esc(fmtDate(u.created_at))}</td></tr>`).join("")
      }</tbody></table></div>`;
    }
  }

  if (page === "login") initLogin();
  else if (page === "dashboard") initDashboard();
  else if (page === "admin") initAdmin();
})();
