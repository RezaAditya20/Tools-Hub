// Shared theme sync — semua file pakai key yang sama
(async function () {
  const KEY = "theme";
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");
  if (!toggle) return;
  const label = document.getElementById("theme-label");
  const sun = toggle.querySelector(".icon-sun");
  const moon = toggle.querySelector(".icon-moon");

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    if (theme === "light") {
      if (sun) sun.style.display = "none";
      if (moon) moon.style.display = "inline";
      if (label) label.textContent = "Mode Gelap";
    } else {
      if (sun) sun.style.display = "inline";
      if (moon) moon.style.display = "none";
      if (label) label.textContent = "Mode Terang";
    }
    Settings.set(KEY, theme);
  }

  // Load from server first, then apply
  await Settings.init();
  const saved = Settings.get(KEY);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "dark"));

  toggle.addEventListener("click", () => {
    toggle.classList.remove("is-switching");
    void toggle.offsetWidth;
    toggle.classList.add("is-switching");
    const current = root.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    toggle.blur();
    if (window.triggerThemeSplash) {
      window.triggerThemeSplash(toggle, next, applyTheme);
    } else {
      applyTheme(next);
    }
  });
})();
