/* Shared accessible navigation; no WhatsApp floating buttons. */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".menu-toggle").forEach(button => {
    const nav = document.getElementById(button.getAttribute("aria-controls"));
    if (!nav) return;
    button.addEventListener("click", () => {
      const expanded = nav.classList.toggle("open");
      button.setAttribute("aria-expanded", String(expanded));
    });
    nav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
      nav.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
    }));
  });
  document.querySelectorAll("#current-year").forEach(item => item.textContent = String(new Date().getFullYear()));
});