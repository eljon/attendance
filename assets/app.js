/* ──────────────────────────────────────────────────────────────
   Attendance Check-In — front-end logic
   Talks to a Google Apps Script Web App (see README.md).
   ────────────────────────────────────────────────────────────── */

// Organizations grouped into divisions. Order is intentional — do NOT sort.
const DIVISIONS = [
  { name: "Adults",      orgs: ["Elders Quorum", "Relief Society", "Single Adults", "Married"] },
  { name: "Young Men",   orgs: ["Deacons", "Teachers", "Priests"] },
  { name: "Young Women", orgs: ["Builders of Faith", "Messengers of Hope", "Gatherers of Light"] },
  { name: "Children",    orgs: ["Primary", "Nursery"] },
  { name: "Others",      orgs: ["Bishopric", "Missionaries in the Field"] },
];
// Flat list (in division order) for counts and matrix rows.
const ORGANIZATIONS = DIVISIONS.flatMap((d) => d.orgs);
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
const tabIndicator = document.querySelector(".tab-indicator");
const panels = {
  checkin: document.getElementById("tab-checkin"),
  history: document.getElementById("tab-history"),
  stats: document.getElementById("tab-stats"),
};
function positionIndicator(tab) {
  if (!tabIndicator || !tab) return;
  tabIndicator.style.width = tab.offsetWidth + "px";
  tabIndicator.style.transform = `translateX(${tab.offsetLeft}px)`;
}
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
    positionIndicator(tab);
    if (target === "history") renderHistory();
    if (target === "stats") renderStats();
  });
});
window.addEventListener("resize", () => positionIndicator(document.querySelector(".tab.is-active")));

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

// Build one organization row for the Check-In list: a static "checked"
// card (with who checked it) or a clickable checkbox.
function orgItemNode(org, names) {
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
    return div;
  }
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
  return label;
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

  // Organization list, grouped by division
  orgList.innerHTML = "";
  DIVISIONS.forEach((div) => {
    const doneInDiv = div.orgs.filter((o) => checkedBy[o] && checkedBy[o].length).length;
    const section = document.createElement("div");
    section.className = "division";
    section.innerHTML = `
      <div class="division-head">
        <span class="division-name">${escapeHtml(div.name)}</span>
        <span class="division-count${doneInDiv === div.orgs.length ? " complete" : ""}">${doneInDiv}/${div.orgs.length}</span>
      </div>`;
    const grid = document.createElement("div");
    grid.className = "org-grid";
    div.orgs.forEach((org) => grid.appendChild(orgItemNode(org, checkedBy[org])));
    section.appendChild(grid);
    orgList.appendChild(section);
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
  loadRecords().then(() => { renderHistory(); renderCheckin(); renderStats(); }).catch((err) => {
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

  const body = DIVISIONS.map((div) => {
    const sep = `<tr class="div-sep">
      <th class="rowhead div-name" scope="rowgroup">${escapeHtml(div.name)}</th>
      ${weeks.map(() => `<td class="div-fill"></td>`).join("")}
    </tr>`;
    const rows = div.orgs.map((org) => {
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
    return sep + rows;
  }).join("");

  historyGrid.innerHTML = `
    <table class="matrix">
      <thead><tr><th class="corner" scope="col">Organization</th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;

  connStatus.textContent = `${records.length} check-in(s) on record`;
}

// ── Leaderboard (gamification) ───────────────────────────────
const boardEarly = document.getElementById("board-early");
const boardFreq = document.getElementById("board-freq");
const earlyWeekEl = document.getElementById("early-week");

// 3:30 PM on the given Sunday, in the viewer's local time.
function ref330(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 15, 30, 0, 0).getTime();
}
function prettyTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
// Friendly gap from 3:30 PM, e.g. "12 min after 3:30" / "5 min early" / "1h 20m after".
function gapLabel(deltaMs) {
  const min = Math.round(deltaMs / 60000);
  if (min === 0) return { text: "right on 3:30", kind: "on" };
  const late = min > 0, a = Math.abs(min);
  const s = a < 60 ? `${a} min` : `${Math.floor(a / 60)}h ${String(a % 60).padStart(2, "0")}m`;
  return late ? { text: `${s} after 3:30`, kind: "late" } : { text: `${s} early`, kind: "early" };
}
function medal(rank) {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";
}
function rankBadge(rank) {
  const m = medal(rank);
  return m
    ? `<span class="rank-badge medal">${m}</span>`
    : `<span class="rank-badge">${rank}</span>`;
}

function renderStats() {
  if (!IS_CONFIGURED) {
    boardEarly.innerHTML = `<li class="muted board-empty">Configure the backend to see the leaderboard.</li>`;
    boardFreq.innerHTML = "";
    earlyWeekEl.textContent = "";
    return;
  }
  if (!loaded) {
    boardEarly.innerHTML = `<li class="muted board-empty">Loading…</li>`;
    boardFreq.innerHTML = `<li class="muted board-empty">Loading…</li>`;
    return;
  }

  // ── Fastest to check in ──
  // Use the most recent week (≤ this week) that has check-ins.
  const weeksWithData = [...new Set(records.map((r) => r.week).filter(Boolean))]
    .filter((w) => w <= CURRENT_WEEK).sort();
  const wk = weeksWithData.length ? weeksWithData[weeksWithData.length - 1] : CURRENT_WEEK;
  earlyWeekEl.textContent = wk === CURRENT_WEEK ? "This week" : `Week of ${shortDate(wk)}`;

  const ref = ref330(wk);
  const earliest = {};                        // name -> earliest check-in ms that week
  records.filter((r) => r.week === wk).forEach((r) => {
    const t = new Date(r.timestamp).getTime();
    if (isNaN(t)) return;
    if (!(r.name in earliest) || t < earliest[r.name]) earliest[r.name] = t;
  });
  const early = Object.entries(earliest)
    .map(([name, t]) => ({ name, t }))
    .sort((a, b) => a.t - b.t);

  if (!early.length) {
    boardEarly.innerHTML = `<li class="muted board-empty">No check-ins yet for this week.</li>`;
  } else {
    boardEarly.innerHTML = early.map((e, i) => {
      const g = gapLabel(e.t - ref);
      return `<li class="rank-row${i < 3 ? " top" : ""}">
        ${rankBadge(i + 1)}
        <span class="rank-name">${escapeHtml(e.name)}</span>
        <span class="rank-meta">
          <span class="rank-time">${escapeHtml(prettyTime(e.t))}</span>
          <span class="gap-chip ${g.kind}">${escapeHtml(g.text)}</span>
        </span>
      </li>`;
    }).join("");
  }

  // ── Most consistent (all-time distinct weeks) ──
  const weeksBy = {}, totalBy = {};
  records.forEach((r) => {
    if (!r.name) return;
    (weeksBy[r.name] = weeksBy[r.name] || new Set()).add(r.week);
    totalBy[r.name] = (totalBy[r.name] || 0) + 1;
  });
  const freq = Object.keys(weeksBy)
    .map((name) => ({ name, weeks: weeksBy[name].size, total: totalBy[name] }))
    .sort((a, b) => b.weeks - a.weeks || b.total - a.total || a.name.localeCompare(b.name));

  if (!freq.length) {
    boardFreq.innerHTML = `<li class="muted board-empty">No check-ins yet.</li>`;
  } else {
    const max = freq[0].weeks || 1;
    boardFreq.innerHTML = freq.map((f, i) => `
      <li class="rank-row${i < 3 ? " top" : ""}">
        ${rankBadge(i + 1)}
        <span class="rank-name">${escapeHtml(f.name)}</span>
        <span class="freq-wrap">
          <span class="freq-bar"><span class="freq-fill" style="width:${Math.round((f.weeks / max) * 100)}%"></span></span>
          <span class="freq-count">${f.weeks} ${f.weeks === 1 ? "wk" : "wks"}</span>
        </span>
      </li>`).join("");
  }
}

// ── Util ─────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ── Parallax backdrop + header drift ─────────────────────────
(function parallax() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const orbs = [...document.querySelectorAll(".scene .orb")];
  const header = document.getElementById("app-header");
  let mx = 0, my = 0, sy = 0, raf = 0;

  function apply() {
    raf = 0;
    orbs.forEach((o) => {
      const d = parseFloat(o.dataset.depth || "0.3");
      o.style.transform = `translate3d(${mx * d * 46}px, ${my * d * 46 + sy * d * 0.35}px, 0)`;
    });
    if (header) header.style.transform = `translateY(${sy * -0.12}px)`;
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(apply); }

  window.addEventListener("mousemove", (e) => {
    mx = (e.clientX / window.innerWidth - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
    schedule();
  }, { passive: true });
  window.addEventListener("scroll", () => { sy = window.scrollY; schedule(); }, { passive: true });
})();

// ── Init ─────────────────────────────────────────────────────
renderCheckin();
positionIndicator(document.querySelector(".tab.is-active"));
if (IS_CONFIGURED) {
  loadRecords()
    .then(() => { renderCheckin(); renderHistory(); renderStats(); })
    .catch((err) => {
      loaded = true;
      renderCheckin();
      historyGrid.innerHTML = `<p class="muted">Could not load: ${escapeHtml(err.message)}</p>`;
    });
} else {
  loaded = true;
  renderCheckin();
}
