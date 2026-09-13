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
    { label: "School Notes & To Do", href: "page/School-Notes-&-To-Do.html", c1: "#2dd4bf", icon: "notebook-pen", cat: "Academic" },
    { label: "Fix Name", href: "page/Fix-Name.html", c1: "#f472b6", icon: "user-pen", cat: "Utilities" },
    { label: "Username Maker", href: "page/Username-Maker.html", c1: "#22d3ee", icon: "user", cat: "Utilities" },
    { label: "Variable Python", href: "page/Variable-Python.html", c1: "#60a5fa", icon: "code", cat: "Utilities" },
    { label: "Torrent Search", href: "page/Torrent-Search.html", c1: "#38bdf8", icon: "search", cat: "Search & Download" },
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
      html += `<a class="nav-item${active}" data-note-id="${n.id}" style="--icon-bg:#2dd4bf"><span class="nav-ico"><i data-lucide="sticky-note"></i></span><span class="label">${escapeHtml(n.text)}</span></a>`;
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
      html += `<a class="nav-item${active}" data-school-id="${id}"${locked ? ' data-locked="1"' : ""} style="--icon-bg:#22d3ee"><span class="nav-ico"><i data-lucide="school"></i></span><span class="label">${escapeHtml(school.name)}</span>${count ? `<span style="margin-left:auto;margin-right:8px;padding:2px 8px;border-radius:30px;background:color-mix(in srgb,var(--primary) 15%,transparent);color:var(--primary);font-size:0.8rem;font-weight:600">${count}</span>` : ""}</a>`;
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
    const filtered = TOOLS
      .filter((t) => hidden.indexOf(t.label) === -1);

    /* Group by category */
    const catOrder = ["Data & Comparison", "Documents & OCR", "Academic", "Utilities", "Search & Download"];
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
  }

  mount.className = "navbar";
  mount.innerHTML = `
    <div class="nav-top">
      <a class="nav-brand" href="${ROOT}index.html">Tools Hub</a>
    </div>
    <input class="nav-search" id="nav-search" type="text" placeholder="Cari program..." autocomplete="off" />
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
  const activeItem = nav.querySelector(".nav-item.active");
  if (activeItem) activeItem.scrollIntoView({ block: "center", behavior: "instant" });
  window.addEventListener("tools-hidden-change", () => { buildItems(); refreshIcons(); });

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
    refreshIcons();
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

  // ── Search filter item ──
  const searchInput = mount.querySelector("#nav-search");
  searchInput.addEventListener("input", () => {
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
