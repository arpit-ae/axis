import { detailList, deliveryDetails, element, forgetKey, post, requestKey, review, showReceipt } from "./receipt-ui.js";

for (const form of document.querySelectorAll("#enquiry-form, #service-enquiry-form")) {
  const feedback = form.querySelector("#form-feedback, #service-feedback, .form-feedback");
  const button = form.querySelector('button[type="submit"]');
  const trap = element("input");
  trap.name = "website";
  trap.tabIndex = -1;
  trap.autocomplete = "off";
  trap.setAttribute("aria-hidden", "true");
  trap.style.cssText = "position:absolute;left:-10000px;width:1px;height:1px";
  form.append(trap);
  let busy = false;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    const data = new FormData(form);
    const field = name => String(data.get(name) || "").trim();
    const payload = { name: field("name"), email: field("email"), phone: field("phone"), service: field("service"),
      businessName: field("businessName"), businessType: field("businessType"), message: field("message") || field("details"),
      consent: form.querySelector('[name="consent"]').checked, website: field("website") };
    const rows = [["Name", payload.name], ["Email", payload.email], ["Phone", payload.phone], ["Service", payload.service],
      ["Business", payload.businessName], ["Business type", payload.businessType], ["Message", payload.message]];
    try {
      if (!await review("Review your enquiry", [detailList(rows),
        element("p", "GOAXIS will email a copy to you and its enquiry team from contact@goaxis.in.")], "Confirm and send")) return;
      button.disabled = true;
      feedback.textContent = "Sending your enquiry…";
      const scope = "enquiry-" + form.id;
      const key = await requestKey(scope, payload);
      const send = () => post("/api/enquiry", { ...payload, request_id: key });
      const result = await send();
      const receipt = element("strong", result.reference);
      const summary = res => res.email_sent ? "Confirmation emails sent to you and GOAXIS." : "Your enquiry is saved. Each email’s status is shown below.";
      feedback.textContent = "Enquiry receipt " + result.reference + ". " + summary(result);
      const content = res => [receipt, element("p", summary(res)), deliveryDetails(res.delivery || {}, payload.email, res.owner_email || "GOAXIS")];
      const view = showReceipt("Enquiry received", content(result));
      if (!result.email_sent) {
        const check = element("button", "Check email status", "button button-secondary");
        check.type = "button";
        check.addEventListener("click", async () => {
          check.disabled = true;
          try {
            const latest = await send();
            view.body.replaceChildren(...content(latest));
            feedback.textContent = "Enquiry receipt " + latest.reference + ". " + summary(latest);
            if (!latest.email_sent) view.body.append(check);
          } catch { check.textContent = "Try checking again"; }
          finally { check.disabled = false; }
        });
        view.body.append(check);
      }
      form.reset();
      forgetKey(scope);
    } catch (error) {
      feedback.textContent = error.message || "Unable to confirm the enquiry. Please retry.";
    } finally { busy = false; button.disabled = false; }
  });
}
