// GOAXIS secure email-first enquiry flow. No messaging-app dependency.
document.addEventListener("DOMContentLoaded", () => {
  const forms = ["enquiry-form", "service-enquiry-form"]
    .map(id => document.getElementById(id)).filter(Boolean);

  for (const form of forms) {
    const feedback = form.querySelector("#form-feedback, #service-feedback, .form-feedback");
    const button = form.querySelector('button[type="submit"]');
    if (button) button.textContent = "Send →";

    // Honeypot avoids disrupting visitors while ignoring many automated submissions.
    if (!form.querySelector('[name="website"]')) {
      const trap = document.createElement("div");
      trap.setAttribute("aria-hidden", "true");
      trap.style.cssText = "position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden";
      const label = document.createElement("label");
      label.textContent = "Leave this field empty";
      const input = document.createElement("input");
      input.name = "website";
      input.type = "text";
      input.tabIndex = -1;
      input.autocomplete = "off";
      label.appendChild(input);
      trap.appendChild(label);
      form.appendChild(trap);
    }

    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!form.reportValidity() || (button && button.disabled)) return;
      const data = new FormData(form);
      const requiredConsent = form.querySelector('input[name="consent"][required]');
      const payload = {
        name: String(data.get("name") || "").trim(),
        email: String(data.get("email") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        service: String(data.get("service") || "").trim(),
        businessName: String(data.get("businessName") || "").trim(),
        businessType: String(data.get("businessType") || "").trim(),
        message: String(data.get("message") || data.get("details") || "").trim(),
        consent: Boolean(requiredConsent?.checked),
        website: String(data.get("website") || "")
      };
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.textContent = "Sending…";
      }
      if (feedback) {
        feedback.setAttribute("data-state", "loading");
        feedback.textContent = "Sending your enquiry securely…";
      }

      try {
        const response = await fetch("/api/enquiry", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
          throw new Error(result.error || "We couldn't send your enquiry. Please retry.");
        }
        if (feedback) {
          feedback.setAttribute("data-state", result.email_sent ? "success" : "warning");
          feedback.textContent = result.email_sent
            ? "Sent successfully! Reference " + result.reference + ". We have emailed GOAXIS and sent a confirmation to " + payload.email + "."
            : "Your enquiry was saved (" + result.reference + "), but email delivery isn't confirmed yet. Please contact contact@goaxis.in if urgent.";
        }
        form.reset();
      } catch (error) {
        if (feedback) {
          feedback.setAttribute("data-state", "error");
          feedback.textContent = error instanceof Error ? error.message : "Couldn't send your enquiry. Please retry.";
        }
      } finally {
        if (button) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
          button.textContent = "Send →";
        }
      }
    });
  }
});
