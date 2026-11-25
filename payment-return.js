import { addressText, rupees } from "./catalog.js";
import { deliveryDetails, detailList, element, forgetKey, itemList, showReceipt } from "./receipt-ui.js";

const title = document.getElementById("title");
const status = document.getElementById("status");
const details = document.getElementById("details");
const check = document.getElementById("check-status");
const open = document.getElementById("open-receipt");
const id = new URLSearchParams(location.search).get("order_id");
let token = new URLSearchParams(location.hash.slice(1)).get("receipt") || "";
try {
  if (token) sessionStorage.setItem("goaxis-receipt-" + id, token);
  else token = sessionStorage.getItem("goaxis-receipt-" + id) || "";
} catch {}
if (token && location.hash) history.replaceState(null, "", location.pathname + location.search);
let attempt = 0, timer, busy = false, shown = false, view, latest;
function contents() {
  const { order, receipt } = latest;
  const nodes = [detailList([["Receipt number", receipt.number], ["Total paid", rupees(order.order_amount)]])];
  if (receipt.items) nodes.push(itemList(receipt.items, order.order_amount));
  if (receipt.address) nodes.push(detailList([["Delivery address", addressText(receipt.address)]]));
  nodes.push(element("h3", "Receipt emails"), deliveryDetails(receipt.delivery, receipt.customer_email, receipt.owner_email));
  return nodes;
}
function openReceipt() { view = showReceipt("Payment confirmed", contents()); }
open.addEventListener("click", openReceipt);
async function verify() {
  if (busy) return;
  clearTimeout(timer);
  let poll = false;
  busy = true;
  check.disabled = true;
  try {
    const response = await fetch("/api/cashfree/order/" + encodeURIComponent(id), { cache: "no-store", headers: token ? { "X-Receipt-Token": token } : {} });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Payment verification is unavailable.");
    const state = data.order.verified_status;
    if (state === "PAID" && data.receipt) {
      forgetKey("checkout");
      latest = data;
      const mail = data.receipt.delivery;
      title.textContent = "Payment confirmed";
      status.textContent = mail.owner === "sent" && mail.customer === "sent"
        ? "Cashfree verified your payment. Receipt emails were sent to you and GOAXIS."
        : "Cashfree verified your payment. The email status for each copy appears below.";
      status.className = "status-box success";
      details.replaceChildren(...contents()); open.hidden = false;
      if (!shown) { shown = true; openReceipt(); }
      else if (view?.dialog.open) view.body.replaceChildren(...contents());
      poll = mail.owner === "pending" || mail.customer === "pending";
    } else {
      poll = ["ACTIVE", "PENDING", "TERMINATION_REQUESTED"].includes(state);
      title.textContent = poll ? "Payment pending" : "Payment was not completed";
      status.textContent = poll ? "Cashfree has not confirmed payment yet. You can check the status again here." : "Cashfree order status: " + state;
      status.className = "status-box " + (poll ? "pending" : "failed");
      details.replaceChildren(detailList([["Order number", data.order.order_id]]));
    }
  } catch (error) {
    title.textContent = latest ? "Payment confirmed" : "Unable to check payment";
    status.textContent = error.message || "Please check the payment status again.";
    poll = true;
  } finally {
    busy = false; check.disabled = false; check.hidden = !poll;
    if (poll && ++attempt < 8) timer = setTimeout(verify, Math.min(15000, 1500 * attempt));
  }
}
check.addEventListener("click", () => { attempt = 0; verify(); });
if (id && /^GOAXIS_[A-Z0-9_]{1,64}$/.test(id)) verify();
else { title.textContent = "Order number needed"; status.textContent = "Open the return link for your GOAXIS payment."; }
