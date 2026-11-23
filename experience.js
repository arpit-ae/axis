/* GOAXIS experience layer: gentle entrance motion + one email contact shortcut. */
document.addEventListener("DOMContentLoaded", () => {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!prefersReduced && "IntersectionObserver" in window) {
    const reveal = document.querySelectorAll(".card,.price-tile,.suite-feature,.premium-steps>div,.about-grid,.contact-grid,.suite-demo-grid");
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -16px 0px" });
    reveal.forEach((item, index) => {
      item.classList.add("is-reveal");
      item.style.setProperty("--item-delay", Math.min(index % 6, 5) * 75 + "ms");
      observer.observe(item);
    });
  }
  // A single unobtrusive CTA replaces the old messaging-app widget.
  if (!document.querySelector(".send-float") && !document.querySelector("#payment-form")) {
    const a = document.createElement("a");
    a.className = "send-float";
    a.href = document.querySelector("#enquiry-form") ? "#contact" : "index.html#contact";
    a.setAttribute("aria-label", "Open GOAXIS email enquiry form");
    const symbol = document.createElement("span");
    symbol.textContent = "✉";
    symbol.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = "Send";
    a.append(symbol, label);
    document.body.appendChild(a);
  }
});