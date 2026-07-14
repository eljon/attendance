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
const nameField = document.querySelector(".field-name");
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
  const allDoneTop = document.getElementById("all-done-top");
  // Single celebration at the top; only for a fully-checked week — it clears
  // automatically when navigating to a week that isn't complete.
  allDoneTop.hidden = !allDone;
  if (allDone) {
    const ago = weeksAgo(selectedWeek);
    const when = ago === 0 ? "this week" : `the week of ${shortDate(selectedWeek)}`;
    document.getElementById("all-done-top-sub").textContent =
      `Every one of the ${TOTAL} organizations has reported for ${when}. Thank you, Kalayaan Ward! 🙌`;
  }
  document.querySelector(".donut").classList.toggle("complete", allDone);
  // Nothing to submit when the week is already complete — hide the name field
  // and submit button; they return for any not-yet-complete week.
  if (nameField) nameField.hidden = allDone;
  submitBtn.hidden = allDone;
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

// ── Name autocomplete (custom, uniform across browsers) ──────
// Suggestions are everyone who has reported before — every distinct name in
// the shared database. A fully custom dropdown (no native <datalist>) so it
// looks identical on every device.
const nameInput = document.getElementById("name");
const nameListbox = document.getElementById("name-listbox");
let nameList = [];        // all distinct names, sorted
let comboMatches = [];    // currently shown matches
let comboActive = -1;     // highlighted index

function updateNameSuggestions() {
  nameList = [...new Set(records.map((r) => r.name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  if (nameListbox && !nameListbox.hidden) renderCombo();
}
function highlightMatch(name, q) {
  if (!q) return escapeHtml(name);
  const i = name.toLowerCase().indexOf(q);
  if (i < 0) return escapeHtml(name);
  return escapeHtml(name.slice(0, i)) + "<mark>" + escapeHtml(name.slice(i, i + q.length)) +
    "</mark>" + escapeHtml(name.slice(i + q.length));
}
function renderCombo() {
  const q = nameInput.value.trim().toLowerCase();
  comboMatches = nameList.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
  comboActive = -1;
  nameInput.removeAttribute("aria-activedescendant");
  if (!comboMatches.length) { closeCombo(); return; }
  nameListbox.innerHTML = comboMatches.map((n, i) =>
    `<li class="combo-opt" role="option" id="name-opt-${i}" data-i="${i}">${highlightMatch(n, q)}</li>`
  ).join("");
  nameListbox.hidden = false;
  nameInput.setAttribute("aria-expanded", "true");
}
function closeCombo() {
  if (!nameListbox) return;
  nameListbox.hidden = true;
  nameListbox.innerHTML = "";
  comboActive = -1;
  nameInput.setAttribute("aria-expanded", "false");
  nameInput.removeAttribute("aria-activedescendant");
}
function setComboActive(i) {
  const opts = [...nameListbox.querySelectorAll(".combo-opt")];
  if (!opts.length) return;
  comboActive = (i + opts.length) % opts.length;
  opts.forEach((o, idx) => o.classList.toggle("active", idx === comboActive));
  const el = opts[comboActive];
  el.scrollIntoView({ block: "nearest" });
  nameInput.setAttribute("aria-activedescendant", el.id);
}
function chooseCombo(i) {
  if (i < 0 || i >= comboMatches.length) return;
  nameInput.value = comboMatches[i];
  closeCombo();
  nameInput.focus();
}
if (nameInput) {
  nameInput.addEventListener("input", renderCombo);
  nameInput.addEventListener("focus", renderCombo);
  nameInput.addEventListener("blur", () => setTimeout(closeCombo, 120)); // let a click land first
  nameInput.addEventListener("keydown", (e) => {
    if (nameListbox.hidden) { if (e.key === "ArrowDown") renderCombo(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setComboActive(comboActive + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setComboActive(comboActive - 1); }
    else if (e.key === "Enter" && comboActive >= 0) { e.preventDefault(); chooseCombo(comboActive); }
    else if (e.key === "Escape") { closeCombo(); }
  });
  nameListbox.addEventListener("mousedown", (e) => {
    const li = e.target.closest(".combo-opt");
    if (!li) return;
    e.preventDefault();               // keep focus; prevents blur from closing before the pick
    chooseCombo(Number(li.dataset.i));
  });
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
    updateNameSuggestions();
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
  loadRecords().then(() => { renderHistory(); renderCheckin(); renderStats(); updateNameSuggestions(); }).catch((err) => {
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

  const doneCountFor = (w) => ORGANIZATIONS.filter((o) => byWeek[w][o] && byWeek[w][o].length).length;
  const head = weeks.map((w) => {
    const done = doneCountFor(w);
    const isNow = w === CURRENT_WEEK;
    const complete = done === TOTAL;
    return `<th class="wk${isNow ? " wk-now" : ""}${complete ? " wk-complete" : ""}">
      <span class="wk-date">${escapeHtml(shortDate(w))}</span>
      <span class="wk-count">${complete ? "🎉 " : ""}${done}/${TOTAL}</span>
    </th>`;
  }).join("");

  // Celebration banner when the current week is fully checked.
  const nowDone = doneCountFor(CURRENT_WEEK);
  document.getElementById("history-celebrate").innerHTML = nowDone === TOTAL
    ? `<div class="celebrate">
         <span class="celebrate-emoji">🎉</span>
         <div class="celebrate-body">
           <strong class="celebrate-title">This week is complete!</strong>
           <span class="celebrate-sub">All ${TOTAL} organizations have reported their attendance. Great teamwork! 🙌</span>
         </div>
       </div>`
    : "";

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
const earlyNote = document.getElementById("early-note");
let earlyMode = "all";   // "all" (averaged) | "week"

document.getElementById("early-mode").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn || btn.dataset.mode === earlyMode) return;
  earlyMode = btn.dataset.mode;
  [...e.currentTarget.querySelectorAll(".seg-btn")].forEach((b) => b.classList.toggle("is-on", b === btn));
  renderStats();
});

// 3:30 PM Philippine time (Asia/Manila = UTC+8, no DST) for a Sunday,
// as an absolute epoch ms. 15:30 Manila == 07:30 UTC on the same date.
function ref330Manila(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 7, 30, 0, 0);
}
function timeManila(ms) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
}
// Minutes → "8 min" / "1h 05m" / "on time" (≤ 0).
function fmtDur(min) {
  min = Math.round(min);
  if (min <= 0) return "on time";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
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
  // Each person's best (earliest) score per week, in minutes after 3:30 PM
  // Manila, clamped so anything at/before 3:30 PM counts as 0.
  const perPersonWeek = {};   // name -> { week -> { score, t } }
  records.forEach((r) => {
    if (!r.name || !r.week) return;
    const t = new Date(r.timestamp).getTime();
    if (isNaN(t)) return;
    const score = Math.max(0, (t - ref330Manila(r.week)) / 60000);
    const pw = (perPersonWeek[r.name] = perPersonWeek[r.name] || {});
    if (!(r.week in pw) || score < pw[r.week].score) pw[r.week] = { score, t };
  });

  if (earlyMode === "all") {
    earlyNote.innerHTML =
      "Average time after <strong>3:30&nbsp;PM</strong> (Manila) across every Sunday reported. Checking in before 3:30 counts as 0.";
    const rows = Object.entries(perPersonWeek).map(([name, weeks]) => {
      const scores = Object.values(weeks).map((x) => x.score);
      const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
      return { name, avg, weeks: scores.length };
    }).sort((a, b) => a.avg - b.avg || b.weeks - a.weeks || a.name.localeCompare(b.name));

    boardEarly.innerHTML = rows.length
      ? rows.map((e, i) => `
          <li class="rank-row${i < 3 ? " top" : ""}">
            ${rankBadge(i + 1)}
            <span class="rank-name">${escapeHtml(e.name)}</span>
            <span class="rank-meta">
              <span class="rank-time">${escapeHtml(fmtDur(e.avg))}${e.avg > 0 ? " avg" : ""}</span>
              <span class="gap-chip neutral">${e.weeks} ${e.weeks === 1 ? "wk" : "wks"}</span>
            </span>
          </li>`).join("")
      : `<li class="muted board-empty">No check-ins yet.</li>`;
  } else {
    // Most recent week (≤ this week) that has data.
    const weeksWithData = [...new Set(records.map((r) => r.week).filter(Boolean))]
      .filter((w) => w <= CURRENT_WEEK).sort();
    const wk = weeksWithData.length ? weeksWithData[weeksWithData.length - 1] : CURRENT_WEEK;
    earlyNote.innerHTML =
      `How soon after <strong>3:30&nbsp;PM</strong> (Manila) they reported — week of ${escapeHtml(shortDate(wk))}. Before 3:30 counts as 0.`;

    const rows = Object.entries(perPersonWeek)
      .filter(([, weeks]) => wk in weeks)
      .map(([name, weeks]) => ({ name, score: weeks[wk].score, t: weeks[wk].t }))
      .sort((a, b) => a.score - b.score || a.t - b.t || a.name.localeCompare(b.name));

    boardEarly.innerHTML = rows.length
      ? rows.map((e, i) => `
          <li class="rank-row${i < 3 ? " top" : ""}">
            ${rankBadge(i + 1)}
            <span class="rank-name">${escapeHtml(e.name)}</span>
            <span class="rank-meta">
              <span class="rank-time">${escapeHtml(timeManila(e.t))}</span>
              <span class="gap-chip ${e.score <= 0 ? "on" : "late"}">${e.score <= 0 ? "on time" : escapeHtml(fmtDur(e.score)) + " after"}</span>
            </span>
          </li>`).join("")
      : `<li class="muted board-empty">No check-ins yet for this week.</li>`;
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
      o.style.transform = `translate3d(${mx * d * 80}px, ${my * d * 80 + sy * d * 0.55}px, 0)`;
    });
    if (header) header.style.transform = `translateY(${sy * -0.22}px)`;
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
updateNameSuggestions();
positionIndicator(document.querySelector(".tab.is-active"));
if (IS_CONFIGURED) {
  loadRecords()
    .then(() => { renderCheckin(); renderHistory(); renderStats(); updateNameSuggestions(); })
    .catch((err) => {
      loaded = true;
      renderCheckin();
      historyGrid.innerHTML = `<p class="muted">Could not load: ${escapeHtml(err.message)}</p>`;
    });
} else {
  loaded = true;
  renderCheckin();
}
