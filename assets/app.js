/* ──────────────────────────────────────────────────────────────
   Attendance Check-In — front-end logic
   Talks to a Google Apps Script Web App (see README.md).
   ────────────────────────────────────────────────────────────── */

// Organizations, kept in alphabetical order.
const ORGANIZATIONS = [
  "Bishopric",
  "Builders of Faith",
  "Deacons",
  "Elders Quorum",
  "Gatherers of Light",
  "Married",
  "Messengers of Hope",
  "Missionaries in the Field",
  "Primary",
  "Priests",
  "Relief Society",
  "Single Adults",
  "Teachers",
].sort((a, b) => a.localeCompare(b));
const TOTAL = ORGANIZATIONS.length;

const WEB_APP_URL = (window.CONFIG && window.CONFIG.WEB_APP_URL) || "";
const IS_CONFIGURED = WEB_APP_URL && !WEB_APP_URL.startsWith("PASTE_");

// ── State ────────────────────────────────────────────────────
let records = [];                         // all check-ins from the backend
const CURRENT_WEEK = sundayOf(new Date()); // this week's Sunday (ISO)
let selectedWeek = CURRENT_WEEK;           // week shown in the Check-In tab
let loaded = false;

// ── Date helpers ─────────────────────────────────────────────
function sundayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay()); // getDay(): 0 = Sunday
  return toISODate(d);
}
function toISODate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function shiftWeek(iso, deltaWeeks) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaWeeks * 7);
  return toISODate(dt);
}
function weeksAgo(iso) {
  const [y1, m1, d1] = CURRENT_WEEK.split("-").map(Number);
  const [y2, m2, d2] = iso.split("-").map(Number);
  const ms = new Date(y1, m1 - 1, d1) - new Date(y2, m2 - 1, d2);
  return Math.round(ms / (7 * 864e5));
}
function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric", year: "numeric",
  });
}
function shortDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function prettyDateTime(value) {
  const dt = new Date(value);
  if (isNaN(dt)) return value;
  return dt.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// ── Tab switching ────────────────────────────────────────────
const tabs = document.querySelectorAll(".tab");
const panels = {
  checkin: document.getElementById("tab-checkin"),
  history: document.getElementById("tab-history"),
};
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach((t) => {
      const active = t === tab;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    Object.entries(panels).forEach(([key, el]) => {
      const active = key === target;
      el.classList.toggle("is-active", active);
      el.hidden = !active;
    });
    if (target === "history") renderHistory();
  });
});

// ── Config banner ────────────────────────────────────────────
if (!IS_CONFIGURED) {
  const banner = document.createElement("div");
  banner.className = "banner";
  banner.innerHTML =
    "⚠️ Backend not configured yet. Add your Apps Script Web App URL to " +
    "<code>config.js</code> — see <code>README.md</code>.";
  document.querySelector(".app").insertBefore(banner, document.querySelector(".tabs"));
}

// ── Data ─────────────────────────────────────────────────────
async function loadRecords() {
  if (!IS_CONFIGURED) { loaded = true; return; }
  const res = await fetch(WEB_APP_URL + "?action=history", { redirect: "follow" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Failed to load history.");
  records = data.records || [];
  loaded = true;
}

// org -> array of names who checked it for the given week
function checkedByForWeek(week) {
  const map = {};
  records.filter((r) => r.week === week).forEach((r) => {
    (r.organizations || []).forEach((org) => {
      (map[org] = map[org] || []).push(r.name);
    });
  });
  return map;
}
function uniqueNames(names) {
  return [...new Set(names)].join(", ");
}

// ── Check-In tab rendering ───────────────────────────────────
const orgList = document.getElementById("org-list");
const orgError = document.getElementById("org-error");
const allDoneNote = document.getElementById("all-done-note");
const weekDateEl = document.getElementById("week-date");
const weekRelEl = document.getElementById("week-rel");
const weekPrev = document.getElementById("week-prev");
const weekNext = document.getElementById("week-next");
const submitBtn = document.getElementById("submit-btn");

weekPrev.addEventListener("click", () => { selectedWeek = shiftWeek(selectedWeek, -1); clearStatus(); renderCheckin(); });
weekNext.addEventListener("click", () => {
  if (selectedWeek >= CURRENT_WEEK) return;
  selectedWeek = shiftWeek(selectedWeek, 1);
  clearStatus();
  renderCheckin();
});

function renderCheckin() {
  // Week navigator
  weekDateEl.textContent = prettyDate(selectedWeek);
  const ago = weeksAgo(selectedWeek);
  weekRelEl.textContent = ago === 0 ? "This week" : ago === 1 ? "1 week ago" : `${ago} weeks ago`;
  weekNext.disabled = selectedWeek >= CURRENT_WEEK;

  if (!loaded) {
    orgList.innerHTML = `<p class="muted">Loading…</p>`;
    setProgress(0);
    return;
  }

  const checkedBy = checkedByForWeek(selectedWeek);
  const doneCount = ORGANIZATIONS.filter((o) => checkedBy[o] && checkedBy[o].length).length;

  // Organization list
  orgList.innerHTML = "";
  ORGANIZATIONS.forEach((org) => {
    const names = checkedBy[org];
    if (names && names.length) {
      const div = document.createElement("div");
      div.className = "org-item done";
      div.innerHTML = `
        <span class="org-check" aria-hidden="true">✓</span>
        <span class="org-body">
          <span class="org-name">${escapeHtml(org)}</span>
          <span class="who">by ${escapeHtml(uniqueNames(names))}</span>
        </span>
        <span class="badge badge-done">Checked</span>`;
      orgList.appendChild(div);
    } else {
      const label = document.createElement("label");
      label.className = "org-item";
      label.innerHTML = `
        <input type="checkbox" name="organization" value="${escapeHtml(org)}" />
        <span class="org-name">${escapeHtml(org)}</span>`;
      const input = label.querySelector("input");
      input.addEventListener("change", () => {
        label.classList.toggle("checked", input.checked);
        orgError.hidden = true;
      });
      orgList.appendChild(label);
    }
  });

  setProgress(doneCount);
  const allDone = doneCount === TOTAL;
  allDoneNote.hidden = !allDone;
  submitBtn.disabled = allDone;
}

function setProgress(done) {
  const pct = TOTAL ? Math.round((done / TOTAL) * 100) : 0;
  document.getElementById("donut-fill").style.strokeDasharray = `${pct} 100`;
  document.getElementById("donut-pct").textContent = pct + "%";
  document.getElementById("progress-count").textContent = `${done}/${TOTAL}`;
  const ago = weeksAgo(selectedWeek);
  document.getElementById("progress-sub").textContent =
    ago === 0 ? "for this week" : `for week of ${shortDate(selectedWeek)}`;
}

// ── Submit ───────────────────────────────────────────────────
const form = document.getElementById("checkin-form");
const formStatus = document.getElementById("form-status");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const name = document.getElementById("name").value.trim();
  const orgs = [...form.querySelectorAll('input[name="organization"]:checked')].map((i) => i.value);

  if (!name) { setStatus("Please enter your name.", "err"); return; }
  if (orgs.length === 0) { orgError.hidden = false; return; }
  if (!IS_CONFIGURED) { setStatus("Backend not configured — see README.md.", "err"); return; }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";
  try {
    const payload = { action: "checkin", name, organizations: orgs, week: selectedWeek };
    const res = await fetch(WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Server rejected the submission.");

    // Reflect the new check-ins locally, then re-render.
    records.push({ timestamp: new Date().toISOString(), name, organizations: orgs, week: selectedWeek });
    setStatus(`✓ Recorded — thank you, ${name}!`, "ok");
    document.getElementById("name").value = name; // keep the name for further entries
    renderCheckin();
    loadRecords().then(renderCheckin).catch(() => {}); // resync from server in the background
  } catch (err) {
    setStatus("Could not submit: " + err.message, "err");
  } finally {
    submitBtn.textContent = "Submit";
    if (!submitBtn.disabled) submitBtn.disabled = false;
  }
});

function setStatus(msg, kind) {
  formStatus.textContent = msg;
  formStatus.className = "form-status " + (kind || "");
}
function clearStatus() {
  formStatus.textContent = "";
  formStatus.className = "form-status";
  orgError.hidden = true;
}

// ── History tab (organization × week matrix) ─────────────────
const historyGrid = document.getElementById("history-grid");
const connStatus = document.getElementById("conn-status");
document.getElementById("refresh-btn").addEventListener("click", () => {
  historyGrid.innerHTML = `<p class="muted">Loading…</p>`;
  loadRecords().then(() => { renderHistory(); renderCheckin(); }).catch((err) => {
    historyGrid.innerHTML = `<p class="muted">Could not load: ${escapeHtml(err.message)}</p>`;
  });
});

function renderHistory() {
  if (!IS_CONFIGURED) {
    historyGrid.innerHTML = `<p class="muted">Configure the backend to see check-ins.</p>`;
    return;
  }
  if (!loaded) { historyGrid.innerHTML = `<p class="muted">Loading…</p>`; return; }

  // Columns: most recent weeks (those with data, plus the current week), newest first.
  const weeksSet = new Set(records.map((r) => r.week).filter(Boolean));
  weeksSet.add(CURRENT_WEEK);
  const weeks = [...weeksSet].sort().reverse().slice(0, 8);

  const byWeek = {};
  weeks.forEach((w) => (byWeek[w] = checkedByForWeek(w)));

  const head = weeks.map((w) => {
    const done = ORGANIZATIONS.filter((o) => byWeek[w][o] && byWeek[w][o].length).length;
    const isNow = w === CURRENT_WEEK;
    return `<th class="wk${isNow ? " wk-now" : ""}">
      <span class="wk-date">${escapeHtml(shortDate(w))}</span>
      <span class="wk-count">${done}/${TOTAL}</span>
    </th>`;
  }).join("");

  const body = ORGANIZATIONS.map((org) => {
    const cells = weeks.map((w) => {
      const names = byWeek[w][org];
      if (names && names.length) {
        return `<td class="cell yes" title="${escapeHtml(uniqueNames(names))}">
          <span class="tick">✓</span></td>`;
      }
      return `<td class="cell no"><span class="cross">·</span></td>`;
    }).join("");
    return `<tr><th class="rowhead" scope="row">${escapeHtml(org)}</th>${cells}</tr>`;
  }).join("");

  historyGrid.innerHTML = `
    <table class="matrix">
      <thead><tr><th class="corner" scope="col">Organization</th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;

  connStatus.textContent = `${records.length} check-in(s) on record`;
}

// ── Util ─────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ── Init ─────────────────────────────────────────────────────
renderCheckin();
if (IS_CONFIGURED) {
  loadRecords()
    .then(() => { renderCheckin(); renderHistory(); })
    .catch((err) => {
      loaded = true;
      renderCheckin();
      historyGrid.innerHTML = `<p class="muted">Could not load: ${escapeHtml(err.message)}</p>`;
    });
} else {
  loaded = true;
  renderCheckin();
}
