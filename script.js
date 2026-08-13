// script.js — MEMORY DRIFT: RECALL.exe
// Vanilla JS, no build step. See config.js for tunables.

(function () {
  "use strict";

  /* ===================== STATE ===================== */

  function freshState() {
    return {
      screen: "desktop", // desktop | reconstruction | final | receipt
      confidence: CONFIG.CONFIDENCE_START,
      drift: CONFIG.DRIFT_START,

      recallCount: 0,
      confirmCount: 0,
      deleteCount: 0,
      keepCount: 0,

      weights: {
        object: { window: 0.50, door: 0.35, mirror: 0.15 },
        date: { "2018": 0.55, "2019": 0.45 },
        weather: { rain: 0.60, sunny: 0.40 }
      },

      viewedPhoto: false,
      viewedChat: false,
      viewedLocation: false,
      photoOpens: 0,
      chatOpens: 0,
      locationOpens: 0,

      currentPhotoObject: "window",
      currentPhotoWeather: "rain",
      currentChatObject: "window",
      currentChatDate: "07/12",
      currentLocationRoom: "LIVING ROOM",
      currentLocationWeather: "rain",

      unlockedFiles: [], // extra file ids added to desktop
      trashedFiles: [],  // file ids sitting in trash
      conflictState: "none", // none | pending | kept | deleted | resurfaced

      reconSelection: { date: null, object: null, weather: null, person: null },
      lastConfirmedSelection: null,

      fragmentPromptShown: false,
      newEvidencePromptShown: false,

      finalVersion: null, // "A" | "B"
      recoveryComplete: false,

      log: []
    };
  }

  let state = null;
  let debugVisible = false;
  let draggedCard = null;

  /* ===================== PERSISTENCE ===================== */

  function save() {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* best effort */ }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function clearSaved() {
    try { localStorage.removeItem(CONFIG.STORAGE_KEY); } catch (e) {}
  }

  /* ===================== UTIL ===================== */

  function rnd(min, max) {
    return Math.random() * (max - min) + min;
  }
  function rndInt(min, max) {
    return Math.round(rnd(min, max));
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function weightedPick(weightObj) {
    const entries = Object.entries(weightObj);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [key, w] of entries) {
      if (r < w) return key;
      r -= w;
    }
    return entries[entries.length - 1][0];
  }

  function bumpWeight(category, key) {
    const w = state.weights[category];
    if (!(key in w)) return;
    w[key] = clamp(w[key] + CONFIG.WEIGHT_STEP, 0, CONFIG.MAX_SINGLE_WEIGHT);
    // renormalize others proportionally so total stays ~1
    const others = Object.keys(w).filter((k) => k !== key);
    const othersTotal = others.reduce((s, k) => s + w[k], 0);
    const remaining = Math.max(0.01, 1 - w[key]);
    if (othersTotal > 0) {
      others.forEach((k) => {
        w[k] = clamp((w[k] / othersTotal) * remaining, 0.01, CONFIG.MAX_SINGLE_WEIGHT);
      });
    }
  }

  function logLine(text) {
    const t = new Date();
    const stamp = `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
    state.log.push(`[${stamp}] ${text}`);
    if (state.log.length > 40) state.log.shift();
    renderSyslog();
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function driftTier() {
    if (state.drift >= 65) return 3;
    if (state.drift >= 35) return 2;
    if (state.drift >= 15) return 1;
    return 0;
  }

  function applyDriftClass() {
    const app = document.getElementById("app");
    app.classList.remove("drift-fx-1", "drift-fx-2", "drift-fx-3");
    const tier = driftTier();
    if (tier >= 1) app.classList.add("drift-fx-1");
    if (tier >= 2) app.classList.add("drift-fx-2");
    if (tier >= 3) app.classList.add("drift-fx-3");

    const topbar = document.getElementById("topbar");
    const statusLabel = document.getElementById("status-label");
    if (tier >= 3) {
      topbar.classList.add("unstable");
      statusLabel.textContent = "UNSTABLE";
    } else {
      topbar.classList.remove("unstable");
      statusLabel.textContent = "STANDBY";
    }
  }

  /* ===================== TOP BAR / INFO PANEL ===================== */

  function renderTopbarCenter() {
    document.getElementById("tb-center-text").textContent = CONFIG.INTERFACE_VERSION;
  }

  function renderInfoPanel(fileMeta) {
    const el = document.getElementById("archive-info");
    if (!fileMeta) {
      el.innerHTML = `
        <h4>ARCHIVE INFO</h4>
        <div class="info-row"><span class="k">FILE ID:</span><span class="v">${CONFIG.ARCHIVE_ID}</span></div>
        <div class="info-row"><span class="k">FILE TYPE:</span><span class="v">MEMORY ARCHIVE</span></div>
        <div class="info-row"><span class="k">SIZE:</span><span class="v">2.48 GB</span></div>
        <div class="info-row"><span class="k">FRAGMENTS:</span><span class="v">1248</span></div>
        <div class="info-row"><span class="k">ENCRYPTION:</span><span class="v">UNKNOWN</span></div>
        <div class="info-row"><span class="k">INTEGRITY:</span><span class="v">${integrityLabel()}</span></div>
      `;
    } else {
      el.innerHTML = `
        <h4>ARCHIVE INFO</h4>
        ${fileMeta.map(([k, v]) => `<div class="info-row"><span class="k">${k}:</span><span class="v">${v}</span></div>`).join("")}
      `;
    }
  }

  function integrityLabel() {
    const t = driftTier();
    if (t >= 3) return "UNSTABLE";
    if (t >= 2) return "DEGRADED";
    if (t >= 1) return "PARTIALLY STABLE";
    return "STABLE";
  }

  function renderSyslog() {
    const el = document.getElementById("syslog-lines");
    el.innerHTML = state.log.slice().reverse().map((l) => `<div>${escapeHtml(l)}</div>`).join("");
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  /* ===================== NAV ===================== */

  function wireNav() {
    document.querySelectorAll("#navbar .nav-item").forEach((item) => {
      item.addEventListener("click", () => {
        document.querySelectorAll("#navbar .nav-item").forEach((i) => i.classList.remove("active"));
        item.classList.add("active");
        const target = item.dataset.nav;
        if (target === "ARCHIVE") {
          renderMainScreen();
        } else {
          renderUnavailable(target);
        }
      });
    });
  }

  function renderUnavailable(name) {
    const content = document.getElementById("content");
    content.innerHTML = `
      <div class="screen-title">${name}</div>
      <div class="panel-box" style="max-width:420px;">
        <div class="corrupt-note">ACCESS UNAVAILABLE</div>
      </div>
    `;
    renderInfoPanel(null);
  }

  /* ===================== BOOT ===================== */

  function initBoot() {
    const saved = loadSaved();
    const actions = document.getElementById("boot-actions");
    if (saved) {
      actions.innerHTML = `
        <button class="btn btn-solid" id="btn-continue">[ CONTINUE SESSION ]</button>
        <button class="btn btn-quiet" id="btn-new-session" style="margin-left:10px;">[ NEW SESSION ]</button>
      `;
      document.getElementById("btn-continue").addEventListener("click", () => {
        state = saved;
        bootIntoApp();
      });
      document.getElementById("btn-new-session").addEventListener("click", () => {
        clearSaved();
        state = freshState();
        bootIntoApp();
      });
    } else {
      document.getElementById("btn-start-recovery").addEventListener("click", () => {
        state = freshState();
        bootIntoApp();
      });
    }
  }

  function bootIntoApp() {
    document.getElementById("screen-boot").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    renderTopbarCenter();
    wireNav();
    wireDebugToggle();
    applyDriftClass();
    if (state.log.length === 0) {
      logLine("Archive terminal initialized.");
      logLine(`Archive ${CONFIG.ARCHIVE_ID.replace(".MDR", "")} located.`);
      logLine("Integrity check failed.");
    } else {
      renderSyslog();
    }
    renderMainScreen();
    save();
  }

  /* ===================== MAIN SCREEN ROUTER ===================== */

  function renderMainScreen() {
    if (state.recoveryComplete && state.screen === "receipt") return renderReceipt();
    if (state.screen === "final") return renderFinalVersions();
    if (state.screen === "reconstruction") return renderReconstructionBoard();
    return renderDesktop();
  }

  /* ===================== DESKTOP ===================== */

  function fileList() {
    const base = [
      { id: "photo", name: "PHOTO_01.jpg" },
      { id: "chat", name: "CHAT_LOG.txt" },
      { id: "location", name: "LOCATION.dat" },
      { id: "voice", name: "VOICE_03.wav" },
      { id: "unknown", name: "UNKNOWN" },
      { id: "trash", name: "TRASH" }
    ];
    const extra = [];
    if (state.unlockedFiles.includes("window_record")) extra.push({ id: "window_record", name: "WINDOW_RECORD.dat" });
    if (state.unlockedFiles.includes("door_record")) extra.push({ id: "door_record", name: "DOOR_RECORD.dat" });
    if (state.unlockedFiles.includes("photo_final")) extra.push({ id: "photo_final", name: "PHOTO_01_FINAL.jpg" });
    if (state.conflictState === "pending" || state.conflictState === "resurfaced") {
      extra.push({ id: "conflict", name: state.conflictState === "resurfaced" ? "EVENT_RECORD_CONFIRMED.pdf" : "DO_NOT_DELETE.pdf", flagged: true });
    }
    return base.concat(extra);
  }

  function glyphFor(id) {
    switch (id) {
      case "photo": case "photo_final": return "▣";
      case "chat": return "≡";
      case "location": return "◈";
      case "voice": return "♪";
      case "unknown": return "?";
      case "trash": return "⌫";
      case "window_record": case "door_record": return "▤";
      case "conflict": return "!";
      default: return "▢";
    }
  }

  function renderDesktop() {
    state.screen = "desktop";
    const content = document.getElementById("content");
    const files = fileList();
    content.innerHTML = `
      <div class="task-banner">
        <div class="task-label">CURRENT TASK</div>
        <div class="task-text">Recover the original memory.</div>
      </div>
      <div class="archive-window">
        <div class="archive-window-titlebar">ARCHIVE DIRECTORY</div>
        <div class="file-grid">
          ${files.map((f) => `
            <button class="file-icon-btn ${f.flagged ? "flagged" : ""}" data-file="${f.id}">
              ${f.flagged ? '<span class="flag-dot"></span>' : ""}
              <span class="file-icon-glyph">${glyphFor(f.id)}</span>
              <span class="file-name">${f.name}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
    renderInfoPanel(null);

    content.querySelectorAll(".file-icon-btn").forEach((btn) => {
      btn.addEventListener("click", () => openFile(btn.dataset.file));
    });

    maybeShowFragmentPrompt();
    save();
  }

  function openFile(id) {
    switch (id) {
      case "photo": return openPhoto();
      case "chat": return openChat();
      case "location": return openLocation();
      case "voice": return openVoice();
      case "unknown": return toast("ACCESS DENIED");
      case "trash": return openTrash();
      case "window_record": return openRecord("window");
      case "door_record": return openRecord("door");
      case "photo_final": return openPhoto(true);
      case "conflict": return openConflict();
      default: return toast("ACCESS UNAVAILABLE");
    }
  }

  /* ===================== OVERLAY HELPERS ===================== */

  function showOverlay(html, opts) {
    const ov = document.getElementById("overlay");
    ov.innerHTML = html;
    ov.classList.remove("hidden");
    ov.onclick = (e) => {
      if (e.target === ov && !(opts && opts.lockClose)) closeOverlay();
    };
    const closeBtn = ov.querySelector(".overlay-close");
    if (closeBtn) closeBtn.addEventListener("click", closeOverlay);
    return ov;
  }
  function closeOverlay() {
    document.getElementById("overlay").classList.add("hidden");
    save();
    renderMainScreen();
  }

  /* ===================== PHOTO ===================== */

  function photoImg(object, weather) {
    return `assets/images/photo-${object}-${weather}.svg`;
  }

  function openPhoto(isFinal) {
    state.photoOpens++;
    const isFirstOpen = state.photoOpens === 1;
    if (!isFirstOpen) {
      state.recallCount++;
      state.drift = clamp(state.drift + rndInt(CONFIG.RECALL_DRIFT_GAIN[0], CONFIG.RECALL_DRIFT_GAIN[1]), 0, 100);
      if (Math.random() < CONFIG.RECALL_MUTATION_CHANCE) {
        const newObject = weightedPick(state.weights.object === undefined ? {} : filterObjectWeights());
        const newWeather = weightedPick(state.weights.weather);
        const changed = newObject !== state.currentPhotoObject || newWeather !== state.currentPhotoWeather;
        state.currentPhotoObject = newObject;
        state.currentPhotoWeather = newWeather;
        if (changed) logLine("MEMORY UPDATED — Image re-indexed.");
      }
    }
    state.viewedPhoto = true;

    const ov = showOverlay(`
      <div class="overlay-window">
        <div class="overlay-titlebar">
          <span>${isFinal ? "PHOTO_01_FINAL.jpg" : "PHOTO_01.jpg"}</span>
          <button class="overlay-close">CLOSE ✕</button>
        </div>
        <div class="overlay-body">
          <div class="photo-frame flicker">
            <img src="${photoImg(state.currentPhotoObject, state.currentPhotoWeather)}" alt="archive photo" />
          </div>
          <div class="kv-block">
            <div class="kv-row"><span class="k">FILE ID:</span><span class="v">A0712_03</span></div>
            <div class="kv-row"><span class="k">FILE TYPE:</span><span class="v">PHOTOGRAPH</span></div>
            <div class="kv-row"><span class="k">DATE TAKEN:</span><span class="v">UNKNOWN</span></div>
            <div class="kv-row"><span class="k">SOURCE:</span><span class="v">RECONSTRUCTED</span></div>
            <div class="kv-row"><span class="k">RECALL COUNT:</span><span class="v">${state.photoOpens}</span></div>
            <div class="kv-row"><span class="k">INTEGRITY:</span><span class="v">${integrityLabel()}</span></div>
          </div>
        </div>
      </div>
    `);
    renderInfoPanel([
      ["FILE ID", "A0712_03"],
      ["TYPE", "PHOTOGRAPH"],
      ["RECALLS", state.photoOpens],
      ["INTEGRITY", integrityLabel()]
    ]);
    applyDriftClass();
    save();
  }

  function filterObjectWeights() {
    // photo only ever depicts window or door (mirror reserved for future content)
    const w = state.weights.object;
    return { window: w.window, door: w.door };
  }

  /* ===================== CHAT ===================== */

  function openChat() {
    state.chatOpens++;
    const isFirstOpen = state.chatOpens === 1;
    if (!isFirstOpen) {
      state.recallCount++;
      state.drift = clamp(state.drift + rndInt(CONFIG.RECALL_DRIFT_GAIN[0], CONFIG.RECALL_DRIFT_GAIN[1]), 0, 100);
      if (Math.random() < CONFIG.RECALL_MUTATION_CHANCE) {
        state.currentChatObject = weightedPick(filterObjectWeights());
        state.currentChatDate = weightedPick(state.weights.date) === "2018" ? "07/12" : "07/21";
      }
    }
    state.viewedChat = true;

    const objectWord = state.currentChatObject === "door" ? "door" : "window";
    const ov = showOverlay(`
      <div class="overlay-window">
        <div class="overlay-titlebar">
          <span>CHAT_LOG.txt</span>
          <button class="overlay-close">CLOSE ✕</button>
        </div>
        <div class="overlay-body">
          <div class="chat-log">
            <div class="chat-date">${state.currentChatDate}</div>
            <div><span class="chat-name">Mom:</span> When will you be home?</div>
            <div><span class="chat-name">You:</span> Around 8.</div>
            <div><span class="chat-name">Mom:</span> Remember to close the ${objectWord}.</div>
            <div><span class="chat-name">You:</span> Okay.</div>
          </div>
          <div class="kv-block">
            <div class="kv-row"><span class="k">RECALL COUNT:</span><span class="v">${state.chatOpens}</span></div>
            <div class="kv-row"><span class="k">INTEGRITY:</span><span class="v">${integrityLabel()}</span></div>
          </div>
        </div>
      </div>
    `);
    renderInfoPanel([
      ["FILE ID", "A0712_07"],
      ["TYPE", "CHAT LOG"],
      ["RECALLS", state.chatOpens],
      ["INTEGRITY", integrityLabel()]
    ]);
    applyDriftClass();
    save();
  }

  /* ===================== LOCATION ===================== */

  function openLocation() {
    state.locationOpens++;
    const isFirstOpen = state.locationOpens === 1;
    if (!isFirstOpen) {
      state.recallCount++;
      state.drift = clamp(state.drift + rndInt(CONFIG.RECALL_DRIFT_GAIN[0], CONFIG.RECALL_DRIFT_GAIN[1]), 0, 100);
      if (Math.random() < CONFIG.RECALL_MUTATION_CHANCE) {
        const obj = weightedPick(filterObjectWeights());
        state.currentLocationRoom = obj === "door" ? "ENTRYWAY" : "LIVING ROOM";
        state.currentLocationWeather = weightedPick(state.weights.weather);
      }
    }
    state.viewedLocation = true;

    const ov = showOverlay(`
      <div class="overlay-window">
        <div class="overlay-titlebar">
          <span>LOCATION.dat</span>
          <button class="overlay-close">CLOSE ✕</button>
        </div>
        <div class="overlay-body">
          <div class="kv-block">
            <div class="kv-row"><span class="k">LOCATION</span><span class="v">LAKEVIEW HOUSE</span></div>
            <div class="kv-row"><span class="k">ROOM</span><span class="v">${state.currentLocationRoom}</span></div>
            <div class="kv-row"><span class="k">COORDINATES</span><span class="v">UNAVAILABLE</span></div>
            <div class="kv-row"><span class="k">WEATHER</span><span class="v">${state.currentLocationWeather.toUpperCase()}</span></div>
            <div class="kv-row"><span class="k">RECALL COUNT</span><span class="v">${state.locationOpens}</span></div>
          </div>
        </div>
      </div>
    `);
    renderInfoPanel([
      ["FILE ID", "A0712_11"],
      ["TYPE", "LOCATION DATA"],
      ["RECALLS", state.locationOpens],
      ["INTEGRITY", integrityLabel()]
    ]);
    applyDriftClass();
    save();
  }

  /* ===================== VOICE / RECORD / TRASH / CONFLICT ===================== */

  function openVoice() {
    showOverlay(`
      <div class="overlay-window">
        <div class="overlay-titlebar">
          <span>VOICE_03.wav</span>
          <button class="overlay-close">CLOSE ✕</button>
        </div>
        <div class="overlay-body">
          <div class="corrupt-note">
            AUDIO FILE PARTIALLY CORRUPTED<br/>
            TRANSCRIPT RECOVERY: 41%
          </div>
        </div>
      </div>
    `);
  }

  function openRecord(object) {
    const w = state.weights.object[object];
    showOverlay(`
      <div class="overlay-window">
        <div class="overlay-titlebar">
          <span>${object.toUpperCase()}_RECORD.dat</span>
          <button class="overlay-close">CLOSE ✕</button>
        </div>
        <div class="overlay-body">
          <div class="kv-block">
            <div class="kv-row"><span class="k">OBJECT DETECTED</span><span class="v">${object.toUpperCase()}</span></div>
            <div class="kv-row"><span class="k">MATCH CONFIDENCE</span><span class="v">${Math.round(w * 100 / CONFIG.MAX_SINGLE_WEIGHT)}%</span></div>
          </div>
        </div>
      </div>
    `);
  }

  function openTrash() {
    const items = state.trashedFiles;
    showOverlay(`
      <div class="overlay-window">
        <div class="overlay-titlebar">
          <span>TRASH</span>
          <button class="overlay-close">CLOSE ✕</button>
        </div>
        <div class="overlay-body">
          ${items.length === 0
            ? '<div class="corrupt-note">TRASH IS EMPTY</div>'
            : `<div class="kv-block">${items.map((n) => `<div class="kv-row"><span class="k">${n}</span><span class="v">DELETED</span></div>`).join("")}</div>`}
        </div>
      </div>
    `);
  }

  function openConflict() {
    if (state.conflictState === "resurfaced") {
      showOverlay(`
        <div class="overlay-window">
          <div class="overlay-titlebar">
            <span>EVENT_RECORD_CONFIRMED.pdf</span>
            <button class="overlay-close">CLOSE ✕</button>
          </div>
          <div class="overlay-body">
            <div class="screen-title" style="margin-bottom:14px;">CONFLICT EVIDENCE</div>
            <div class="kv-block">
              <div class="kv-row"><span class="k">EVENT RECORD SUMMARY</span><span class="v"></span></div>
              <div class="kv-row"><span class="k">THIS EVENT OCCURRED IN</span><span class="v">2019</span></div>
              <div class="kv-row"><span class="k">SOURCE CONFIDENCE</span><span class="v">99%</span></div>
              <div class="kv-row"><span class="k">STATUS</span><span class="v">PREVIOUSLY DELETED</span></div>
            </div>
          </div>
        </div>
      `);
      return;
    }

    const ov = showOverlay(`
      <div class="overlay-window">
        <div class="overlay-titlebar">
          <span>DO_NOT_DELETE.pdf</span>
          <button class="overlay-close">CLOSE ✕</button>
        </div>
        <div class="overlay-body">
          <div class="screen-title" style="margin-bottom:14px;">CONFLICT EVIDENCE</div>
          <div class="kv-block" style="margin-bottom:22px;">
            <div class="kv-row"><span class="k">EVENT RECORD SUMMARY</span><span class="v"></span></div>
            <div class="kv-row"><span class="k">THIS EVENT OCCURRED IN</span><span class="v">2019</span></div>
            <div class="kv-row"><span class="k">SOURCE CONFIDENCE</span><span class="v">99%</span></div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-solid" id="btn-keep">KEEP</button>
            <button class="btn btn-danger" id="btn-delete">DELETE</button>
          </div>
        </div>
      </div>
    `, { lockClose: true });

    ov.querySelector("#btn-keep").addEventListener("click", () => resolveConflict("keep"));
    ov.querySelector("#btn-delete").addEventListener("click", () => resolveConflict("delete"));
  }

  function resolveConflict(action) {
    if (action === "keep") {
      state.keepCount++;
      state.confidence = clamp(state.confidence + CONFIG.CONFLICT_KEEP_CONFIDENCE_DELTA, 0, 100);
      state.drift = clamp(state.drift + CONFIG.CONFLICT_KEEP_DRIFT_GAIN, 0, 100);
      state.conflictState = "kept";
      logLine("MEMORY CONFLICT DETECTED.");
      toast("MEMORY CONFLICT DETECTED");
    } else {
      state.deleteCount++;
      state.confidence = clamp(state.confidence + CONFIG.CONFLICT_DELETE_CONFIDENCE_DELTA, 0, 100);
      state.drift = clamp(state.drift + CONFIG.CONFLICT_DELETE_DRIFT_GAIN, 0, 100);
      state.conflictState = "none";
      state.trashedFiles.push("DO_NOT_DELETE.pdf");
      logLine("MEMORY CONSISTENCY IMPROVED.");
      toast("MEMORY CONSISTENCY IMPROVED.");
      // chance it resurfaces later
      if (Math.random() < CONFIG.CONFLICT_RESURFACE_CHANCE) {
        setTimeout(() => {
          if (state.conflictState === "none") {
            state.conflictState = "resurfaced";
            logLine("Archive index changed. New file detected.");
            save();
            if (state.screen === "desktop") renderDesktop();
          }
        }, 4000);
      }
    }
    applyDriftClass();
    closeOverlay();
  }

  /* ===================== FRAGMENT PROMPT -> RECONSTRUCTION ===================== */

  function maybeShowFragmentPrompt() {
    if (state.fragmentPromptShown) return;
    if (state.viewedPhoto && state.viewedChat && state.viewedLocation) {
      state.fragmentPromptShown = true;
      setTimeout(() => {
        showOverlay(`
          <div class="overlay-window modal-box">
            <div class="modal-title">ENOUGH FRAGMENTS RECOVERED.</div>
            <div class="modal-body">Begin reconstruction?</div>
            <div class="modal-actions">
              <button class="btn btn-solid" id="btn-go-recon">[ RECONSTRUCT MEMORY ]</button>
            </div>
          </div>
        `, { lockClose: true });
        document.getElementById("btn-go-recon").addEventListener("click", () => {
          document.getElementById("overlay").classList.add("hidden");
          state.screen = "reconstruction";
          save();
          renderMainScreen();
        });
      }, 400);
    }
  }

  /* ===================== RECONSTRUCTION BOARD ===================== */

  const EVIDENCE_CARDS = {
    date: [{ id: "2018", label: "2018.07.12" }, { id: "2019", label: "2019.07.21" }],
    object: [{ id: "window", label: "WINDOW" }, { id: "door", label: "DOOR" }],
    weather: [{ id: "rain", label: "RAIN" }, { id: "sunny", label: "SUNNY" }],
    person: [{ id: "girl", label: "GIRL" }, { id: "mother", label: "MOTHER" }]
  };
  const SLOT_LABELS = ["date", "object", "weather", "person"];

  function renderReconstructionBoard() {
    state.screen = "reconstruction";
    const content = document.getElementById("content");
    const sel = state.reconSelection;
    const allFilled = SLOT_LABELS.every((s) => sel[s]);

    content.innerHTML = `
      <div class="screen-title">RECONSTRUCTION BOARD</div>
      <div class="recon-layout">
        <div class="recon-left">
          <div class="recon-photo">
            <img src="${photoImg(state.currentPhotoObject, state.currentPhotoWeather)}" alt="reconstruction reference" />
          </div>
          <div class="slot-grid">
            ${SLOT_LABELS.map((s) => `
              <div class="slot ${sel[s] ? "filled" : ""}" data-slot="${s}">
                <span class="slot-label">${s.toUpperCase()}</span>
                <span class="slot-value">${sel[s] ? labelFor(s, sel[s]) : "—"}</span>
              </div>
            `).join("")}
          </div>
          <div class="recon-confirm-row">
            <button class="btn btn-solid" id="btn-confirm-memory" ${allFilled ? "" : "disabled"}>CONFIRM MEMORY</button>
          </div>
        </div>
        <div class="recon-right">
          <h4>EVIDENCE CARDS</h4>
          ${SLOT_LABELS.map((s) => `
            <div class="card-group">
              <div class="card-group-label">${s.toUpperCase()}</div>
              ${EVIDENCE_CARDS[s].map((c) => `
                <div class="evidence-card ${sel[s] === c.id ? "selected-active" : ""}" draggable="true"
                     data-slot="${s}" data-id="${c.id}">${c.label}</div>
              `).join("")}
            </div>
          `).join("")}
        </div>
      </div>
    `;
    renderInfoPanel(null);
    wireReconInteractions();
    save();
  }

  function labelFor(slot, id) {
    const found = EVIDENCE_CARDS[slot].find((c) => c.id === id);
    return found ? found.label : id;
  }

  function wireReconInteractions() {
    const content = document.getElementById("content");

    // click-to-select: click a card, then click a slot of matching category
    content.querySelectorAll(".evidence-card").forEach((card) => {
      card.addEventListener("click", () => {
        const slot = card.dataset.slot;
        const id = card.dataset.id;
        state.reconSelection[slot] = id;
        renderReconstructionBoard();
      });
      card.addEventListener("dragstart", (e) => {
        draggedCard = { slot: card.dataset.slot, id: card.dataset.id };
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "copy";
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
    });

    content.querySelectorAll(".slot").forEach((slotEl) => {
      slotEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (draggedCard && draggedCard.slot === slotEl.dataset.slot) {
          slotEl.classList.add("drag-over");
        }
      });
      slotEl.addEventListener("dragleave", () => slotEl.classList.remove("drag-over"));
      slotEl.addEventListener("drop", (e) => {
        e.preventDefault();
        slotEl.classList.remove("drag-over");
        if (draggedCard && draggedCard.slot === slotEl.dataset.slot) {
          state.reconSelection[slotEl.dataset.slot] = draggedCard.id;
          renderReconstructionBoard();
        }
        draggedCard = null;
      });
    });

    const confirmBtn = document.getElementById("btn-confirm-memory");
    if (confirmBtn) confirmBtn.addEventListener("click", confirmMemory);
  }

  function confirmMemory() {
    const sel = state.reconSelection;
    bumpWeight("date", sel.date);
    bumpWeight("object", sel.object);
    bumpWeight("weather", sel.weather);

    state.confirmCount++;
    state.confidence = clamp(state.confidence + rndInt(CONFIG.CONFIRM_CONFIDENCE_GAIN[0], CONFIG.CONFIRM_CONFIDENCE_GAIN[1]), 0, 98);
    state.drift = clamp(state.drift + rndInt(CONFIG.CONFIRM_DRIFT_GAIN[0], CONFIG.CONFIRM_DRIFT_GAIN[1]), 0, 100);
    state.lastConfirmedSelection = Object.assign({}, sel);

    // unlock a reinforcing file
    if (sel.object === "window" && !state.unlockedFiles.includes("window_record")) state.unlockedFiles.push("window_record");
    if (sel.object === "door" && !state.unlockedFiles.includes("door_record")) state.unlockedFiles.push("door_record");
    if (state.confirmCount === 1 && !state.unlockedFiles.includes("photo_final")) state.unlockedFiles.push("photo_final");

    logLine(`Memory confirmed. Confidence ${Math.round(state.confidence)}%.`);

    // trigger conflict event after 2nd confirmation
    if (state.confirmCount === 2 && state.conflictState === "none") {
      state.conflictState = "pending";
      logLine("Unindexed file detected. Flag raised.");
    }

    applyDriftClass();
    save();
    renderConfirmResult();
  }

  function renderConfirmResult() {
    const content = document.getElementById("content");
    const recovery = clamp(Math.round((state.confirmCount / CONFIG.CONFIRMS_TO_COMPLETE) * 100), 0, 100);
    content.innerHTML = `
      <div class="screen-title">MEMORY CONFIRMED</div>
      <div class="panel-box" style="max-width:420px;text-align:center;">
        <div class="corrupt-note" style="color:var(--text);font-size:13px;">THIS MEMORY APPEARS CONSISTENT.</div>
        <div class="confidence-display">
          <div class="num">${Math.round(state.confidence)}%</div>
          <div class="label">MEMORY CONFIDENCE</div>
        </div>
        <div class="kv-block" style="text-align:left;">
          <div class="kv-row"><span class="k">RECOVERY PROGRESS:</span><span class="v">${recovery}%</span></div>
          <div class="kv-row"><span class="k">INTEGRITY STABILITY:</span><span class="v">${integrityLabel()}</span></div>
        </div>
        <button class="btn btn-solid" id="btn-back-desktop" style="margin-top:20px;">RETURN TO ARCHIVE</button>
      </div>
    `;
    renderInfoPanel(null);
    document.getElementById("btn-back-desktop").addEventListener("click", () => {
      state.screen = "desktop";
      state.reconSelection = { date: null, object: null, weather: null, person: null };
      save();

      if (state.confirmCount >= CONFIG.CONFIRMS_TO_COMPLETE) {
        return showRecoveryCompletePrompt();
      }
      if (!state.newEvidencePromptShown && state.confirmCount === 1) {
        state.newEvidencePromptShown = true;
        toast("NEW EVIDENCE FOUND — review recovered archive.");
      }
      renderDesktop();
    });
  }

  function showRecoveryCompletePrompt() {
    showOverlay(`
      <div class="overlay-window modal-box">
        <div class="modal-title">MEMORY RECOVERY: 100%</div>
        <div class="modal-body">FINAL RECONSTRUCTION READY</div>
        <div class="modal-actions">
          <button class="btn btn-solid" id="btn-view-final">[ VIEW RECOVERED MEMORY ]</button>
        </div>
      </div>
    `, { lockClose: true });
    document.getElementById("btn-view-final").addEventListener("click", () => {
      document.getElementById("overlay").classList.add("hidden");
      state.screen = "final";
      save();
      renderFinalVersions();
    });
  }

  /* ===================== FINAL VERSIONS ===================== */

  function renderFinalVersions() {
    state.screen = "final";
    const sel = state.lastConfirmedSelection || state.reconSelection;
    const primaryObject = sel.object || "window";
    const primaryWeather = sel.weather || "rain";
    const primaryDate = sel.date === "2019" ? "2019.07.21" : "2018.07.12";

    const altObject = primaryObject === "window" ? "door" : "window";
    const altDate = sel.date === "2019" ? "2018.07.12" : "2019.07.21";

    const versionA = { date: primaryDate, object: primaryObject, weather: primaryWeather };
    const versionB = { date: altDate, object: altObject, weather: primaryWeather };

    const content = document.getElementById("content");
    content.innerHTML = `
      <div class="screen-title">RECOVERED MEMORY</div>
      <div class="versions-layout">
        ${versionCardHtml("A", versionA)}
        ${versionCardHtml("B", versionB)}
      </div>
      <div class="original-block">
        <div class="label">ORIGINAL MEMORY:</div>
        <div class="value">UNKNOWN</div>
      </div>
      <div class="which-question">WHICH ONE DO YOU REMEMBER?</div>
    `;
    renderInfoPanel(null);

    document.getElementById("btn-pick-A").addEventListener("click", () => pickVersion("A"));
    document.getElementById("btn-pick-B").addEventListener("click", () => pickVersion("B"));

    // stash for receipt
    state._versionA = versionA;
    state._versionB = versionB;
    save();
  }

  function versionCardHtml(letter, v) {
    return `
      <div class="version-card">
        <div class="version-header">VERSION ${letter}</div>
        <div class="version-photo"><img src="${photoImg(v.object, v.weather)}" alt="version ${letter}" /></div>
        <div class="version-body">
          <div class="kv-block">
            <div class="kv-row"><span class="k">DATE:</span><span class="v">${v.date}</span></div>
            <div class="kv-row"><span class="k">LOCATION:</span><span class="v">LAKEVIEW HOUSE</span></div>
            <div class="kv-row"><span class="k">OBJECT:</span><span class="v">${v.object.toUpperCase()}</span></div>
            <div class="kv-row"><span class="k">WEATHER:</span><span class="v">${v.weather.toUpperCase()}</span></div>
            <div class="kv-row"><span class="k">PERSON:</span><span class="v">UNKNOWN</span></div>
            <div class="kv-row"><span class="k">CONFIDENCE:</span><span class="v">${CONFIG.FINAL_CONFIDENCE_DISPLAY}%</span></div>
          </div>
          <button class="btn btn-solid" id="btn-pick-${letter}">I REMEMBER VERSION ${letter}</button>
        </div>
      </div>
    `;
  }

  function pickVersion(letter) {
    state.finalVersion = letter;
    state.recoveryComplete = true;
    save();
    runRevealSequence();
  }

  /* ===================== REVEAL SEQUENCE ===================== */

  function runRevealSequence() {
    const el = document.getElementById("screen-reveal");
    el.classList.remove("hidden");
    const lines = [
      { text: "MEMORY CONFIRMED", delay: 200 },
      { text: "ORIGINAL SOURCE: NOT FOUND", delay: 1600 },
      { text: "YOU DID NOT RECOVER THE MEMORY.", delay: 3200, final: true },
      { text: "YOU COMPLETED IT.", delay: 4600, final: true }
    ];
    let idx = 0;
    function step() {
      if (idx >= lines.length) {
        setTimeout(() => {
          el.classList.add("hidden");
          state.screen = "receipt";
          save();
          renderReceipt();
        }, 1400);
        return;
      }
      const l = lines[idx];
      el.innerHTML = `<div class="reveal-line show ${l.final ? "final" : ""}">${l.text}</div>`;
      idx++;
      setTimeout(step, idx === 1 ? 1400 : 1600);
    }
    step();
  }

  /* ===================== RECEIPT ===================== */

  function renderReceipt() {
    state.screen = "receipt";
    const content = document.getElementById("content");
    content.innerHTML = `
      <div class="screen-title">MEMORY RECOVERY RECEIPT</div>
      <div class="receipt-box panel-box">
        <div class="kv-block">
          <div class="kv-row"><span class="k">PLAYER:</span><span class="v">${CONFIG.PLAYER_ID}</span></div>
          <div class="kv-row"><span class="k">RECALLS:</span><span class="v">${state.recallCount}</span></div>
          <div class="kv-row"><span class="k">CONFIRMATIONS:</span><span class="v">${state.confirmCount}</span></div>
          <div class="kv-row"><span class="k">CONFLICTING EVIDENCE DELETED:</span><span class="v">${state.deleteCount}</span></div>
          <div class="kv-row"><span class="k">CONFLICTING EVIDENCE KEPT:</span><span class="v">${state.keepCount}</span></div>
          <div class="kv-row"><span class="k">FINAL CONFIDENCE:</span><span class="v">${CONFIG.FINAL_CONFIDENCE_DISPLAY}%</span></div>
          <div class="kv-row"><span class="k">FINAL MEMORY:</span><span class="v">VERSION ${state.finalVersion}</span></div>
          <div class="kv-row"><span class="k">ORIGINAL:</span><span class="v">UNKNOWN</span></div>
        </div>
        <div class="receipt-actions">
          <button class="btn btn-solid" id="btn-return-archive">RETURN TO ARCHIVE</button>
          <button class="btn btn-quiet" id="btn-restart">RESTART SESSION</button>
        </div>
      </div>
    `;
    renderInfoPanel(null);
    document.getElementById("btn-return-archive").addEventListener("click", () => {
      state.screen = "desktop";
      save();
      renderDesktop();
    });
    document.getElementById("btn-restart").addEventListener("click", () => {
      clearSaved();
      state = freshState();
      save();
      applyDriftClass();
      renderDesktop();
      logLine("Session restarted.");
    });
    save();
  }

  /* ===================== DEBUG PANEL ===================== */

  function wireDebugToggle() {
    document.addEventListener("keydown", (e) => {
      if (e.shiftKey && (e.key === "D" || e.key === "d")) {
        debugVisible = !debugVisible;
        renderDebugPanel();
      }
    });
  }

  function renderDebugPanel() {
    const el = document.getElementById("debug-panel");
    if (!debugVisible) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    const w = state.weights;
    el.innerHTML = `
      <h4>DEBUG PANEL (Shift+D)</h4>
      <div class="drow"><span class="k">CONFIDENCE</span><span>${Math.round(state.confidence)}</span></div>
      <div class="drow"><span class="k">DRIFT</span><span>${Math.round(state.drift)}</span></div>
      <div class="drow"><span class="k">RECALL COUNT</span><span>${state.recallCount}</span></div>
      <div class="drow"><span class="k">CONFIRM COUNT</span><span>${state.confirmCount}</span></div>
      <div class="drow"><span class="k">DELETE COUNT</span><span>${state.deleteCount}</span></div>
      <div class="drow"><span class="k">KEEP COUNT</span><span>${state.keepCount}</span></div>
      <div class="drow"><span class="k">WINDOW WEIGHT</span><span>${w.object.window.toFixed(2)}</span></div>
      <div class="drow"><span class="k">DOOR WEIGHT</span><span>${w.object.door.toFixed(2)}</span></div>
      <div class="drow"><span class="k">2018 WEIGHT</span><span>${w.date["2018"].toFixed(2)}</span></div>
      <div class="drow"><span class="k">2019 WEIGHT</span><span>${w.date["2019"].toFixed(2)}</span></div>
      <div class="drow"><span class="k">RAIN WEIGHT</span><span>${w.weather.rain.toFixed(2)}</span></div>
      <div class="drow"><span class="k">SUNNY WEIGHT</span><span>${w.weather.sunny.toFixed(2)}</span></div>
    `;
  }

  /* ===================== INIT ===================== */

  document.addEventListener("DOMContentLoaded", () => {
    initBoot();
  });

  // periodic light debug refresh
  setInterval(() => { if (debugVisible) renderDebugPanel(); }, 800);

})();
