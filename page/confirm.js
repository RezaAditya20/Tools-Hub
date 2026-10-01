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
    const okBtn = overlay.querySelector(".btn-confirm-ok");
    okBtn.disabled = true;
    input.focus();
    input.select();
    const close = (val) => { if (window.closeOverlay) closeOverlay(overlay, val, resolve); else { overlay.remove(); resolve(val); } };
    input.addEventListener("input", () => { okBtn.disabled = !input.value.trim(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) { close(input.value); }
      if (e.key === "Escape") { close(null); }
    });
    okBtn.onclick = () => close(input.value);
    overlay.querySelector(".btn-confirm-cancel").onclick = () => close(null);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
}
