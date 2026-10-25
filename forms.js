document.addEventListener("DOMContentLoaded", () => {
  const forms = ["enquiry-form", "service-enquiry-form"]
    .map(id => document.getElementById(id))
    .filter(Boolean);

  for (const form of forms) {
    const feedback = form.querySelector("#form-feedback, #service-feedback, .form-feedback");
    const submit = form.querySelector('button[type="submit"]');

    if (submit) {
      submit.textContent = "Send enquiry via WhatsApp ↗";
      submit.dataset.whatsappSubmit = "true";
    }

    // Bot honeypot; real users never see or fill this field.
    if (!form.querySelector('[name="website"]')) {
      const trap = document.createElement("div");
      trap.setAttribute("aria-hidden", "true");
      trap.style.cssText = "position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden";
      trap.innerHTML = '<label>Leave this field empty<input name="website" type="text" tabindex="-1" autocomplete="off"></label>';
      form.appendChild(trap);
    }

    let fallbackLink = form.querySelector(".wa-form-fallback");
    if (!fallbackLink) {
      fallbackLink = document.createElement("a");
      fallbackLink.className = "wa-form-fallback";
      fallbackLink.target = "_blank";
      fallbackLink.rel = "noopener noreferrer";
      fallbackLink.hidden = true;
      fallbackLink.textContent = "WhatsApp did not open? Tap here to open your prepared enquiry ↗";
      fallbackLink.style.cssText = "display:block;margin-top:10px;font-weight:700;color:#128c4a";
      if (feedback) feedback.insertAdjacentElement("afterend", fallbackLink);
      else form.appendChild(fallbackLink);
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

      // Open WhatsApp synchronously from the submit click so browsers are less likely to block it.
      let whatsappUrl = "";
      try {
        if (window.goaxisWhatsApp && typeof window.goaxisWhatsApp.openForm === "function") {
          whatsappUrl = window.goaxisWhatsApp.openForm(form);
        } else if (window.goaxisWhatsApp && typeof window.goaxisWhatsApp.buildFormUrl === "function") {
          whatsappUrl = window.goaxisWhatsApp.buildFormUrl(form);
          window.open(whatsappUrl, "_blank");
        }
      } catch (error) {
        if (window.goaxisWhatsApp && typeof window.goaxisWhatsApp.buildFormUrl === "function") {
          whatsappUrl = window.goaxisWhatsApp.buildFormUrl(form);
        }
      }

      if (whatsappUrl && fallbackLink) {
        fallbackLink.href = whatsappUrl;
        fallbackLink.hidden = false;
      }

      if (feedback) {
        feedback.textContent = "WhatsApp has been opened with your enquiry details. Please review them and press Send in WhatsApp. Saving a copy on this website too…";
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
          throw new Error(result.error || "We could not save a copy of your enquiry on the website.");
        }
        if (feedback) {
          feedback.textContent = "Website copy saved. Reference: " + result.reference + ". To send the WhatsApp message, press Send in WhatsApp.";
          feedback.setAttribute("data-state", "success");
        }
        form.reset();
      } catch (error) {
        if (feedback) {
          feedback.textContent = "Your details were prepared for WhatsApp. Please press Send there. Website copy could not be saved: " + (error instanceof Error ? error.message : "Network error.");
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