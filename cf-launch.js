import { addressText, orderLines, packages, rupees } from "./catalog.js";
import { detailList, element, forgetKey, itemList, post, requestKey, review } from "./receipt-ui.js";

const form = document.getElementById("payment-form");
const button = document.getElementById("pay-button");
const message = document.getElementById("payment-message");
const params = new URLSearchParams(location.search);
const packageId = params.get("package") || "";
const field = name => form.elements.namedItem(name);
const selected = Object.hasOwn(packages, packageId) ? packages[packageId] : null;
if (packageId && !selected) {
  button.disabled = true;
  message.textContent = "This package is unavailable. Choose a current package from the website.";
}
function selectedIds() {
  return selected ? [packageId, ...Array.from(form.querySelectorAll('[name="extra"]:checked'), input => input.value)] : [];
}
if (selected) {
  field("purpose").value = selected.title;
  field("purpose").readOnly = true;
  field("amount").readOnly = true;
  form.closest(".pay-card").querySelector("h1").textContent = "Checkout";
  const choices = document.getElementById("extra-packages");
  choices.hidden = false;
  for (const [id, info] of Object.entries(packages)) {
    if (id === packageId) continue;
    const label = element("label", undefined, "extra-package");
    const checkbox = element("input");
    checkbox.type = "checkbox"; checkbox.value = id; checkbox.name = "extra";
    label.append(checkbox, element("span", info.title + " · " + rupees(info.amount)));
    choices.append(label);
  }
  const refresh = () => { field("amount").value = selectedIds().reduce((sum, id) => sum + packages[id].amount, 0).toFixed(2); };
  choices.addEventListener("change", refresh);
  refresh();
} else {
  for (const name of ["amount", "purpose"]) {
    if (params.has(name)) field(name).value = params.get(name);
  }
}
let busy = false;
let watchdog;
function reset() {
  clearTimeout(watchdog);
  busy = false;
  button.disabled = Boolean(packageId && !selected);
  button.textContent = "Review order";
}
function showError(error) {
  message.textContent = error?.message || "Could not open checkout. Please try again.";
  message.className = "pay-note pay-error";
  reset();
}
window.addEventListener("pageshow", event => { if (event.persisted) reset(); });
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || button.disabled) return;
  const india = /^(india|in)$/i.test(field("country").value.trim());
  field("postal").setCustomValidity(india && !/^[1-9]\d{5}$/.test(field("postal").value.trim()) ? "Enter a valid six-digit PIN code." : "");
  if (!form.reportValidity()) return;
  busy = true;
  const data = new FormData(form);
  const get = name => String(data.get(name) || "").trim();
  const address = Object.fromEntries(["line1", "line2", "city", "state", "postal", "country"].map(key => [key, get(key)]));
  const ids = selectedIds();
  const total = Number(get("amount"));
  const items = orderLines(ids, get("purpose"), total);
  const payload = { name: get("name"), email: get("email"), phone: get("phone"), amount: total.toFixed(2), purpose: get("purpose"), package_ids: ids, address };
  try {
    const confirmed = await review("Review your order", [itemList(items, total),
      detailList([["Customer", payload.name], ["Receipt email", payload.email], ["Phone", payload.phone], ["Delivery address", addressText(address)]])],
      "Continue to Cashfree");
    if (!confirmed) { reset(); return; }
    if (typeof window.Cashfree !== "function") throw new Error("Cashfree checkout could not load. Reload this page and try again.");
    button.disabled = true;
    message.className = "pay-note";
    message.textContent = "Preparing your secure checkout…";
    const request_id = await requestKey("checkout", payload);
    const result = await post("/api/cashfree/create-order", { ...payload, request_id });
    try { sessionStorage.setItem("goaxis-receipt-" + result.order_id, result.receipt_token); } catch {}
    if (result.paid) {
      location.assign("/payment-return.html?order_id=" + encodeURIComponent(result.order_id) + "#receipt=" + encodeURIComponent(result.receipt_token));
      return;
    }
    if (!result.payment_session_id || Number(result.total) !== total ||
        JSON.stringify(result.items) !== JSON.stringify(items)) throw new Error("The order details changed. Reload and review your order again.");
    const cashfree = window.Cashfree({ mode: result.environment === "sandbox" ? "sandbox" : "production" });
    button.textContent = "Opening Cashfree…";
    message.textContent = "Opening Cashfree secure checkout.";
    watchdog = setTimeout(() => showError(new Error("Checkout did not open. Please try again.")), 18000);
    const next = await cashfree.checkout({ paymentSessionId: result.payment_session_id, redirectTarget: "_self" });
    if (next?.error) showError(next.error);
  } catch (error) {
    if (error.code === "ORDER_CLOSED") forgetKey("checkout");
    showError(error);
  }
});
