/* showConfirm(msg) → Promise<boolean>. Gantikan confirm() bawaan browser. */
function showConfirm(msg) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-box">
        <p>${msg}</p>
        <div class="confirm-actions">
          <button class="btn-confirm-ok">Ya</button>
          <button class="btn-confirm-cancel">Batal</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (val) => { if (window.closeOverlay) closeOverlay(overlay, val, resolve); else { overlay.remove(); resolve(val); } };
    overlay.querySelector(".btn-confirm-ok").onclick = () => close(true);
    overlay.querySelector(".btn-confirm-cancel").onclick = () => close(false);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
  });
}

/* showPrompt(msg, def) → Promise<string|null>. Gantikan prompt() bawaan browser. */
function showPrompt(msg, def = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="prompt-box">
        <p>${msg}</p>
        <input type="text" value="${def.replace(/"/g, "&quot;")}">
        <div class="confirm-actions">
          <button class="btn-confirm-ok">OK</button>
          <button class="btn-confirm-cancel">Batal</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector("input");
    input.focus();
    input.select();
    const close = (val) => { if (window.closeOverlay) closeOverlay(overlay, val, resolve); else { overlay.remove(); resolve(val); } };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { close(input.value); }
      if (e.key === "Escape") { close(null); }
    });
    overlay.querySelector(".btn-confirm-ok").onclick = () => close(input.value);
    overlay.querySelector(".btn-confirm-cancel").onclick = () => close(null);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
}

/* showPinModal(title, opts) → Promise<string|null>. Modal input PIN 6 digit.
   opts.mode = "verify" | "set" | "change"
   opts.verifyFn(pin) → boolean  (untuk mode verify)
   opts.onSuccess(pin)            (untuk mode set/change, setelah pin valid) */
function showPinModal(title, opts = {}) {
  return new Promise((resolve) => {
    const mode = opts.mode || "verify";
    const overlay = document.createElement("div");
    overlay.className = "pin-overlay";

    const label = mode === "change" ? "Masukkan PIN lama:" :
                  mode === "set" ? "Buat PIN 6 digit:" :
                  "Masukkan PIN:";
    const errDefault = mode === "set" ? "PIN harus 6 digit" : "PIN salah";

    overlay.innerHTML = `
      <div class="pin-box liquid-glass">
        <p>${title || label}</p>
        <div class="pin-inputs" id="pin-inputs">
          <input type="password" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
          <input type="password" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
          <input type="password" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
          <input type="password" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
          <input type="password" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
          <input type="password" maxlength="1" inputmode="numeric" pattern="[0-9]" autocomplete="off">
        </div>
        <div class="pin-err" id="pin-err"></div>
        <div class="confirm-actions">
          <button class="btn-confirm-ok" id="pin-ok">OK</button>
          <button class="btn-confirm-cancel" id="pin-cancel">Batal</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const inputs = overlay.querySelectorAll(".pin-inputs input");
    const errEl = overlay.querySelector("#pin-err");
    inputs[0].focus();
    const closePin = (val) => { if (window.closeOverlay) closeOverlay(overlay, val, resolve); else { overlay.remove(); resolve(val); } };

    function getPin() {
      return Array.from(inputs).map(i => i.value).join("");
    }

    function shakeInputs() {
      inputs.forEach(i => { i.classList.add("shake"); });
      setTimeout(() => inputs.forEach(i => i.classList.remove("shake")), 450);
    }

    function updateFilled() {
      inputs.forEach(i => i.classList.toggle("filled", i.value.length > 0));
    }

    inputs.forEach((input, idx) => {
      input.addEventListener("input", (e) => {
        const val = e.target.value.replace(/[^0-9]/g, "");
        e.target.value = val;
        updateFilled();
        if (val && idx < inputs.length - 1) {
          inputs[idx + 1].focus();
          inputs[idx + 1].select();
        }
        // Auto-submit kalau semua terisi
        if (getPin().length === 6) {
          setTimeout(() => doOk(), 100);
        }
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !input.value && idx > 0) {
          inputs[idx - 1].focus();
          inputs[idx - 1].select();
        }
        if (e.key === "Enter") { e.preventDefault(); doOk(); }
        if (e.key === "Escape") { closePin(null); }
      });
      input.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text").replace(/[^0-9]/g, "").slice(0, 6);
        text.split("").forEach((ch, i) => {
          if (inputs[i]) { inputs[i].value = ch; }
        });
        updateFilled();
        if (text.length > 0) inputs[Math.min(text.length, 5)].focus();
        if (getPin().length === 6) setTimeout(() => doOk(), 100);
      });
    });

    async function doOk() {
      const pin = getPin();
      if (pin.length !== 6) {
        errEl.textContent = "PIN harus 6 digit";
        shakeInputs();
        return;
      }
      if (mode === "verify") {
        if (opts.verifyFn && opts.verifyFn(pin)) {
          closePin(pin);
        } else {
          errEl.textContent = errDefault;
          shakeInputs();
          inputs.forEach(i => { i.value = ""; });
          updateFilled();
          inputs[0].focus();
        }
      } else if (mode === "set") {
        closePin(pin);
      } else if (mode === "change") {
        closePin(pin);
      }
    }

    overlay.querySelector("#pin-ok").onclick = doOk;
    overlay.querySelector("#pin-cancel").onclick = () => closePin(null);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closePin(null); });
  });
}

/* showNoteEdit(name, subname) → Promise<{name, subname}|null>.
   Modal edit nama + subname catatan. Batal/Esc → null. */
function showNoteEdit(name = "", subname = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="prompt-box">
        <p>Edit Nama &amp; Subname</p>
        <label style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:4px">Nama</label>
        <input type="text" id="edit-note-name" value="${name.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" autocomplete="off" />
        <label style="display:block;font-size:0.8rem;color:var(--muted);margin:12px 0 4px">Subname (opsional)</label>
        <input type="text" id="edit-note-subname" value="${subname.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" autocomplete="off" />
        <div class="confirm-actions">
          <button class="btn-confirm-ok">Simpan</button>
          <button class="btn-confirm-cancel">Batal</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const nameInput = overlay.querySelector("#edit-note-name");
    const subInput = overlay.querySelector("#edit-note-subname");
    nameInput.focus();
    nameInput.select();
    const close = (val) => { if (window.closeOverlay) closeOverlay(overlay, val, resolve); else { overlay.remove(); resolve(val); } };
    const save = () => close({ name: nameInput.value.trim(), subname: subInput.value.trim() });
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") close(null);
    });
    subInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") close(null);
    });
    overlay.querySelector(".btn-confirm-ok").onclick = save;
    overlay.querySelector(".btn-confirm-cancel").onclick = () => close(null);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
}

/* showSchoolAdd() → Promise<{name, category}|null>. Modal tambah sekolah. */
function showSchoolAdd() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    const cats = (window.__categories || []).map((c) => `<option value="${c.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`).join("");
    overlay.innerHTML = `
      <div class="prompt-box">
        <p>Tambah Sekolah / Kegiatan</p>
        <label style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:4px">Nama</label>
        <input type="text" id="add-school-name" placeholder="Nama Sekolah/Kegiatan..." autocomplete="off" />
        <label style="display:block;font-size:0.8rem;color:var(--muted);margin:12px 0 4px">Kategori (opsional)</label>
        <input type="text" id="add-school-cat" placeholder="Kategori" autocomplete="off" list="add-cat-list" />
        <datalist id="add-cat-list">${cats}</datalist>
        <div class="confirm-actions">
          <button class="btn-confirm-ok">Tambah</button>
          <button class="btn-confirm-cancel">Batal</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const nameInput = overlay.querySelector("#add-school-name");
    const catInput = overlay.querySelector("#add-school-cat");
    nameInput.focus();
    const close = (val) => { if (window.closeOverlay) closeOverlay(overlay, val, resolve); else { overlay.remove(); resolve(val); } };
    const save = () => close({ name: nameInput.value.trim(), category: catInput.value.trim() });
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") close(null);
    });
    catInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") close(null);
    });
    overlay.querySelector(".btn-confirm-ok").onclick = save;
    overlay.querySelector(".btn-confirm-cancel").onclick = () => close(null);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
}

/* showNoteAdd(defaultProgress?) → Promise<{name, subname, progress}|null>.
   Bila defaultProgress diisi, pilihan Progress disembunyikan & nilai tsb yang dipakai. */
function showNoteAdd(defaultProgress) {
  const hideProgress = defaultProgress !== undefined;
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="prompt-box">
        <p>Tambah Catatan</p>
        <label style="display:block;font-size:0.8rem;color:var(--muted);margin-bottom:4px">Nama</label>
        <input type="text" id="add-note-name" placeholder="Nama Catatan..." autocomplete="off" />
        <label style="display:block;font-size:0.8rem;color:var(--muted);margin:12px 0 4px">Subname (opsional)</label>
        <input type="text" id="add-note-subname" placeholder="Subname" autocomplete="off" />
        ${hideProgress ? "" : `<label style="display:block;font-size:0.8rem;color:var(--muted);margin:12px 0 4px">Progress</label>
        <select id="add-note-progress" class="progress-edit liquid-in-panel add-note-progress">
          <option value="">Pending</option>
          <option value="In Progress">In Progress</option>
          <option value="On Hold">On Hold</option>
          <option value="Testing">Testing</option>
          <option value="Done">Done</option>
        </select>`}
        <div class="confirm-actions">
          <button class="btn-confirm-ok">Tambah</button>
          <button class="btn-confirm-cancel">Batal</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const nameInput = overlay.querySelector("#add-note-name");
    const subInput = overlay.querySelector("#add-note-subname");
    const progInput = overlay.querySelector("#add-note-progress");
    nameInput.focus();
    const close = (val) => { if (window.closeOverlay) closeOverlay(overlay, val, resolve); else { overlay.remove(); resolve(val); } };
    const save = () => close({ name: nameInput.value.trim(), subname: subInput.value.trim(), progress: progInput ? progInput.value : defaultProgress });
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") close(null);
    });
    subInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") close(null);
    });
    if (progInput) progInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(null);
    });
    overlay.querySelector(".btn-confirm-ok").onclick = save;
    overlay.querySelector(".btn-confirm-cancel").onclick = () => close(null);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
}
