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

const WEB_APP_URL = (window.CONFIG && window.CONFIG.WEB_APP_URL) || "";
const IS_CONFIGURED = WEB_APP_URL && !WEB_APP_URL.startsWith("PASTE_");

// ── Date helpers ─────────────────────────────────────────────
// Returns the Sunday that starts the week containing `date`,
// formatted as an ISO date string (YYYY-MM-DD) in local time.
function sundayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay()); // getDay(): 0 = Sunday
  return toISODate(d);
}
function toISODate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function prettyDate(iso) {
  // iso: YYYY-MM-DD → "Sunday, Jul 13, 2026"
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric", year: "numeric",
  });
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
let historyLoadedOnce = false;

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
    if (target === "history") {
      loadHistory({ force: !historyLoadedOnce });
    }
  });
});

// ── Build the organization checkboxes ────────────────────────
const orgList = document.getElementById("org-list");
ORGANIZATIONS.forEach((org) => {
  const label = document.createElement("label");
  label.className = "org-item";
  label.innerHTML = `
    <input type="checkbox" name="organization" value="${escapeHtml(org)}" />
    <span>${escapeHtml(org)}</span>`;
  const input = label.querySelector("input");
  input.addEventListener("change", () => {
    label.classList.toggle("checked", input.checked);
    document.getElementById("org-error").hidden = true;
  });
  orgList.appendChild(label);
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

// ── Submit check-in ──────────────────────────────────────────
const form = document.getElementById("checkin-form");
const submitBtn = document.getElementById("submit-btn");
const formStatus = document.getElementById("form-status");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formStatus.textContent = "";
  formStatus.className = "form-status";

  const name = document.getElementById("name").value.trim();
  const orgs = [...form.querySelectorAll('input[name="organization"]:checked')].map((i) => i.value);

  if (!name) {
    setStatus("Please enter your name.", "err");
    return;
  }
  if (orgs.length === 0) {
    document.getElementById("org-error").hidden = false;
    return;
  }
  if (!IS_CONFIGURED) {
    setStatus("Backend not configured — see README.md.", "err");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";

  try {
    const payload = {
      action: "checkin",
      name,
      organizations: orgs,
      week: sundayOf(new Date()),
    };
    // text/plain avoids a CORS pre-flight; Apps Script returns JSON.
    const res = await fetch(WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Server rejected the submission.");

    setStatus(`✓ Recorded — thank you, ${name}!`, "ok");
    form.reset();
    form.querySelectorAll(".org-item.checked").forEach((el) => el.classList.remove("checked"));
    historyLoadedOnce = false; // force refresh next time History is opened
  } catch (err) {
    setStatus("Could not submit: " + err.message, "err");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
  }
});

function setStatus(msg, kind) {
  formStatus.textContent = msg;
  formStatus.className = "form-status " + (kind || "");
}

// ── History ──────────────────────────────────────────────────
const statusBoard = document.getElementById("status-board");
const historyListEl = document.getElementById("history-list");
const weekLabel = document.getElementById("week-label");
const connStatus = document.getElementById("conn-status");
document.getElementById("refresh-btn").addEventListener("click", () => loadHistory({ force: true }));

async function loadHistory({ force } = {}) {
  if (!IS_CONFIGURED) {
    statusBoard.innerHTML = `<p class="muted">Configure the backend to see history.</p>`;
    historyListEl.innerHTML = "";
    return;
  }
  if (historyLoadedOnce && !force) return;

  statusBoard.innerHTML = `<p class="muted">Loading…</p>`;
  historyListEl.innerHTML = `<p class="muted">Loading…</p>`;
  connStatus.textContent = "";

  try {
    const res = await fetch(WEB_APP_URL + "?action=history", { redirect: "follow" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to load history.");
    historyLoadedOnce = true;
    renderWeekBoard(data.records || []);
    renderHistoryList(data.records || []);
    connStatus.textContent = `${(data.records || []).length} check-in(s) on record`;
  } catch (err) {
    statusBoard.innerHTML = `<p class="muted">Could not load: ${escapeHtml(err.message)}</p>`;
    historyListEl.innerHTML = "";
  }
}

// Show, for the current week's Sunday, which organizations have been checked.
function renderWeekBoard(records) {
  const thisWeek = sundayOf(new Date());
  weekLabel.textContent = "Week of " + prettyDate(thisWeek);

  // org -> list of names who checked it this week
  const checkedBy = {};
  records
    .filter((r) => r.week === thisWeek)
    .forEach((r) => {
      (r.organizations || []).forEach((org) => {
        (checkedBy[org] = checkedBy[org] || []).push(r.name);
      });
    });

  statusBoard.innerHTML = "";
  ORGANIZATIONS.forEach((org) => {
    const names = checkedBy[org];
    const done = names && names.length > 0;
    const cell = document.createElement("div");
    cell.className = "status-cell " + (done ? "yes" : "no");
    cell.innerHTML = `
      <div>
        <span class="org-name">${escapeHtml(org)}</span>
        ${done ? `<span class="who">by ${escapeHtml(uniqueNames(names))}</span>` : ""}
      </div>
      <span class="badge">${done ? "Checked" : "Not yet"}</span>`;
    statusBoard.appendChild(cell);
  });
}

function uniqueNames(names) {
  return [...new Set(names)].join(", ");
}

function renderHistoryList(records) {
  if (!records.length) {
    historyListEl.innerHTML = `<p class="muted">No check-ins yet.</p>`;
    return;
  }
  // Newest first.
  const sorted = [...records].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  historyListEl.innerHTML = "";
  sorted.forEach((r) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const chips = (r.organizations || [])
      .map((o) => `<span class="chip">${escapeHtml(o)}</span>`)
      .join("");
    row.innerHTML = `
      <div class="row-top">
        <span class="row-name">${escapeHtml(r.name)}</span>
        <span class="row-time">${escapeHtml(prettyDateTime(r.timestamp))}</span>
      </div>
      <div class="row-orgs">${chips}</div>
      <div class="row-week">Attendance week of ${escapeHtml(prettyDate(r.week))}</div>`;
    historyListEl.appendChild(row);
  });
}

// ── Util ─────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
