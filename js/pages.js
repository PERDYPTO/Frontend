(function () {
  const body = document.body;
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navMenu = document.querySelector("[data-nav-menu]");
  const currentPage = body ? body.dataset.page : "";

  function closeMenu() {
    if (!navToggle || !navMenu) return;
    navToggle.classList.remove("is-open");
    navMenu.classList.remove("is-open");
    body.classList.remove("nav-open");
    navToggle.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    if (!navToggle || !navMenu) return;
    const isOpen = navToggle.classList.toggle("is-open");
    navMenu.classList.toggle("is-open", isOpen);
    body.classList.toggle("nav-open", isOpen);
    navToggle.setAttribute("aria-expanded", String(isOpen));
  }

  if (navToggle) {
    navToggle.addEventListener("click", toggleMenu);
  }

  document.querySelectorAll("[data-nav-link]").forEach((link) => {
    if (link.dataset.navLink === currentPage) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }

    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      const targetId = anchor.getAttribute("href");
      if (!targetId || targetId === "#") return;

      const target = document.querySelector(targetId);
      if (!target) return;

      event.preventDefault();
      closeMenu();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
})();
