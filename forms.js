document.addEventListener("DOMContentLoaded", () => {
  const forms = ["enquiry-form", "service-enquiry-form"]
    .map(id => document.getElementById(id))
    .filter(Boolean);

  for (const form of forms) {
    const feedback = form.querySelector("#form-feedback, #service-feedback, .form-feedback");
    const submit = form.querySelector('button[type="submit"]');

    // Bot honeypot; real users never see or fill this field.
    if (!form.querySelector('[name="website"]')) {
      const trap = document.createElement("div");
      trap.setAttribute("aria-hidden", "true");
      trap.style.cssText = "position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden";
      trap.innerHTML = '<label>Leave this field empty<input name="website" type="text" tabindex="-1" autocomplete="off"></label>';
      form.appendChild(trap);
    }

    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const data = new FormData(form);
      const requiredConsent = form.querySelector('input[type="checkbox"][required]');
      const payload = {
        name: String(data.get("name") || ""),
        email: String(data.get("email") || ""),
        phone: String(data.get("phone") || ""),
        service: String(data.get("service") || ""),
        businessName: String(data.get("businessName") || ""),
        businessType: String(data.get("businessType") || ""),
        message: String(data.get("message") || data.get("details") || ""),
        consent: Boolean(requiredConsent && requiredConsent.checked),
        website: String(data.get("website") || "")
      };

      if (feedback) {
        feedback.textContent = "Sending your enquiry securely…";
        feedback.setAttribute("data-state", "loading");
      }
      if (submit) {
        submit.disabled = true;
        submit.setAttribute("aria-busy", "true");
      }

      try {
        const response = await fetch("/api/enquiry", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
          throw new Error(result.error || "We could not send your enquiry. Please try again.");
        }
        if (feedback) {
          feedback.textContent = "Thank you. Your enquiry was received. Reference: " + result.reference;
          feedback.setAttribute("data-state", "success");
        }
        form.reset();
      } catch (error) {
        if (feedback) {
          feedback.textContent = error instanceof Error ? error.message : "Network error. Please try again.";
          feedback.setAttribute("data-state", "error");
        }
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.removeAttribute("aria-busy");
        }
      }
    });
  }
});
