// Front end: no API keys here. Every Aivana call goes through the Node.js backend.
// Three tabs: Season, Plan a trip (4-step wizard: request -> compare -> review & approve -> trip plan), Settings.
const $ = (id) => document.getElementById(id);
const money = (n) => (Number(n) < 0 ? "-$" : "$") + Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (iso) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
const hrs = (h) => (Number(h) < 1 ? `${Math.max(1, Math.round(Number(h) * 60))} min` : `${Number(h).toFixed(Number(h) % 1 ? 1 : 0)} hrs`);
const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
const gapText = (gap) => (Math.abs(gap) < 0.005 ? "On budget" : gap >= 0 ? `${money(gap)} under budget` : `${money(-gap)} over budget`);

const SETTING_LABELS = {
  rule_earliest_departure_hour: "Earliest departure",
  rule_max_gameday_travel_hours: "Max hours on the bus on game day",
  pregame_meal_hours_before: "Pregame meal (hours before kickoff)",
  rule_latest_checkin_hour: "Latest hotel check-in",
  rule_latest_return_hour: "Home by",
  driver_max_hours: "Max driving hours per driver",
  arrival_buffer_hours: "Arrive (hours before kickoff)",
  require_bus_parking: "Hotel needs bus parking", require_meeting_room: "Hotel needs a meeting room",
  policy_overnight_min_miles: "Overnight only if over (miles)", policy_lodging_rate_limit: "Hotel rate limit ($/night)",
  policy_flight_booking_days: "Buy flights at least (days ahead)", priority_per_diem_day_trip: "No per-diem cash on day trips",
  policy_expense_report_days: "Expense report due (days)",
  season_overbudget_pct: "Season may go over budget to keep must-haves (%)",
  seats_per_bus: "Seats per bus", players_per_room: "Players per room", staff_per_room: "Coaches/staff per room",
  meal_allowance: "Meal allowance ($/person)", breakfast_allowance: "Breakfast allowance ($/person)",
  postgame_meal_cost: "Postgame boxed meal ($/person)", hotel_tax_rate: "Hotel tax rate (0.10 = 10%)",
  hotel_max_rate: "Hotel rate cap ($/night, blank = none)", second_driver_cost: "Second driver ($/bus)",
  extras_per_person_per_day: "Supplies per traveler per day ($)", extras_flat_per_trip: "Flat supplies per trip ($)",
  game_length_hours: "Game length (hrs)", postgame_hours: "Postgame time before leaving (hrs)",
  overnight_depart_hour: "Usual departure the day before", post_stay_departure_hour: "Departure the morning after",
  local_bus_mph: "Local bus speed (mph)",
  priority_depart_earliest: "", priority_gameday_travel: "", priority_pregame_meal: "", priority_checkin: "",
  priority_home_by: "", priority_overnight_needed: "", priority_flight_booking: "", priority_lodging_rate: "",
};
// Each rule's level sits next to the rule it belongs to.
const PRIORITY_FOR = {
  rule_earliest_departure_hour: "priority_depart_earliest", rule_max_gameday_travel_hours: "priority_gameday_travel",
  pregame_meal_hours_before: "priority_pregame_meal", rule_latest_checkin_hour: "priority_checkin",
  rule_latest_return_hour: "priority_home_by", policy_overnight_min_miles: "priority_overnight_needed",
  policy_flight_booking_days: "priority_flight_booking", policy_lodging_rate_limit: "priority_lodging_rate",
};
const POLICY_NOTE = "Example policy value – confirm with BGSU Travel Services";
const POLICY_VALUES = new Set(["policy_overnight_min_miles", "policy_lodging_rate_limit", "policy_flight_booking_days", "policy_expense_report_days"]);
const LEVELS = { 3: "must-have", 2: "important", 1: "nice-to-have" };
const lvlTag = (p) => `<span class="lvl lvl-${p ?? 2}">${LEVELS[p ?? 2]}</span>`;
const ruleItem = (x) => `<li class="${x.ok ? "ok" : "no"}">${esc(x.rule)} <span class="muted">(${esc(x.actual)})</span>${x.ok ? "" : " " + lvlTag(x.priority)}</li>`;
const levelSummary = (b) => !b ? "" : [[b.must, "must-have"], [b.important, "important"], [b.nice, "nice-to-have"]]
  .filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(", ");
const hourLabel = (h) => {
  if (h === 24) return "Midnight";
  const next = h >= 24, hh = h % 24, H = Math.floor(hh), M = Math.round((hh - H) * 60);
  const t = new Date(2000, 0, 1, H, M).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return next ? `${t} (next day)` : t;
};
const range = (a, b, step = 0.5) => { const o = []; for (let x = a; x <= b + 1e-9; x += step) o.push(Math.round(x * 100) / 100); return o; };
const TIME_CHOICES = {
  rule_earliest_departure_hour: range(4, 12), rule_latest_checkin_hour: range(18, 26),
  rule_latest_return_hour: range(20, 30), overnight_depart_hour: range(6, 20), post_stay_departure_hour: range(6, 14),
};
const BOOL_SETTINGS = new Set(["require_bus_parking", "require_meeting_room"]);
const STORE_KEY = "bgsu-away-game-planner:v3";
const TAB_KEY = "bgsu-away-game-planner:tab";

const state = { req: null, overrides: {}, defaults: {}, groups: {}, roles: [], plan: null, selected: null, custom: null,
  rec: null, history: [], changeLog: [], approval: null, voidReason: null, details: null, memo: "", step: 1 };
const ctx = () => ({ request: state.req, settings: state.overrides, custom: state.custom });
const snapshot = () => clone({ req: state.req, overrides: state.overrides, custom: state.custom, selected: state.selected });

// ------------------------------------------------------------------ saving (this browser only)
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ form: readForm(), text: $("freetext").value, settings: readSettings(),
      req: state.req, overrides: state.overrides, selected: state.selected, custom: state.custom, history: state.history,
      chat: $("chat-log").innerHTML, changeLog: state.changeLog, approval: state.approval, savedAt: new Date().toISOString() }));
  } catch { /* storage unavailable: app still works */ }
}
function loadSaved() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { return null; } }
function clearSaved() { try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ } }

// ------------------------------------------------------------------ "Aivana is working" indicator
const AI_LABELS = { "/api/parse": "Aivana is reading the request", "/api/recommend": "Aivana is comparing the options",
  "/api/whatif": "Aivana is working on your message", "/api/season/explain": "Aivana is explaining the season plan",
  "/api/memo": "Aivana is writing the memo", "/api/hotels/search": "Aivana is searching the web for hotels",
  "/api/hotels/recommend": "Aivana is comparing the hotels" };
const ai = { jobs: [], timer: null };
function aiStart(path) {
  const job = { label: AI_LABELS[path], t0: Date.now() };
  ai.jobs.push(job);
  document.body.classList.add("ai-busy");
  $("ai-status").classList.remove("hidden");
  const tick = () => {
    const cur = ai.jobs[ai.jobs.length - 1]; if (!cur) return;
    const s = Math.floor((Date.now() - cur.t0) / 1000);
    $("ai-status-text").textContent = `${cur.label}…${s >= 2 ? ` ${s}s` : ""}`;
  };
  tick();
  if (!ai.timer) ai.timer = setInterval(tick, 1000);
  return () => {
    ai.jobs = ai.jobs.filter((j) => j !== job);
    if (!ai.jobs.length) {
      clearInterval(ai.timer); ai.timer = null;
      document.body.classList.remove("ai-busy");
      $("ai-status").classList.add("hidden");
    }
  };
}
const thinking = (text) => `<div class="thinking"><span class="dots"><i></i><i></i><i></i></span>${esc(text)}</div>`;

// ------------------------------------------------------------------ helpers
function showError(msg) {
  const el = $("error");
  if (!msg) { el.classList.add("hidden"); return; }
  el.textContent = msg; el.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function api(path, payload) {
  showError("");
  const done = AI_LABELS[path] ? aiStart(path) : null;
  let res;
  try {
    res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
  } catch (e) { done?.(); showError("Can't reach the app server. Is it still running?"); throw e; }
  const data = await res.json().catch(() => ({}));
  done?.();
  if (!res.ok) {
    if (data.code === "approval_stale") { voidApproval("the plan changed after it was approved"); }
    const parts = [data.error || `Request failed (${res.status})`];
    if (data.errors?.length) parts.push(data.errors.join(" "));
    if (data.request_id) parts.push(`(request id ${data.request_id})`);
    showError(parts.join(" "));
    const err = new Error(parts.join(" ")); err.data = data; throw err;
  }
  refreshUsage();
  return data;
}

async function refreshUsage() {
  try {
    const u = await (await fetch("/api/usage")).json();
    $("usage").textContent = u.calls ? `${u.calls} Aivana call${u.calls === 1 ? "" : "s"}` : "";
    $("usage").title = `Tokens in/out: ${u.input_tokens}/${u.output_tokens} · reused answers: ${u.cache_hits || 0}\n` +
      Object.entries(u.by_kind || {}).map(([k, v]) => `${k}: ${v.calls} calls`).join("\n");
  } catch { /* ignore */ }
}

function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "Working…"; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

// ------------------------------------------------------------------ tabs + steps
function showTab(name) {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  try { localStorage.setItem(TAB_KEY, name); } catch { /* ignore */ }
  window.scrollTo({ top: 0 });
}

const maxStep = () => (state.approval ? 4 : state.selected && state.details ? 3 : state.plan ? 2 : 1);
function goStep(n) {
  state.step = Math.min(n, maxStep());
  document.querySelectorAll(".step-panel").forEach((p) => p.classList.toggle("active", p.id === `step${state.step}`));
  updateStepper();
  window.scrollTo({ top: 0 });
}
function updateStepper() {
  const top = maxStep();
  if (state.step > top) state.step = top;
  document.querySelectorAll(".stepper [data-step]").forEach((b) => {
    const n = Number(b.dataset.step);
    b.className = n === state.step ? "now" : n <= top ? "done" : "";
    b.disabled = n > top;
    if (n === state.step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
  });
  document.querySelectorAll(".step-panel").forEach((p) => p.classList.toggle("active", p.id === `step${state.step}`));
}

function openChat(open = true) {
  $("chat-drawer").classList.toggle("open", open);
  $("chat-drawer").setAttribute("aria-hidden", String(!open));
  $("drawer-scrim").classList.toggle("hidden", !open);
  if (open) setTimeout(() => $("chat-input").focus(), 50);
}

// ------------------------------------------------------------------ form <-> state
function readForm() {
  const v = (id) => $(id).value.trim();
  return { game_id: v("f-game"), num_players: v("f-players"), num_coaches: v("f-coaches"), num_staff: v("f-staff"),
    budget: v("f-budget"), depart_after: v("f-depart") };
}

function fillForm(req) {
  const set = (id, val) => { if (val !== undefined && val !== null) $(id).value = val; };
  set("f-game", req.game_id); set("f-players", req.num_players); set("f-coaches", req.num_coaches);
  set("f-staff", req.num_staff); set("f-budget", req.budget); set("f-depart", req.depart_after);
}

function readSettings() {
  const out = {};
  for (const key of Object.keys(SETTING_LABELS)) {
    const el = $("s-" + key); if (!el) continue;
    const val = el.value.trim(), def = state.defaults[key];
    if (val === "" && key === "hotel_max_rate") { if (def !== null) out[key] = ""; continue; }
    if (val !== "" && Number(val) !== def) out[key] = Number(val);
  }
  return out;
}

function fillSettings(overrides) {
  for (const key of Object.keys(SETTING_LABELS)) {
    const el = $("s-" + key); if (!el) continue;
    const val = key in overrides ? overrides[key] : state.defaults[key];
    el.value = val === null || val === undefined ? "" : val;
  }
  renderRulesSummary();
}

function renderRulesSummary() {
  const v = (k) => { const el = $("s-" + k); return el && el.value !== "" ? Number(el.value) : state.defaults[k]; };
  $("rules-summary").textContent = `Rules: leave after ${hourLabel(v("rule_earliest_departure_hour"))}, ` +
    `max ${v("rule_max_gameday_travel_hours")} hrs on the bus on game day, home by ${hourLabel(v("rule_latest_return_hour"))}.`;
}

// ------------------------------------------------------------------ change log + approval voiding
function impactFromPlans(before, after) {
  if (!before || !after) return [];
  const out = [];
  for (const p of after.packages) {
    const o = before.packages.find((x) => x.option_id === p.option_id);
    if (!o) { out.push(`${p.option_id} added: ${money(p.costs.total)}`); continue; }
    if (o.costs.total !== p.costs.total || o.rules_broken !== p.rules_broken) {
      out.push(`${p.option_id}: ${money(o.costs.total)} → ${money(p.costs.total)}` +
        (o.rules_broken !== p.rules_broken ? `, rules broken ${o.rules_broken} → ${p.rules_broken}` : ""));
    }
  }
  for (const o of before.packages) if (!after.packages.some((p) => p.option_id === o.option_id)) out.push(`${o.option_id} no longer offered`);
  return out.length ? out : ["No change to any total or rule"];
}

function logChange(source, text, applied, impact, snap) {
  state.changeLog.push({ n: state.changeLog.length + 1, source, text, applied: applied || [], impact: impact || [], snap,
    at: new Date().toISOString() });
  renderChangeLog();
}

function renderChangeLog() {
  const log = state.changeLog;
  $("change-log").innerHTML = log.length ? log.map((c) => `<li><span class="src">${esc(c.source)}</span>${esc(c.text)}
      ${c.impact.map((i) => `<span class="impact">${esc(i)}</span>`).join("")}</li>`).join("")
    : '<li class="muted">No changes yet.</li>';
  $("change-count").textContent = log.length ? `(${log.length})` : "";
  $("btn-undo").disabled = !log.length;
}

function changeSummaryForAi() {
  return state.changeLog.map((c) => `${c.source}: ${c.text}${c.applied.length ? " (" + c.applied.join("; ") + ")" : ""}`);
}

function voidApproval(reason) {
  if (state.approval) {
    state.approval = null;
    state.voidReason = reason;
    renderApproval();
    updateStepper();
  }
}

// ------------------------------------------------------------------ season
function seasonInputs() {
  const settings = readSettings();
  const sb = $("season-budget").value;
  if (sb !== "") settings.season_travel_budget = Number(sb);
  const f = readForm();
  return { settings, party: { num_players: f.num_players || 22, num_coaches: f.num_coaches || 4, num_staff: f.num_staff || 3 } };
}

async function loadSeason() {
  const sb = $("season-budget").value;
  let out;
  try { out = await api("/api/season", seasonInputs()); } catch { return; }
  if (sb === "") $("season-budget").value = out.season_budget;
  $("season-explain").innerHTML = "";
  $("season-method").textContent = out.method;
  $("season-totals").textContent = `Travel party: ${out.party.num_players} players, ${out.party.num_coaches} coaches, ` +
    `${out.party.num_staff} staff. Planning each trip on its own would cost ${money(out.total_estimated)}.`;
  renderSeasonPlan(out);
  renderFixtures(out);
  renderSeasonHotels(out);
  renderBench(out);
}

function renderSeasonPlan(out) {
  const o = out.optimizer, pl = o && o.plan;
  const warns = (o?.warnings || []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("");
  if (!pl) { $("season-plan").innerHTML = warns; return; }
  const status = pl.over_budget ? `<span class="gap bad">${money(-pl.gap)} over</span>` : `<span class="gap ok">${money(pl.gap)} left</span>`;
  const rules = levelSummary(pl.broken) ? `${esc(levelSummary(pl.broken))} rule${pl.broken.must + pl.broken.important + pl.broken.nice > 1 ? "s" : ""} broken` : "every rule kept";
  $("season-plan").innerHTML = `<span><span class="big">${money(pl.total)}</span> <span class="of">of ${money(o.budget)}</span></span>
    <span class="status">${status}</span><span class="${pl.broken.must ? "err" : "muted"}">${rules}</span>${warns}`;

  // What changed + side-by-side (only when there is something to show)
  const planLine = (p) => p.picks.map((x) => x.option_id).join(" · ");
  const order = pl.picks.map((x) => esc(x.opponent.split(" ")[0])).join(" · ");
  const side = !o.same_as_strict && o.strict ? `<div class="table-wrap"><table class="tbl"><tr><th></th><th>Picks <span class="muted">(${order})</span></th><th class="num">Total</th><th>Broken</th></tr>
      <tr><td><strong>Keep must-haves</strong></td><td>${planLine(pl)}</td><td class="num">${money(pl.total)}</td><td>${esc(levelSummary(pl.broken) || "none")}</td></tr>
      <tr><td>Strict budget</td><td>${planLine(o.strict)}</td><td class="num">${money(o.strict.total)}</td><td>${esc(levelSummary(o.strict.broken) || "none")}</td></tr></table></div>` : "";
  $("season-changes").innerHTML = (o.changes.length ? `<ul>${o.changes.map((c) => `<li>${esc(c.text)}</li>`).join("")}</ul>` :
    '<p class="muted small">Every game keeps the pick it would get on its own.</p>') + side;
  $("season-changes-box").querySelector("summary").textContent = `What changed (${o.changes.length})`;
}

function renderFixtures(out) {
  $("season-table").innerHTML = out.games.map((g) => {
    const d = new Date(g.date + "T" + g.kickoff), p = g.season_pick;
    const broken = p && levelSummary(p.broken);
    return `<li class="fixture">
      <div class="fx-date"><span class="d">${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span><span class="w">${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span></div>
      <div class="fx-opp"><strong>${esc(g.opponent)}</strong><span class="small muted">${g.miles} mi</span></div>
      <div class="fx-pick">${p ? `<span class="letter">${esc(p.option_id)}</span>${esc(shortName(p.name))}${p.changed ? '<span class="tag">changed</span>' : ""}
        ${broken ? `<div class="small ${p.broken.must ? "err" : "muted"}">${esc(broken)} broken</div>` : ""}` : '<span class="muted">No option</span>'}</div>
      <div class="fx-cost">${p ? money(p.cost) : "—"}</div>
      <div class="fx-btn"><button class="btn" data-plan="${g.game_id}" data-budget="${g.allocated_budget}" data-date="${g.date}">Plan</button></div>
    </li>`;
  }).join("");
  document.querySelectorAll("[data-plan]").forEach((b) => b.addEventListener("click", () => planFromSeason(b.dataset)));
}

// "Bus + overnight at Lakeview Inn (lowest rate)" -> "Overnight, Lakeview Inn"
function shortName(name) {
  return String(name).replace(/\s*\((lowest rate|closest|staff choice|stay after the game)\)/, "")
    .replace(/^Bus day trip$/, "Day trip").replace(/^Bus \+ overnight at /, "1 night, ").replace(/^Bus \+ 2 nights at /, "2 nights, ")
    .replace(/^Flight \(group fare\) \+ overnight at /, "Flight + 1 night, ");
}

function renderSeasonHotels(out) {
  const yn = (b) => (b ? "yes" : "no");
  $("season-hotels").innerHTML = out.games.filter((g) => g.hotels.length).map((g) => `<div><strong>${esc(g.opponent)}</strong>
    ${g.hotels.map((h) => `<div class="hotel-line">${esc(h.label)}: ${esc(h.name)}, ${money(h.nightly_rate)}/night${h.within_rate_limit ? "" : ' <span class="err">(above rate limit)</span>'}, ${h.miles_to_stadium} mi to stadium, meeting room ${yn(h.meeting_room)}</div>`).join("")}
    ${g.hotels_excluded.length ? `<div class="small muted">Not usable: ${g.hotels_excluded.map((x) => `${esc(x.name)} (${esc(x.reason)})`).join("; ")}</div>` : ""}</div>`).join("") ||
    '<p class="muted small">No overnight trips this season.</p>';
}

function renderBench(out) {
  if (!out.benchmarks?.length) { $("bench").innerHTML = ""; return; }
  const src = out.benchmark_source, rows = out.benchmarks;
  $("bench").innerHTML = `<p class="small muted">Synthetic sample seasons (not real records), used only to suggest a season budget.</p>
    <div class="table-wrap"><table><tr><th>Year</th><th class="num">Team travel</th><th class="num">Per away trip</th><th class="num">Per player per trip</th><th class="num">Season budget at this rate</th><th></th></tr>
    ${rows.map((x) => `<tr${x.key === "avg" ? ' style="font-weight:600"' : ""}><td>${esc(x.fiscal_year)}</td><td class="num">${money(x.team_travel)}</td><td class="num">${money(x.per_trip)}</td><td class="num">${money(x.per_player_per_trip)}</td><td class="num">${money(x.season_budget_for_party)}</td>
      <td><button class="btn" data-bench="${x.season_budget_for_party}">Use</button></td></tr>`).join("")}</table></div>
    ${src ? `<p class="small muted">Source: ${src.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.title)}</a>` : esc(src.title)}</p>` : ""}`;
  document.querySelectorAll("[data-bench]").forEach((b) => b.addEventListener("click", () => {
    $("season-budget").value = Math.round(Number(b.dataset.bench) / 100) * 100; loadSeason();
  }));
}

async function explainSeason() {
  const btn = $("btn-season-explain");
  busy(btn, true, "Explaining…");
  $("season-explain").innerHTML = `<div class="ai-box">${thinking("Aivana is explaining the season plan…")}</div>`;
  let out;
  try { out = await api("/api/season/explain", seasonInputs()); }
  catch { $("season-explain").innerHTML = ""; return; } finally { busy(btn, false); }
  const e = out.explanation, bad = [...(e.unverified_numbers || []), ...(e.unverified_claims || [])];
  $("season-explain").innerHTML = `<div class="ai-box"><strong>${esc(e.headline)}</strong> ${esc(e.explanation)}
    <div class="verify ${bad.length ? "bad" : "ok"}">${bad.length ? "⚠ Not verified: " + bad.map(esc).join("; ") : "✓ Every number matches the season plan."}</div></div>`;
}

function planFromSeason(d) {
  const day = new Date(d.date + "T12:00"); day.setDate(day.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  fillForm({ game_id: d.plan, budget: d.budget, depart_after: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T12:00` });
  if (!readForm().num_players) fillForm({ num_players: 22, num_coaches: 4, num_staff: 3 });
  $("freetext").value = "";
  $("parse-notes").innerHTML = `Filled from the season plan: budget ${money(d.budget)}, leave after noon the day before.`;
  $("parse-notes").classList.remove("hidden");
  showTab("plan"); goStep(1);
}

// ------------------------------------------------------------------ step 1
const FIELD_NAMES = { game_id: "the game", num_players: "players", num_coaches: "coaches", num_staff: "staff",
  budget: "budget", depart_after: "earliest departure" };
const FORM_IDS = { game_id: "f-game", num_players: "f-players", num_coaches: "f-coaches", num_staff: "f-staff",
  budget: "f-budget", depart_after: "f-depart" };

async function parseRequest() {
  const btn = $("btn-parse");
  if ($("freetext").value.trim().length < 10) {
    showError("Describe the trip first, or use the example."); $("freetext").focus(); return;
  }
  busy(btn, true, "Reading…");
  try {
    const out = await api("/api/parse", { text: $("freetext").value });
    // Every field comes from this description: anything it doesn't state is cleared, never kept from an earlier trip.
    const missing = Object.keys(FORM_IDS).filter((k) => out.request[k] === null || out.request[k] === undefined);
    for (const k of missing) $(FORM_IDS[k]).value = "";
    fillForm(out.request);
    document.querySelectorAll(".form input, .form select").forEach((e) => e.classList.remove("missing", "assumed"));
    for (const k of missing) $(FORM_IDS[k]).classList.add("missing");
    for (const k of out.assumed || []) $(FORM_IDS[k]).classList.add("assumed");
    const notes = [...(out.notes || [])];
    if (missing.length) notes.push(`Not in your description: ${missing.map((k) => FIELD_NAMES[k]).join(", ")}. Fill ${missing.length > 1 ? "them" : "it"} in below.`);
    (out.assumptions || []).filter((a) => !/offline mock/i.test(a)).forEach((a) => notes.push(`Aivana assumed: ${a}`));
    (out.warnings || []).forEach((w) => notes.push(w.replace("No departure constraint given; assumed", "No departure time given, so it's set to") + (w.startsWith("No departure") ? " Change it if needed." : "")));
    $("parse-notes").innerHTML = notes.length ? "<ul>" + notes.map((n) => `<li>${esc(n)}</li>`).join("") + "</ul>" : "";
    $("parse-notes").classList.toggle("hidden", !notes.length);
  } catch { $("parse-notes").classList.add("hidden"); /* banner shown */ } finally { busy(btn, false); }
}

async function compare() {
  $("form-errors").textContent = "";
  const btn = $("btn-compare");
  busy(btn, true, "Calculating…");
  try {
    state.overrides = readSettings();
    const out = await api("/api/plan", { request: readForm(), settings: state.overrides });
    voidApproval("the request was compared again");
    state.req = out.request; state.plan = out.plan; state.selected = null; state.details = null; state.custom = null; state.rec = null;
    state.history = []; state.changeLog = []; $("chat-log").innerHTML = ""; renderChangeLog();
    renderPlan();
    goStep(2);
    recommend(); save();
  } catch (e) {
    if (e.data?.errors) $("form-errors").textContent = e.data.errors.join(" ");
  } finally { busy(btn, false); }
}

// ------------------------------------------------------------------ step 2
function renderPlan() {
  const p = state.plan, r = state.req, c = p.counts;
  const kick = new Date(p.game.date + "T" + p.game.kickoff).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  $("trip-title").textContent = `${p.game.opponent}, ${kick}`;
  $("trip-summary").textContent = `${p.game.miles} miles · ${c.travelers} travelers (${r.num_players} players, ${r.num_coaches} coaches, ${r.num_staff} staff) · ${c.buses} bus${c.buses === 1 ? "" : "es"} · ${c.rooms} rooms · budget ${money(p.budget)}`;
  const notes = [...(p.notes || []), ...(p.warnings || [])];
  $("plan-notes").innerHTML = notes.length ? `<div class="note"><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : "";
  const recId = state.rec?.recommended_option_id;
  $("options").innerHTML = p.packages.map((o) => {
    const f = o.facts, marks = [];
    if (recId === o.option_id) marks.push('<span class="mark ai">★ Aivana\'s pick</span>');
    if (o.labels.includes("best_within_budget")) marks.push('<span class="mark">Best within budget</span>');
    if (o.labels.includes("best_fit_rules")) marks.push('<span class="mark">Best for rules</span>');
    if (!o.feasible) marks.push('<span class="mark no">Not possible</span>');
    const broken = [...o.rule_checks, ...(o.policy_checks || [])].filter((x) => !x.ok)
      .sort((a, b) => (b.priority ?? 2) - (a.priority ?? 2));
    const isSel = state.selected === o.option_id;
    return `<article class="opt ${recId === o.option_id ? "recommended" : ""} ${isSel ? "selected" : ""} ${o.feasible ? "" : "infeasible"}">
      <div class="marks">${marks.join("")}</div>
      <h4><span class="id">${o.option_id}</span>${esc(shortName(o.name))}</h4>
      <div class="total">${money(o.costs.total)}</div>
      <div class="gap ${o.budget_gap >= 0 ? "ok" : "bad"}">${gapText(o.budget_gap)}</div>
      <div class="facts-mini"><span>Leave</span><span>${esc(when(f.departure))}</span><span>Home</span><span>${esc(when(f.return_time))}</span>
        <span>Nights</span><span>${o.nights}</span></div>
      ${broken.length ? `<ul class="broken">${broken.map((x) => `<li>${esc(x.rule)} ${lvlTag(x.priority)}</li>`).join("")}</ul>` : '<div class="all-ok">✓ All rules met</div>'}
      <details><summary>Details</summary>
        <div class="kv"><span>Transport</span><span>${money(o.costs.transport)}</span><span>Lodging</span><span>${money(o.costs.lodging)}</span>
          <span>Meals</span><span>${money(o.costs.meals)}</span><span>Extras</span><span>${money(o.costs.extras)}</span></div>
        <div class="kv"><span>Bus hours on game day</span><span>${hrs(f.gameday_travel_hours)}</span>
          ${o.drivers ? `<span>Longest drive</span><span>${hrs(o.drivers.longest)}, ${o.drivers.drivers} driver${o.drivers.drivers > 1 ? "s" : ""}</span>` : ""}</div>
        <ul class="checks">${o.rule_checks.map(ruleItem).join("")}${(o.policy_checks || []).map(ruleItem).join("")}</ul>
        ${o.notes.length ? `<ul class="flags">${o.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      </details>
      <button class="btn ${isSel ? "primary" : ""}" data-select="${o.option_id}" ${o.feasible ? "" : "disabled"}>${isSel ? "Reviewing" : "Review"}</button>
    </article>`;
  }).join("");
  document.querySelectorAll("[data-select]").forEach((b) => b.addEventListener("click", () => selectOption(b.dataset.select)));
}

async function recommend() {
  $("rec-body").innerHTML = `<div class="rec-card">${thinking("Aivana is comparing the options…")}<div class="skeleton" style="width:80%"></div><div class="skeleton" style="width:55%"></div></div>`;
  try {
    const out = await api("/api/recommend", ctx());
    state.rec = out.recommendation;
    renderRec(); renderPlan();
  } catch (e) {
    $("rec-body").innerHTML = `<div class="rec-card"><span class="err">No recommendation right now.</span> <span class="muted">You can still compare and review the options.</span> <button class="btn" id="btn-rec-retry">Try again</button></div>`;
    $("btn-rec-retry").addEventListener("click", recommend);
  }
}

function verifyHtml(r, what) {
  const bad = [...(r.unverified_numbers || []).map((n) => `${n} is not in the app's numbers`), ...(r.unverified_claims || [])];
  return bad.length
    ? `<div class="verify bad">⚠ Ignore these parts of the ${what}: ${bad.map(esc).join("; ")}</div>`
    : `<div class="verify ok">✓ Every number in this ${what} matches the app's math.</div>`;
}

function renderRec() {
  const r = state.rec;
  $("rec-body").innerHTML = `<div class="rec-card">
    <div class="headline">${esc(r.headline)}</div>
    <details><summary>Why</summary>
      <p>${esc(r.explanation)}</p>
      <table><tr><th>Option</th><th>Upside</th><th>Downside</th></tr>
      ${(r.tradeoffs || []).map((t) => `<tr><td><strong>${esc(t.option_id)}</strong></td><td>${esc(t.upside)}</td><td>${esc(t.downside)}</td></tr>`).join("")}</table>
    </details>
    ${verifyHtml(r, "recommendation")}</div>`;
}

async function sendWhatIf(ev) {
  ev.preventDefault();
  const input = $("chat-input"), msg = input.value.trim();
  if (!msg || !state.req) return;
  input.value = "";
  addMsg("user", esc(msg));
  const pending = addMsg("bot", thinking("Aivana is working on it…"));
  const snap = snapshot();
  try {
    const out = await api("/api/whatif", { ...ctx(), selected: state.selected, history: state.history,
      change_log: changeSummaryForAi(), message: msg });
    state.history.push({ role: "user", content: msg }, { role: "assistant", content: out.reply });
    state.history = state.history.slice(-8);
    let html = esc(out.reply);
    if (out.applied?.length) html += `<div class="small"><strong>Changed:</strong> ${out.applied.map(esc).join("; ")}</div>`;
    if (out.rejected?.length) html += `<div class="small err">Not applied: ${out.rejected.map(esc).join("; ")}</div>`;
    if (out.unverified_claims?.length || out.unverified_numbers?.length) html += verifyHtml(out, "reply");
    if (out.applied?.length) {
      html += `<table><tr><th>Option</th><th>Before</th><th>After</th></tr>${out.changes.map((c) =>
        `<tr><td>${c.option_id}</td><td>${c.before === null ? "new" : money(c.before)}</td><td class="${c.budget_gap >= 0 ? "gap ok" : "gap bad"}">${money(c.after)}</td></tr>`).join("")}</table>`;
      const beforePlan = state.plan;
      state.req = out.request; state.overrides = out.settings; state.plan = out.plan; state.custom = out.custom || null;
      if (state.custom && state.selected && state.custom.option_id !== state.selected) state.selected = state.custom.option_id;
      fillForm(state.req); fillSettings(state.overrides);
      logChange("chat", msg, out.applied, impactFromPlans(beforePlan, state.plan), snap);
      voidApproval(`a change was made in the chat ("${msg}")`);
      if (state.selected && !state.plan.packages.some((p) => p.option_id === state.selected)) {
        state.selected = null; state.details = null;
      }
      state.rec = null; renderPlan(); recommend();
      if (state.selected) await loadDetails();
    }
    pending.innerHTML = html;
    save(); updateStepper();
  } catch (e) { pending.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
}

function addMsg(who, html) {
  const d = document.createElement("div");
  d.className = "msg " + who; d.innerHTML = html;
  $("chat-log").appendChild(d); $("chat-log").scrollTop = 1e9;
  return d;
}

async function undoLast() {
  const last = state.changeLog.pop();
  if (!last) return;
  const s = last.snap;
  state.req = s.req; state.overrides = s.overrides || {}; state.custom = s.custom; state.selected = s.selected;
  fillForm(state.req); fillSettings(state.overrides);
  state.history.push({ role: "user", content: `(Staff undid the change: ${last.text})` }, { role: "assistant", content: "Understood; that change is undone." });
  addMsg("bot", `<span class="muted">Undid: ${esc(last.text)}</span>`);
  voidApproval(`a change was undone ("${last.text}")`);
  renderChangeLog();
  try {
    const out = await api("/api/plan", ctx());
    state.plan = out.plan; state.rec = null; renderPlan(); recommend();
    if (state.selected) await loadDetails(); else state.details = null;
  } catch { /* banner */ }
  save(); updateStepper();
}

// ------------------------------------------------------------------ step 3
async function selectOption(id) {
  if (state.selected !== id) {
    state.custom = null;
    voidApproval(`a different option (${id}) was chosen for review`);
  }
  if (state.selected !== id) clearWebHotels();
  state.selected = id;
  await loadDetails();
  goStep(3);
}

async function loadDetails() {
  try {
    const [planOut, out] = await Promise.all([
      api("/api/plan", ctx()),
      api("/api/details", { ...ctx(), option_id: state.selected, approval_id: state.approval?.approval_id }),
    ]);
    state.plan = planOut.plan; state.details = out;
    if (state.approval && !out.approval_valid) voidApproval("the plan changed after it was approved");
    renderPlan(); renderDetails(out); renderApproval(); save(); updateStepper();
  } catch { /* banner */ }
}

async function choose(change, text) {
  const snap = snapshot(), beforePlan = state.plan;
  const base = state.custom && state.custom.option_id === state.selected ? state.custom : { option_id: state.selected, meals: {} };
  state.custom = { ...base, ...change, meals: { ...(base.meals || {}), ...(change.meals || {}) } };
  voidApproval(`staff changed a choice (${text})`);
  await loadDetails();
  logChange("staff", text, [], impactFromPlans(beforePlan, state.plan), snap);
  save();
}

function renderPickers(choices, p) {
  if (choices.hotels.length) {
    $("hotel-pick-wrap").classList.remove("hidden");
    $("hotel-pick").innerHTML = `<tr><th></th><th>Hotel</th><th class="num">Rate</th><th class="num">To stadium</th><th>Breakfast</th><th class="num">Lodging total</th></tr>` +
      choices.hotels.map((h) => {
        const cur = p.hotel && p.hotel.hotel_id === h.hotel_id;
        return `<tr class="${cur ? "cur" : ""} ${h.usable ? "" : "off"}">
          <td><input type="radio" name="hotel" value="${h.hotel_id}" data-name="${esc(h.name)}" aria-label="${esc(h.name)}" ${cur ? "checked" : ""} ${h.usable ? "" : "disabled"}></td>
          <td>${esc(h.name)}${h.usable ? "" : `<div class="small err">${esc(h.reason)}</div>`}</td>
          <td class="num">${money(h.nightly_rate)}</td><td class="num">${h.miles_to_stadium} mi</td>
          <td>${h.breakfast_included ? "Included" : "No"}</td><td class="num">${money(h.lodging_cost)}</td></tr>`;
      }).join("");
    document.querySelectorAll('input[name="hotel"]').forEach((r) => r.addEventListener("change", () =>
      choose({ hotel_id: r.value }, `Picked ${r.dataset.name} for option ${state.selected}`)));
  } else $("hotel-pick-wrap").classList.add("hidden");

  $("meal-pick").innerHTML = `<tr><th>Meal</th><th>Where</th><th class="num">Cost</th></tr>` +
    choices.meals.map((m) => {
      const line = p.meals.find((x) => x.slot === m.slot);
      const opts = m.options.map((o) => `<option value="${o.restaurant_id}" ${o.restaurant_id === m.current ? "selected" : ""} ${o.usable ? "" : "disabled"}>${esc(o.name)} · ${money(o.price_per_person)}/person${o.usable ? (o.within_allowance ? "" : " · over allowance") : " · " + esc(o.reason)}</option>`).join("");
      const perDiem = m.current ? "" : `<option value="" selected>Per-diem cash (no restaurant seats the team)</option>`;
      return `<tr><td>${esc(m.label)}<div class="small muted">${esc(when(m.time))}</div></td>
        <td><select data-slot="${m.slot}" data-label="${esc(m.label)}" aria-label="${esc(m.label)}">${perDiem}${opts}</select></td><td class="num">${money(line ? line.cost : 0)}</td></tr>`;
    }).join("");
  document.querySelectorAll("#meal-pick select").forEach((s) => s.addEventListener("change", () => {
    if (!s.value) return;
    const name = s.options[s.selectedIndex].text.split(" · ")[0];
    choose({ meals: { [s.dataset.slot]: s.value } }, `${s.dataset.label}: ${name}`);
  }));
}

// ------------------------------------------------------------------ web hotels (Feature 7)
// Web results are hints. Only a hotel staff confirm (with the checkbox) reaches a total or a "Which hotel?" card.
let webSearch = null;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
function clearWebHotels() { webSearch = null; ["web-results", "web-confirm", "which-hotel"].forEach((id) => { $(id).innerHTML = ""; }); }

async function searchWebHotels() {
  const btn = $("btn-web-search");
  busy(btn, true, "Searching…");
  $("web-confirm").innerHTML = "";
  $("web-results").innerHTML = `<div class="ai-box">${thinking("Aivana is searching the web for hotels…")}</div>`;
  try { webSearch = await api("/api/hotels/search", { ...ctx(), option_id: state.selected }); renderWebResults(); }
  catch { $("web-results").innerHTML = ""; } finally { busy(btn, false); }
}

function renderWebResults() {
  const r = webSearch;
  const tried = (r.rejected || []).length ? `<details class="inline-more"><summary>Checked but not verified (${r.rejected.length})</summary><ul class="small">
    ${r.rejected.map((h) => `<li>${esc(h.name)}: ${h.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(x.url))}</a> <span class="err">✗ ${esc(x.reason)}</span>`).join(", ")}</li>`).join("")}</ul></details>` : "";
  if (!r.hotels.length) { $("web-results").innerHTML = `<div class="note">${esc(r.message)}</div>${tried}`; return; }
  const src = (x) => `<div><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(x.url))}</a> ` +
    (x.ok === true ? '<span class="ok-text">✓ checked</span>' : x.ok === false ? `<span class="err">✗ ${esc(x.reason)}</span>` : `<span class="muted">${esc(x.reason)}</span>`) + "</div>";
  const yn = { yes: "Yes", no: "No", unknown: "Unknown" };
  const note = r.mock ? "Sample results (mock mode). Links weren't opened." : r.cached ? `Saved search from ${esc((r.searched_at || "earlier").slice(0, 10))}.` : "";
  $("web-results").innerHTML = `<h3>Found on the web <span class="small muted">${r.query.checkin} to ${r.query.checkout}, ${r.query.rooms} rooms needed</span></h3>
    <p class="small muted">Searched near ${esc(r.query.stadium)}, ${esc(r.query.city)}${r.query.reference ? ` (real stand-in: ${esc(r.query.reference)})` : ""}.</p>
    ${note ? `<p class="small muted">${note}</p>` : ""}
    <div class="table-wrap"><table class="tbl pick"><tr><th>ID</th><th>Hotel</th><th class="num">Rate</th><th class="num">To stadium</th><th>Bus parking</th><th>Source</th><th></th></tr>
    ${r.hotels.map((h) => `<tr><td><strong>${h.hotel_id}</strong></td><td>${esc(h.name)}<div class="small muted">${esc(h.address)}</div></td>
      <td class="num">${h.nightly_rate_usd === null ? "—" : `${money(h.nightly_rate_usd)}<div class="small muted">web hint, not verified</div>`}</td>
      <td class="num">${h.miles_to_stadium === null ? "—" : h.miles_to_stadium + " mi"}</td><td>${yn[h.bus_parking]}</td>
      <td class="small">${h.sources.map(src).join("")}</td><td><button class="btn" data-web-use="${h.hotel_id}">Use this hotel</button></td></tr>`).join("")}</table></div>${tried}`;
  document.querySelectorAll("[data-web-use]").forEach((b) => b.addEventListener("click", () => openWebConfirm(b.dataset.webUse)));
}

function openWebConfirm(id) {
  const h = webSearch.hotels.find((x) => x.hotel_id === id);
  const ynSel = (sid, hint) => `<select id="${sid}"><option value="">Choose…</option><option value="yes" ${hint === "yes" ? "selected" : ""}>Yes</option><option value="no" ${hint === "no" ? "selected" : ""}>No</option></select>`;
  $("web-confirm").innerHTML = `<div class="approve"><h3>Use ${esc(h.name)} (${id}) for option ${esc(state.selected)}</h3>
    <p class="small muted">Call the hotel first. These numbers go into the trip total.</p>
    <div class="grid form">
      <label>Nightly rate ($)<input id="wc-rate" type="number" min="40" max="1000" step="0.01" value="${h.nightly_rate_usd ?? ""}"></label>
      <label>Rooms available<input id="wc-rooms" type="number" min="1" step="1" placeholder="need ${state.plan.counts.rooms}"></label>
      <label>Miles to stadium<input id="wc-miles" type="number" min="0" step="0.1" value="${h.miles_to_stadium ?? ""}"></label>
      <label>Bus parking${ynSel("wc-parking", h.bus_parking)}</label>
      <label>Meeting room${ynSel("wc-meeting", "")}</label>
    </div>
    <div class="acks"><label><input type="checkbox" id="wc-ok"> I confirmed this rate with the hotel</label></div>
    <div class="row"><button id="btn-wc-use" class="btn primary">Use this hotel</button><button id="btn-wc-cancel" class="btn">Cancel</button></div></div>`;
  $("btn-wc-use").addEventListener("click", () => confirmWebHotel(h));
  $("btn-wc-cancel").addEventListener("click", () => { $("web-confirm").innerHTML = ""; });
  $("wc-rate").focus();
}

async function confirmWebHotel(h) {
  if (!$("wc-ok").checked) { showError("Tick “I confirmed this rate with the hotel” first."); return; }
  const num = (id) => ($(id).value === "" ? null : Number($(id).value));
  const yn = (id) => ({ yes: true, no: false }[$(id).value] ?? null);
  const snap = snapshot(), beforePlan = state.plan, opt = state.selected;
  const btn = $("btn-wc-use");
  busy(btn, true, "Saving…");
  try {
    const out = await api("/api/hotels/confirm", { ...ctx(), option_id: opt, hotel_id: h.hotel_id, confirm: {
      nightly_rate: num("wc-rate"), rooms_available: num("wc-rooms"), miles_to_stadium: num("wc-miles"),
      bus_parking: yn("wc-parking"), meeting_room: yn("wc-meeting"), confirmed_by_staff: true } });
    state.custom = out.custom;
    voidApproval(`a web hotel was added (${h.name})`);
    await loadDetails();
    logChange("staff", `Used ${h.name} (found on the web) at ${money(out.custom.web_hotel.nightly_rate)}/night for option ${opt}`, [],
      impactFromPlans(beforePlan, state.plan), snap);
    save();
    $("web-confirm").innerHTML = `<p class="ok-text">✓ ${esc(h.name)} is now the hotel for option ${esc(opt)}.</p>`;
    $("which-hotel").innerHTML = "";
  } catch { /* banner shows what to fix */ } finally { if ($("btn-wc-use")) busy($("btn-wc-use"), false); }
}

async function whichHotel() {
  const btn = $("btn-which-hotel");
  busy(btn, true, "Comparing…");
  $("which-hotel").innerHTML = `<div class="ai-box">${thinking("Aivana is comparing the hotels…")}</div>`;
  try {
    const out = await api("/api/hotels/recommend", { ...ctx(), option_id: state.selected });
    const r = out.recommendation, name = Object.fromEntries(out.cards.map((c) => [c.hotel_id, c.name]));
    $("which-hotel").innerHTML = `<div class="ai-box"><div class="small muted">Advisory only. Staff decide.</div>
      <strong>${esc(r.headline)}</strong> ${esc(r.reason)}
      <details><summary>Tradeoffs</summary><table class="tbl"><tr><th>Hotel</th><th>Upside</th><th>Downside</th></tr>
        ${(r.tradeoffs || []).map((t) => `<tr><td>${esc(name[t.hotel_id] || t.hotel_id)}</td><td>${esc(t.upside)}</td><td>${esc(t.downside)}</td></tr>`).join("")}</table></details>
      ${r.confirm_with_hotel?.length ? `<div class="small"><strong>Confirm with the hotel:</strong> ${r.confirm_with_hotel.map(esc).join("; ")}</div>` : ""}
      ${verifyHtml(r, "advice")}</div>`;
  } catch { $("which-hotel").innerHTML = ""; } finally { busy(btn, false); }
}

function renderDetails({ package: p, choices }) {
  $("plan-title").textContent = `Option ${p.option_id}: ${shortName(p.name)}`;
  renderPickers(choices, p);
  $("timeline").innerHTML = p.timeline.map((e) => `<li><time>${esc(when(e.time))}</time>${esc(e.label)}</li>`).join("");
  const lodging = p.lodging_detail ? `${p.lodging_detail.rooms} rooms × ${money(p.lodging_detail.nightly_rate)} × ${p.lodging_detail.nights} night(s) + tax` : "";
  const transport = p.bus ? `${p.bus.count} bus${p.bus.count === 1 ? "" : "es"}, ${esc(p.bus.vendor)}${p.drivers?.extra_cost ? `, incl. second driver ${money(p.drivers.extra_cost)}` : ""}` : `Flight + local buses`;
  const sub = (t) => (t ? `<div class="small muted">${t}</div>` : "");
  $("cost-table").innerHTML = `<tr><td>Transport${sub(transport)}</td><td class="num">${money(p.costs.transport)}</td></tr>
    <tr><td>Lodging${sub(esc(lodging))}</td><td class="num">${money(p.costs.lodging)}</td></tr>
    <tr><td>Meals</td><td class="num">${money(p.costs.meals)}</td></tr>
    <tr><td>Extras</td><td class="num">${money(p.costs.extras)}</td></tr>
    <tr class="total"><td>Total</td><td class="num">${money(p.costs.total)}</td></tr>
    <tr><td>Budget ${money(state.plan.budget)}</td><td class="num gap ${p.budget_gap >= 0 ? "ok" : "bad"}">${p.budget_gap >= 0 ? money(p.budget_gap) + " under" : money(-p.budget_gap) + " over"}</td></tr>`;
  $("plan-rules").innerHTML = p.rule_checks.map(ruleItem).join("");
  $("plan-policy").innerHTML = (p.policy_checks || []).map(ruleItem).join("");
  $("plan-flags").innerHTML = p.notes.length ? p.notes.map((f) => `<li>${esc(f)}</li>`).join("") : "<li>None</li>";
}

// ------------------------------------------------------------------ approval gate
function renderApproval() {
  const d = state.details;
  if (!d) return;
  const voided = state.voidReason ? `<div class="voided">Approval cancelled: ${esc(state.voidReason)}. Approve again when ready.</div>` : "";
  if (state.approval) {
    const a = state.approval;
    $("approve-status").innerHTML = `<div class="approved">✓ Approved by ${esc(a.role)}, ${esc(when(a.approved_at))}. <a href="#" id="go-final">Open the trip plan</a></div>`;
    $("go-final").addEventListener("click", (e) => { e.preventDefault(); goStep(4); });
    $("approve-form").classList.add("hidden");
    return;
  }
  $("approve-status").innerHTML = voided;
  $("approve-form").classList.remove("hidden");
  const acks = d.required_acks || [];
  $("acks").innerHTML = acks.length
    ? `<p class="small"><strong>Confirm each issue was discussed:</strong></p><div class="acks">${acks.map((a, i) =>
        `<label><input type="checkbox" data-ack="${i}"> ${esc(a)}</label>`).join("")}</div>`
    : '<p class="small ok-text">Keeps every rule and is within budget.</p>';
}

async function approve() {
  const d = state.details, acks = d.required_acks || [];
  const checked = [...document.querySelectorAll("[data-ack]")].filter((c) => c.checked).map((c) => acks[Number(c.dataset.ack)]);
  if (checked.length < acks.length) { showError("Tick every issue to confirm it was discussed, or keep adjusting the plan."); return; }
  if (!$("approve-role").value) { showError("Choose who is approving."); return; }
  const btn = $("btn-approve");
  busy(btn, true, "Approving…");
  try {
    const out = await api("/api/approve", { ...ctx(), option_id: state.selected, role: $("approve-role").value,
      acknowledged: checked, note: $("approve-note").value });
    state.approval = out.approval; state.voidReason = null;
    logChange("approval", `Option ${out.approval.option_id} approved by ${out.approval.role}`, [], [], snapshot());
    renderApproval(); await showFinal(); goStep(4); save();
  } catch { /* banner */ } finally { busy(btn, false); }
}

// ------------------------------------------------------------------ step 4 (only after approval)
async function showFinal() {
  try {
    const out = await api("/api/final", { ...ctx(), option_id: state.selected, approval_id: state.approval?.approval_id });
    const a = out.approval;
    $("approval-banner").innerHTML = `<div><strong>Option ${esc(a.option_id)}: ${esc(shortName(a.option_name))}</strong>, ${money(a.total)} (${gapText(a.budget_gap).toLowerCase()})</div>
      <div class="small">Approved by ${esc(a.role)}, ${esc(when(a.approved_at))}${a.note ? `. Note: ${esc(a.note)}` : ""}</div>`;
    if (out.rooming) {
      $("rooming-wrap").classList.remove("hidden");
      $("rooming").innerHTML = [...out.rooming.player_rooms, ...out.rooming.staff_rooms].map((r) => `<div><strong>${r.room}</strong>: ${r.occupants.join(", ")}</div>`).join("") +
        (out.rooming.note ? `<div class="err" style="grid-column:1/-1">${esc(out.rooming.note)}</div>` : "");
    } else $("rooming-wrap").classList.add("hidden");
    $("expense-notes").innerHTML = (out.expense_report?.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
    $("memo").classList.add("hidden"); $("memo").textContent = ""; $("memo-check").textContent = "";
    $("btn-dl-memo").disabled = true; setPdfButton(null); $("actuals").innerHTML = "";
    updateStepper();
  } catch { /* banner; stale approvals are voided in api() */ }
}

const approved = () => ({ ...ctx(), option_id: state.selected, approval_id: state.approval?.approval_id });

async function writeMemo() {
  const btn = $("btn-memo"), box = $("memo");
  busy(btn, true, "Writing…");
  setPdfButton(null); box.textContent = ""; box.classList.remove("hidden"); $("memo-check").innerHTML = thinking("Aivana is writing the memo…");
  const done = aiStart("/api/memo");
  try {
    const res = await fetch("/api/memo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(approved()) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); if (d.code === "approval_stale") voidApproval("the plan changed after it was approved"); throw new Error(d.error || "Memo failed"); }
    const reader = res.body.getReader(), dec = new TextDecoder();
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      box.textContent += dec.decode(value, { stream: true });
      box.scrollTop = 1e9;
    }
    done();
    state.memo = box.textContent;
    $("btn-dl-memo").disabled = false;
    $("memo-check").innerHTML = thinking("Checking every number…");
    const chk = await api("/api/check", { ...ctx(), text: state.memo });
    $("memo-check").innerHTML = verifyHtml(chk, "memo");
    setPdfButton(chk);
  } catch (e) { $("memo-check").textContent = ""; showError(e.message); } finally { done(); busy(btn, false); }
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// The PDF is offered only once the memo has been fact-checked; unverified parts are printed in the PDF too.
function setPdfButton(chk) {
  const btn = $("btn-pdf");
  const bad = chk && ((chk.unverified_numbers || []).length + (chk.unverified_claims || []).length);
  btn.disabled = !chk;
  btn.textContent = bad ? "Download PDF (has unverified parts)" : "Download PDF";
}

async function downloadPdf() {
  const btn = $("btn-pdf");
  busy(btn, true, "Making PDF…");
  try {
    const res = await fetch("/api/memo/pdf", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...approved(), text: state.memo }) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      if (d.code === "approval_stale") voidApproval("the plan changed after it was approved");
      throw new Error(d.error || "Could not make the PDF");
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await res.blob());
    a.download = `bgsu-trip-memo-${state.req.game_id}-${state.selected}.pdf`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { showError(e.message); } finally { busy(btn, false); }
}

async function downloadIcs() {
  try {
    const res = await fetch("/api/ics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(approved()) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Could not build the calendar file"); }
    download(`bgsu-trip-${state.req.game_id}-${state.selected}.ics`, await res.text(), "text/calendar");
  } catch (e) { showError(e.message); }
}

async function compareActuals() {
  try {
    const out = await api("/api/actuals", { ...approved(),
      actuals: { transport: $("a-transport").value, lodging: $("a-lodging").value, meals: $("a-meals").value, extras: $("a-extras").value } });
    const row = (r) => `<tr><td>${r.category}</td><td class="num">${money(r.estimated)}</td><td class="num">${money(r.actual)}</td><td class="num ${r.variance > 0 ? "gap bad" : "gap ok"}">${r.variance > 0 ? "+" : ""}${money(r.variance)}${r.variance_pct === null ? "" : ` (${r.variance_pct}%)`}</td></tr>`;
    $("actuals").innerHTML = `<table class="tbl"><tr><th>Category</th><th class="num">Estimated</th><th class="num">Actual</th><th class="num">Difference</th></tr>
      ${out.rows.map(row).join("")}
      <tr class="total"><td>Total</td><td class="num">${money(out.estimated_total)}</td><td class="num">${money(out.actual_total)}</td><td class="num">${out.variance_total > 0 ? "+" : ""}${money(out.variance_total)}</td></tr></table>
      <p class="${out.actual_vs_budget >= 0 ? "gap ok" : "gap bad"}">${money(Math.abs(out.actual_vs_budget))} ${out.actual_vs_budget >= 0 ? "under" : "over"} the ${money(out.budget)} budget.</p>`;
  } catch { /* banner */ }
}

// ------------------------------------------------------------------ settings
function control(k) {
  if (k.startsWith("priority_")) {
    return `<select id="s-${k}" aria-label="How much this rule matters"><option value="3">Must-have</option><option value="2">Important</option><option value="1">Nice-to-have</option></select>`;
  }
  if (BOOL_SETTINGS.has(k)) return `<select id="s-${k}" aria-label="${esc(SETTING_LABELS[k])}"><option value="1">Required</option><option value="0">Not required</option></select>`;
  if (TIME_CHOICES[k]) return `<select id="s-${k}" aria-label="${esc(SETTING_LABELS[k])}">${TIME_CHOICES[k].map((h) => `<option value="${h}">${hourLabel(h)}</option>`).join("")}</select>`;
  return `<input id="s-${k}" type="number" step="any" min="0" aria-label="${esc(SETTING_LABELS[k])}">`;
}

function renderSettings() {
  const keysIn = (grp) => Object.keys(SETTING_LABELS).filter((k) => state.groups[k] === grp && !k.startsWith("priority_"));
  const row = (k) => `<div class="set-row"><span class="name">${esc(SETTING_LABELS[k])}${POLICY_VALUES.has(k) ? `<br><small class="muted">${esc(POLICY_NOTE)}</small>` : ""}</span>${control(k)}${PRIORITY_FOR[k] ? control(PRIORITY_FOR[k]) : "<span></span>"}</div>`;
  $("grp-rules").innerHTML = keysIn("rules").map(row).join("");
  $("grp-policy").innerHTML = keysIn("policy").map(row).join("") +
    `<div class="set-row"><span class="name">${esc(SETTING_LABELS.priority_per_diem_day_trip)}</span><span></span>${control("priority_per_diem_day_trip")}</div>`;
  for (const grp of ["costs", "extras", "assumptions"]) {
    $("grp-" + grp).innerHTML = keysIn(grp).map((k) => `<label>${esc(SETTING_LABELS[k])}${control(k)}</label>`).join("");
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  const b = await (await fetch("/api/bootstrap")).json();
  if (b.mock) $("mode-badge").classList.remove("hidden");
  $("f-game").innerHTML = '<option value="">Choose a game…</option>' + b.games.map((g) => `<option value="${g.game_id}">${esc(g.label)}</option>`).join("");
  state.defaults = b.settings; state.groups = b.setting_groups; state.roles = b.approver_roles;
  $("approve-role").innerHTML = '<option value="">Choose role…</option>' + state.roles.map((r) => `<option>${esc(r)}</option>`).join("");
  renderSettings();
  fillSettings({});

  document.querySelectorAll(".tabs [data-tab]").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  document.querySelectorAll("[data-goto-tab]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); showTab(a.dataset.gotoTab); }));
  document.querySelectorAll(".stepper [data-step]").forEach((s) => s.addEventListener("click", () => goStep(Number(s.dataset.step))));
  document.querySelectorAll("[data-open-chat]").forEach((x) => x.addEventListener("click", () => openChat(true)));
  $("btn-close-chat").addEventListener("click", () => openChat(false));
  $("drawer-scrim").addEventListener("click", () => openChat(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") openChat(false); });
  document.querySelectorAll("#chat-chips .chip").forEach((c) => c.addEventListener("click", () => { $("chat-input").value = c.textContent; $("chat-input").focus(); }));

  const settingsInputs = document.querySelectorAll("#settings-box input, #settings-box select");
  settingsInputs.forEach((e) => e.addEventListener("change", () => { renderRulesSummary(); loadSeason(); }));
  $("btn-reset-settings").addEventListener("click", () => { fillSettings({}); loadSeason(); });
  $("btn-new").addEventListener("click", () => { clearSaved(); location.reload(); });
  $("season-budget").addEventListener("change", loadSeason);
  $("btn-season-explain").addEventListener("click", explainSeason);
  $("btn-parse").addEventListener("click", parseRequest);
  $("btn-example").addEventListener("click", () => { $("freetext").value = b.sample_request; $("freetext").focus(); });
  $("freetext").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); parseRequest(); } });
  $("btn-compare").addEventListener("click", compare);
  $("chat-form").addEventListener("submit", sendWhatIf);
  $("btn-undo").addEventListener("click", undoLast);
  $("btn-approve").addEventListener("click", approve);
  $("btn-memo").addEventListener("click", writeMemo);
  $("btn-dl-memo").addEventListener("click", () => download(`bgsu-trip-memo-${state.req.game_id}-${state.selected}.txt`, state.memo, "text/plain"));
  $("btn-ics").addEventListener("click", downloadIcs);
  $("btn-pdf").addEventListener("click", downloadPdf);
  $("btn-web-search").addEventListener("click", searchWebHotels);
  $("btn-which-hotel").addEventListener("click", whichHotel);
  $("btn-actuals").addEventListener("click", compareActuals);
  document.querySelectorAll(".form input, .form select").forEach((e) => e.addEventListener("input", () => e.classList.remove("missing", "assumed")));
  renderChangeLog();

  let tab = "season";
  try { tab = localStorage.getItem(TAB_KEY) || "season"; } catch { /* ignore */ }
  showTab(["season", "plan", "settings"].includes(tab) ? tab : "season");
  refreshUsage(); goStep(1); loadSeason();

  const saved = loadSaved();
  if (saved) {
    $("freetext").value = saved.text || "";
    fillForm(saved.form || {}); fillSettings(saved.settings || {});
    $("restored").textContent = `Restored your last trip. Use "New trip" to clear it.`;
    $("restored").classList.remove("hidden");
    if (saved.req) {
      state.req = saved.req; state.overrides = saved.overrides || {}; state.custom = saved.custom || null;
      state.history = saved.history || []; state.changeLog = saved.changeLog || []; state.approval = saved.approval || null;
      $("chat-log").innerHTML = saved.chat || ""; renderChangeLog();
      try {
        const out = await api("/api/plan", ctx());
        state.plan = out.plan; renderPlan(); recommend();
        if (saved.selected) {
          state.selected = saved.selected;
          await loadDetails();
          if (state.approval) await showFinal();
        }
      } catch { /* request no longer valid; user can compare again */ }
      goStep(maxStep());
    }
  }
}
boot();
