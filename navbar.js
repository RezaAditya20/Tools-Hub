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

  // Daftar tool — icon = FontAwesome regular (class name), diwarnai via --icon-bg.
  const TOOLS = [
    { label: "Data Comparer", href: "page/Data-Comparer.html", c1: "#f87171", icon: "fa-table" },
    { label: "Excel Compare", href: "page/Excel-Compare.html", c1: "#34d399", icon: "fa-table-cells" },
    { label: "Extract Subjects", href: "page/Extract-Subjects.html", c1: "#fb923c", icon: "fa-folder-tree" },
    { label: "Fix Name", href: "page/Fix-Name.html", c1: "#f472b6", icon: "fa-user-pen" },
    { label: "Kalender Akademik", href: "page/Kalender-Akademik.html", c1: "#60a5fa", icon: "fa-calendar" },
    { label: "Query Data Update", href: "page/Query-Data-Update.html", c1: "#818cf8", icon: "fa-database" },
    { label: "School Notes & To Do", href: "page/School-Notes-&-To-Do.html", c1: "#2dd4bf", icon: "fa-notebook" },
    { label: "Subject Comparer", href: "page/Subject-Comparer.html", c1: "#c084fc", icon: "fa-layer-group" },
    { label: "Username Maker", href: "page/Username-Maker.html", c1: "#22d3ee", icon: "fa-user" },
    { label: "Variable Python", href: "page/Variable-Python.html", c1: "#60a5fa", icon: "fa-code" },
    { label: "HTML Report Inspector", href: "page/HTML-Report-Inspector.html", c1: "#f472b6", icon: "fa-file-code" },
    { label: "OCR", href: "page/OCR.html", c1: "#38bdf8", icon: "fa-camera" },
    { label: "Document Scanner", href: "page/Document-Scanner.html", c1: "#34d399", icon: "fa-crop-simple" },
  ];

  function getHidden() {
    try {
      return JSON.parse(localStorage.getItem("tools-hidden") || "[]");
    } catch {
      return [];
    }
  }
  function escapeHtml(s) {
    return (s || "").replace(/[&<"'>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }

  // ── School Notes: navbar jadi daftar catatan (view 2 & 3) ──
  let snState = { view: "home", schoolId: null, activeNoteId: null };
  const isSchoolNotes = location.pathname.split("/").pop() === "School-Notes-&-To-Do.html";
  function getSchoolNotes() {
    try {
      return JSON.parse(localStorage.getItem("school-notes-db") || "{}");
    } catch {
      return {};
    }
  }
  function buildNoteItems() {
    const school = getSchoolNotes()[snState.schoolId];
    if (!school) return "";
    const notes = (school.notes || [])
      .filter((n) => !n.done)
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    let html = "";
    notes.forEach((n) => {
      const active = n.id === snState.activeNoteId ? " active" : "";
      html += `<a class="nav-item${active}" data-note-id="${n.id}" style="--icon-bg:#2dd4bf"><span class="nav-ico"><i class="fa-regular fa-note-sticky"></i></span><span class="label">${escapeHtml(n.text)}</span></a>`;
    });
    return html;
  }

  function buildSchoolItems() {
    const db = getSchoolNotes();
    const schools = Object.keys(db)
      .map((id) => ({ id, school: db[id] }))
      .sort((a, b) => (a.school.order || 0) - (b.school.order || 0));
    let html = "";
    schools.forEach(({ id, school }) => {
      const active = id === snState.schoolId ? " active" : "";
      const count = (school.notes || []).filter((n) => !n.done).length;
      const locked = !!school.pin;
      html += `<a class="nav-item${active}" data-school-id="${id}"${locked ? ' data-locked="1"' : ""} style="--icon-bg:#22d3ee"><span class="nav-ico"><i class="fa-regular fa-school"></i></span><span class="label">${escapeHtml(school.name)}${count ? ` <span style="opacity:.6">(${count})</span>` : ""}</span></a>`;
    });
    return html;
  }

  function buildItems() {
    const nav = mount.querySelector(".nav-items");
    if (!nav) return;
    if (isSchoolNotes && snState.schoolId && snState.view === "desc") {
      nav.innerHTML = buildNoteItems();
      const s = mount.querySelector("#nav-search");
      if (s) s.placeholder = "Cari catatan...";
      return;
    }
    if (isSchoolNotes && snState.schoolId && snState.view === "detail") {
      nav.innerHTML = buildSchoolItems();
      const s = mount.querySelector("#nav-search");
      if (s) s.placeholder = "Cari sekolah...";
      return;
    }
    const hidden = getHidden();
    const items = TOOLS
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label, "id"))
      .filter((t) => hidden.indexOf(t.label) === -1)
      .map((t) => {
        const active = current && t.href.split("/").pop() === current ? " active" : "";
        return `<a class="nav-item${active}" href="${ROOT}${t.href}" style="--icon-bg:${t.c1}">
          <span class="nav-ico"><i class="fa-regular ${t.icon}"></i></span>
          <span class="label">${t.label}</span>
        </a>`;
      })
      .join("");
    nav.innerHTML = items;
    const s = mount.querySelector("#nav-search");
    if (s) s.placeholder = "Cari program...";
  }

  mount.className = "navbar";
  mount.innerHTML = `
    <div class="nav-top">
      <div class="nav-footer-left">
        <a class="nav-home" href="${ROOT}index.html" title="Beranda">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </a>
        <button class="theme-toggle" id="theme-toggle" aria-label="Ganti tema">
          <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
          <span id="theme-label">Mode Terang</span>
        </button>
      </div>
      <button class="nav-collapse-btn" id="nav-collapse-btn" title="Ciutkan/Perlebar" aria-label="Ciutkan atau perlebar navbar">
        <i class="fa-regular fa-bars"></i>
      </button>
    </div>
    <input class="nav-search" id="nav-search" type="text" placeholder="Cari program..." autocomplete="off" />
    <nav class="nav-items"></nav>
  `;

  // Isi item (sudah difilter hide) + sync saat berubah
  buildItems();
  window.addEventListener("tools-hidden-change", buildItems);

  // ── School Notes: klik item catatan → beritahu page ──
  const navEl = mount.querySelector(".nav-items");
  if (navEl) {
    navEl.addEventListener("click", (e) => {
      const item = e.target.closest(".nav-item");
      if (!item) return;
      // Item School Notes → handle via custom event (jangan navigasi link)
      if (item.dataset.schoolId || item.dataset.noteId) {
        e.preventDefault();
        if (item.dataset.schoolId) {
          window.dispatchEvent(new CustomEvent("sn-nav", { detail: { action: "school", schoolId: item.dataset.schoolId } }));
        } else if (item.dataset.noteId) {
          window.dispatchEvent(new CustomEvent("sn-nav", { detail: { action: "note", noteId: item.dataset.noteId } }));
        }
      }
    });
  }

  // ── School Notes: page kabari navbar soal view/sekolah/catatan aktif ──
  window.addEventListener("sn-view", (e) => {
    const d = e.detail || {};
    if (d.view !== undefined) snState.view = d.view;
    if (d.schoolId !== undefined) snState.schoolId = d.schoolId;
    if (d.activeNoteId !== undefined) snState.activeNoteId = d.activeNoteId;
    buildItems();
  });

  // Tampilkan navbar SEKETIKA setelah build (sinkron) — jangan via setTimeout.
  // Class ini (opacity:1) harus sudah ada saat collapse-warm dilepas, supaya
  // navbar tidak kembali ke state base opacity:0 (penyebab kedip di semua halaman).
  mount.classList.add("loaded");

  // ── Scroll: blur gradual + fade band + subtitle collapse (shared, all pages) ──
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
        const b = Math.min(20, (y / 120) * 20); // 0px → 20px over 120px
        topbar.style.backdropFilter = `saturate(180%) blur(${b}px)`;
        topbar.style.webkitBackdropFilter = `saturate(180%) blur(${b}px)`;
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

  // ── Theme toggle (single source — sidebar only) ──
  (function () {
    const root = document.documentElement;
    const toggle = mount.querySelector("#theme-toggle");
    if (!toggle) return;
    const label = toggle.querySelector("#theme-label");
    const sun = toggle.querySelector(".icon-sun");
    const moon = toggle.querySelector(".icon-moon");
    function applyTheme(t) {
      root.setAttribute("data-theme", t);
      try { localStorage.setItem("theme", t); } catch (e) {}
      if (t === "light") {
        if (sun) sun.style.display = "none";
        if (moon) moon.style.display = "inline";
        if (label) label.textContent = "Mode Gelap";
      } else {
        if (sun) sun.style.display = "inline";
        if (moon) moon.style.display = "none";
        if (label) label.textContent = "Mode Terang";
      }
    }
    let saved;
    try { saved = localStorage.getItem("theme"); } catch (e) {}
    applyTheme(saved || "dark");
    toggle.addEventListener("click", () => {
      toggle.classList.remove("is-switching");
      void toggle.offsetWidth;
      toggle.classList.add("is-switching");
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      toggle.blur();
      if (window.triggerThemeSplash) window.triggerThemeSplash(toggle, next, applyTheme);
      else applyTheme(next);
    });
  })();

  // ── Collapse / uncollapse ──
  const collapseBtn = mount.querySelector("#nav-collapse-btn");
  const searchInput = mount.querySelector("#nav-search");
  const footer = mount.querySelector(".nav-footer");
  let collapsed = false;
  try { collapsed = localStorage.getItem("nav-collapsed") === "1"; } catch (e) {}
  if (collapsed) mount.classList.add("collapsed");
  collapseBtn.addEventListener("click", () => {
    collapsed = !collapsed;
    mount.classList.toggle("collapsed", collapsed);
    try { localStorage.setItem("nav-collapsed", collapsed ? "1" : "0"); } catch (e) {}
  });

  // ── Search filter item ──
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    mount.querySelectorAll(".nav-item").forEach((a) => {
      const label = (a.querySelector(".label") || {}).textContent || "";
      a.style.display = label.toLowerCase().includes(q) ? "" : "none";
    });
  });


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
  burger.addEventListener("mouseenter", () => {
    clearTimeout(closeTimer);
    overBurger = true;
    mount.classList.add("open");
  });
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
  // Tutup sidebar (mobile). Item lain navigasi sendiri; klik item aktif di halaman
  // yang SAMA tidak navigasi → langsung tutup biar konsisten dengan pindah halaman.
  mount.querySelectorAll(".nav-item").forEach((a) =>
    a.addEventListener("click", () => {
      mount.classList.remove("open");
    })
  );
})();
