(function () {
  "use strict";
  const PHONE = "919471990669";
  const GENERIC_URL = "https://wa.me/" + PHONE + "?text=" + encodeURIComponent("Hello GOAXIS CONSULTANCY, I would like to enquire about your services.");
  const labels = {
    name: "Full name",
    email: "Email address",
    phone: "Phone number",
    service: "Service of interest",
    businessName: "Business name",
    businessType: "Business type",
    message: "Requirement",
    details: "Requirement",
    consent: "Permission to contact"
  };

  function fieldLabel(name) {
    return labels[name] || name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase());
  }

  function getEnquiryForms() {
    return Array.from(document.querySelectorAll("#enquiry-form, #service-enquiry-form"));
  }

  function hasEnteredData(form) {
    return Array.from(form.querySelectorAll("input, select, textarea")).some(el => {
      if (!el.name || /^(website|password|confirmPassword|csrf|token)$/i.test(el.name)) return false;
      if (el.type === "checkbox" || el.type === "radio") return el.checked && el.name !== "consent";
      if (el.type === "hidden") return false;
      return String(el.value || "").trim().length > 0;
    });
  }

  function buildFormUrl(form) {
    const formData = new FormData(form);
    const lines = [
      "Hello GOAXIS CONSULTANCY, I would like to make an enquiry.",
      "",
      "ENQUIRY DETAILS"
    ];
    const seen = new Set();

    for (const [name, rawValue] of formData.entries()) {
      if (/^(website|password|confirmPassword|csrf|token)$/i.test(name)) continue;
      if (rawValue instanceof File) continue;
      if (seen.has(name)) continue;
      seen.add(name);

      if (name === "consent") {
        const consent = form.querySelector('input[name="consent"]');
        lines.push(fieldLabel(name) + ": " + (consent && consent.checked ? "Yes" : "No"));
        continue;
      }

      const value = String(rawValue || "").trim();
      if (!value) continue;
      lines.push(fieldLabel(name) + ": " + value);
    }

    lines.push("", "Website page: " + window.location.href);
    lines.push("Please reply to the customer about this enquiry.");
    return "https://wa.me/" + PHONE + "?text=" + encodeURIComponent(lines.join("\n"));
  }

  function openForm(form) {
    const url = buildFormUrl(form);
    window.open(url, "_blank");
    return url;
  }

  window.goaxisWhatsApp = { buildFormUrl, openForm };

  document.addEventListener("DOMContentLoaded", function () {
    let button = document.querySelector(".wa-float");
    if (!button) {
      button = document.createElement("a");
      button.className = "wa-float";
      button.innerHTML = '<span class="wa-icon" aria-hidden="true">◉</span><span class="wa-label">WhatsApp</span>';
      button.setAttribute("aria-label", "Chat with GOAXIS on WhatsApp");
      document.body.appendChild(button);
    }
    button.href = GENERIC_URL;
    button.target = "_blank";
    button.rel = "noopener noreferrer";
    button.addEventListener("click", function () {
      const form = getEnquiryForms().filter(hasEnteredData).sort((a, b) => {
        const count = f => Array.from(f.querySelectorAll("input, select, textarea")).filter(el =>
          el.name && !/^(website|password|confirmPassword|csrf|token|consent)$/i.test(el.name) &&
          el.type !== "hidden" && String(el.value || "").trim()
        ).length;
        return count(b) - count(a);
      })[0];
      button.href = form ? buildFormUrl(form) : GENERIC_URL;
    });
  });
})();