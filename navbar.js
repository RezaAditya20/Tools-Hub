// Shared sidebar — dipakai index.html + semua page/*.html.
// Edit di sini → apply ke semua. Icon ngikutin Tools Hub (sama persis).
(function () {
  // Cegah browser restore posisi scroll lama (bikin page "geser" saat refresh)
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);

  const mount = document.getElementById("navbar");
  if (!mount) return;

  // Sembunyikan navbar di halaman Tools Hub (index.html)
  if (location.pathname.split("/").pop() === "index.html") {
    mount.remove();
    // Tandai: keluar dari halaman TANPA navbar → page tujuan jangan animasi shrink.
    localStorage.removeItem("nav-from-page");
    return;
  }

  // Path relatif ke root (index.html). Dari page/ pakai "../", dari root "".
  const ROOT = location.pathname.includes("/page/") ? "../" : "";
  const current = location.pathname.split("/").pop();

  // Daftar tool — icon = Lucide icon name, diwarnai via --icon-bg.
  const TOOLS = [
    { label: "Data Comparer", href: "page/Data-Comparer.html", c1: "#f87171", icon: "table-2", cat: "Data & Comparison" },
    { label: "Excel Compare", href: "page/Excel-Compare.html", c1: "#34d399", icon: "file-spreadsheet", cat: "Data & Comparison" },
    { label: "Subject Comparer", href: "page/Subject-Comparer.html", c1: "#c084fc", icon: "layers", cat: "Data & Comparison" },
    { label: "Query Data Update", href: "page/Query-Data-Update.html", c1: "#818cf8", icon: "database", cat: "Data & Comparison" },
    { label: "Document Scanner", href: "page/Document-Scanner.html", c1: "#34d399", icon: "scan", cat: "Documents & OCR" },
    { label: "OCR", href: "page/OCR.html", c1: "#38bdf8", icon: "scan-eye", cat: "Documents & OCR" },
    { label: "HTML Report Inspector", href: "page/HTML-Report-Inspector.html", c1: "#f472b6", icon: "file-code", cat: "Documents & OCR" },
    { label: "Extract Subjects", href: "page/Extract-Subjects.html", c1: "#fb923c", icon: "folder-tree", cat: "Academic" },
    { label: "Kalender Akademik", href: "page/Kalender-Akademik.html", c1: "#60a5fa", icon: "calendar", cat: "Academic" },
    { label: "Address Fixer", href: "page/Address-Fixer.html", c1: "#f87171", icon: "map-pin", cat: "Utilities" },
    { label: "Fix Name", href: "page/Fix-Name.html", c1: "#f472b6", icon: "user-pen", cat: "Utilities" },
    { label: "Username Maker", href: "page/Username-Maker.html", c1: "#22d3ee", icon: "user", cat: "Utilities" },
    { label: "Variable Python", href: "page/Variable-Python.html", c1: "#60a5fa", icon: "code", cat: "Utilities" },
    { label: "Date Formatter", href: "page/Date-Formatter.html", c1: "#fbbf24", icon: "calendar-days", cat: "Utilities" },
  ];

  function getHidden() {
    if (window.Settings) return Settings.get("tools-hidden", []);
    try {
      return JSON.parse(localStorage.getItem("tools-hidden") || "[]");
    } catch {
      return [];
    }
  }

  function buildItems() {
    const nav = mount.querySelector(".nav-items");
    if (!nav) return;
    const hidden = getHidden();
    const filtered = TOOLS
      .filter((t) => hidden.indexOf(t.label) === -1);

    /* Group by category */
    const catOrder = ["Data & Comparison", "Documents & OCR", "Academic", "Utilities"];
    const grouped = {};
    filtered.forEach((t) => {
      const c = t.cat || "Lainnya";
      if (!grouped[c]) grouped[c] = [];
      grouped[c].push(t);
    });

    let items = "";
    catOrder.forEach((cat) => {
      const tools = grouped[cat];
      if (!tools || !tools.length) return;
      tools.sort((a, b) => a.label.localeCompare(b.label, "id"));
      items += `<div class="nav-category">${cat}</div>`;
      tools.forEach((t) => {
        const active = current && t.href.split("/").pop() === current ? " active" : "";
        items += `<a class="nav-item${active}" href="${ROOT}${t.href}" style="--icon-bg:${t.c1}">
          <span class="nav-ico"><i data-lucide="${t.icon}"></i></span>
          <span class="label">${t.label}</span>
        </a>`;
      });
    });
    nav.innerHTML = items;
    const s = mount.querySelector("#nav-search");
    if (s) s.placeholder = "Cari program...";
    applySearchFilter();
  }

  mount.className = "navbar";
  mount.innerHTML = `
    <div class="nav-top">
      <a class="nav-brand" href="${ROOT}index.html">Tools Hub</a>
    </div>
    <div class="nav-search-wrap">
      <svg class="nav-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
      <input class="nav-search" id="nav-search" type="text" placeholder="Cari program..." autocomplete="off" />
    </div>
    <nav class="nav-items"></nav>
  `;

  // Load Lucide Icons
  const lucideScript = document.createElement("script");
  lucideScript.src = "https://unpkg.com/lucide@latest/dist/umd/lucide.js";
  lucideScript.onload = () => { if (window.lucide) lucide.createIcons(); };
  document.head.appendChild(lucideScript);

  function refreshIcons() { if (window.lucide) lucide.createIcons(); }

  // Isi item (sudah difilter hide) + sync saat berubah
  buildItems();
  refreshIcons();
  /* Scroll sidebar ke item active */
  const activeItem = mount.querySelector(".nav-item.active");
  if (activeItem) activeItem.scrollIntoView({ block: "center", behavior: "instant" });
  window.addEventListener("tools-hidden-change", () => { buildItems(); refreshIcons(); });

  // Tampilkan navbar SEKETIKA setelah build (sinkron) — jangan via setTimeout.
  // Class ini (opacity:1) harus sudah ada saat collapse-warm dilepas, supaya
  // navbar tidak kembali ke state base opacity:0 (penyebab kedip di semua halaman).
  mount.classList.add("loaded");

  // ── Scroll: padding + fade band + subtitle collapse (shared, all pages) ──
  // navbar.js di-load SEBELUM .topbar diparse → tunggu DOM siap dulu.
  (function () {
    function initScroll() {
      const topbar = document.querySelector(".topbar");
      if (!topbar) return;
      let ticking = false;
      // Hysteresis: nyala di >12px, mati di <4px → cegah kedip pas scroll mondar-mandir di atas.
      function onScroll() {
        const y = window.scrollY || document.documentElement.scrollTop || 0;
        const compact = topbar.classList.contains("scroll-compact");
        const next = compact ? y > 4 : y > 12;
        topbar.classList.toggle("scroll-compact", next);
        ticking = false;
      }
      window.addEventListener(
        "scroll",
        () => {
          if (!ticking) {
            ticking = true;
            requestAnimationFrame(onScroll);
          }
        },
        { passive: true }
      );
      onScroll();
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initScroll);
    } else {
      initScroll();
    }
  })();

  // ── Search filter item ──
  function applySearchFilter() {
    const searchInput = mount.querySelector("#nav-search");
    if (!searchInput) return;
    const q = searchInput.value.trim().toLowerCase();
    mount.querySelectorAll(".nav-item").forEach((a) => {
      const label = (a.querySelector(".label") || {}).textContent || "";
      a.style.display = label.toLowerCase().includes(q) ? "" : "none";
    });
    /* Hide category headers when all their items are hidden */
    mount.querySelectorAll(".nav-category").forEach((cat) => {
      let next = cat.nextElementSibling;
      let hasVisible = false;
      while (next && !next.classList.contains("nav-category")) {
        if (next.classList.contains("nav-item") && next.style.display !== "none") hasVisible = true;
        next = next.nextElementSibling;
      }
      cat.style.display = hasVisible ? "" : "none";
    });
  }

  mount.querySelector("#nav-search").addEventListener("input", applySearchFilter);


  // Burger (muncul < 1048px, toggle sidebar) — auto-close saat pointer keluar
  const burger = document.createElement("button");
  burger.className = "nav-burger";
  burger.setAttribute("aria-label", "Buka menu");
  burger.innerHTML = '<i class="fa-regular fa-bars"></i>';
  document.body.appendChild(burger);
  burger.addEventListener("click", () => mount.classList.toggle("open"));
  let overBurger = false,
    overNav = false,
    closeTimer = null;
  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!overBurger && !overNav) mount.classList.remove("open");
    }, 120);
  }
  burger.addEventListener("mouseleave", () => {
    overBurger = false;
    scheduleClose();
  });
  mount.addEventListener("mouseenter", () => {
    clearTimeout(closeTimer);
    overNav = true;
  });
  mount.addEventListener("mouseleave", () => {
    overNav = false;
    scheduleClose();
  });
  // Pointer agak di tepi kiri → langsung buka (tanpa hover burger).
  document.addEventListener("mousemove", (e) => {
    const near = e.clientX <= 24;
    if (near) {
      clearTimeout(closeTimer);
      overBurger = true;
      mount.classList.add("open");
    } else if (overBurger) {
      // keluar dari zona tepi kiri → lepas flag, biarkan scheduleClose nutup
      overBurger = false;
      scheduleClose();
    }
  });
  // Tutup sidebar (mobile). Item lain navigasi sendiri; klik item aktif di halaman
  // yang SAMA tidak navigasi → langsung tutup biar konsisten dengan pindah halaman.
  mount.querySelectorAll(".nav-item").forEach((a) =>
    a.addEventListener("click", () => {
      mount.classList.remove("open");
    })
  );
})();
