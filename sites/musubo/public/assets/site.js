const menuButton = document.querySelector(".menu-toggle");
const mobileNav = document.querySelector("#mobile-nav");
function closeMenu() {
  if (!menuButton || !mobileNav) return;
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "メニューを開く");
  mobileNav.hidden = true;
}
if (menuButton && mobileNav) {
  menuButton.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute(
      "aria-label",
      open ? "メニューを閉じる" : "メニューを開く",
    );
    mobileNav.hidden = !open;
  });
  mobileNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !mobileNav.hidden) {
      closeMenu();
      menuButton.focus();
    }
  });
  window.matchMedia("(min-width: 901px)").addEventListener("change", closeMenu);
}

const tabs = [...document.querySelectorAll("[data-demo]")];
tabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    tabs.forEach((other) => {
      const selected = other === tab;
      other.classList.toggle("is-active", selected);
      other.setAttribute("aria-pressed", String(selected));
    });
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tab.dataset.demo;
    });
  }),
);
