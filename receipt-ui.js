import { rupees } from "./catalog.js";

export function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

export function detailList(rows) {
  const list = element("dl", undefined, "receipt-details");
  for (const [label, value] of rows) {
    if (!value) continue;
    list.append(element("dt", label), element("dd", value));
  }
  return list;
}

export function itemList(items, total) {
  const section = element("section", undefined, "receipt-items");
  section.append(element("h3", "Order items"));
  const list = element("ul");
  for (const item of items) {
    const row = element("li");
    row.append(element("span", item.title + " × " + item.quantity), element("strong", rupees(item.price * item.quantity)));
    list.append(row);
  }
  const sum = element("p", undefined, "receipt-total");
  sum.append(element("span", "Total (INR)"), element("strong", rupees(total)));
  section.append(list, sum);
  return section;
}

export function deliveryDetails(delivery, email, owner) {
  const status = state => ({ sent: "Sent", pending: "Queued", attention: "Needs attention" })[state] || "Queued";
  const rows = [["Customer copy", [email, status(delivery.customer)].filter(Boolean).join(" · ")],
    ["GOAXIS copy", [owner, status(delivery.owner)].filter(Boolean).join(" · ")]];
  return detailList(rows);
}

function popup(title, content, confirmLabel, backLabel) {
  const dialog = element("dialog", undefined, "receipt-dialog");
  const heading = element("h2", title);
  heading.id = "receipt-title-" + crypto.randomUUID();
  heading.tabIndex = -1;
  dialog.setAttribute("aria-labelledby", heading.id);
  const body = element("div", undefined, "receipt-body");
  body.append(...content);
  const actions = element("div", undefined, "receipt-actions");
  if (backLabel) {
    const edit = element("button", backLabel, "button button-secondary");
    edit.type = "button";
    edit.addEventListener("click", () => dialog.close("edit"));
    actions.append(edit);
  }
  const confirm = element("button", confirmLabel, "button");
  confirm.type = "button";
  confirm.addEventListener("click", () => dialog.close("confirm"));
  actions.append(confirm);
  const promise = new Promise(resolve => dialog.addEventListener("close", () => {
    dialog.remove();
    resolve(dialog.returnValue === "confirm");
  }, { once: true }));
  dialog.append(heading, body, actions);
  document.body.append(dialog);
  dialog.showModal();
  heading.focus({ preventScroll: true });
  return { dialog, body, promise };
}
export function review(title, content, confirmLabel) {
  return popup(title, content, confirmLabel, "Edit details").promise;
}
export function showReceipt(title, content) {
  return popup(title, content, "Done");
}

// Store a digest and a retry key only. A lost response can be retried after a reload.
const memory = new Map();
export async function requestKey(scope, payload) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  const digest = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
  const name = "goaxis-draft-" + scope;
  let value = memory.get(name);
  try { value ??= JSON.parse(sessionStorage.getItem(name)); } catch {}
  if (!value || value.digest !== digest) value = { digest, key: crypto.randomUUID() };
  memory.set(name, value);
  try { sessionStorage.setItem(name, JSON.stringify(value)); } catch {}
  return value.key;
}
export function forgetKey(scope) {
  const name = "goaxis-draft-" + scope;
  memory.delete(name);
  try { sessionStorage.removeItem(name); } catch {}
}
export async function post(url, body) {
  const res = await fetch(url, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || !result.ok) {
    const error = new Error(result.error || "Could not confirm this request. Please try again.");
    error.code = result.code;
    throw error;
  }
  return result;
}
