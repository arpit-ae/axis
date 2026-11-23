/* Site-wide lightweight motion and a single email-first contact action. */
(() => {
  "use strict";
  function start() {
    if (!document.querySelector(".send-float") && !document.querySelector(".account-page")) {
      const send = document.createElement("a");
      send.className = "send-float";
      send.href = (location.pathname === "/" || location.pathname === "/index.html") ? "#contact" : "/index.html#contact";
      send.setAttribute("aria-label", "Send a message to GOAXIS");
      send.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg><span>Send</span>';
      document.body.appendChild(send);
    }
    const targetSelectors = ".hero-copy, .hero .visual, .p2-hero .container, .premium-hero .container, .section-head, .card, .price-tile, .form-box, .p2-form, .bundle-grid, .mini-feature, .premium-steps > div, .faq-layout details";
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && "IntersectionObserver" in window) {
      const targets = Array.from(document.querySelectorAll(targetSelectors));
      targets.forEach(el => el.classList.add("aurora-reveal"));
      const observer = new IntersectionObserver((entries, obs) => {
        for (const item of entries) {
          if (item.isIntersecting) {
            item.target.classList.add("is-visible");
            obs.unobserve(item.target);
          }
        }
      }, { threshold: 0.08, rootMargin: "0px 0px -28px 0px" });
      targets.forEach(el => observer.observe(el));
      // Apply hidden styles only after the observer is available.
      document.documentElement.classList.add("aurora-motion");
      requestAnimationFrame(() => {
        for (const el of targets) {
          const b = el.getBoundingClientRect();
          if (b.top < window.innerHeight && b.bottom > 0) el.classList.add("is-visible");
        }
      });
    }
    const nav = document.getElementById("primary-nav");
    if (nav) {
      nav.querySelectorAll("a").forEach(a => {
        a.addEventListener("click", () => {
          nav.classList.remove("open");
          const toggle = document.querySelector(".menu-toggle");
          if (toggle) toggle.setAttribute("aria-expanded", "false");
        });
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
