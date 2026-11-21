// Node.js backend (no dependencies). The browser never sees the Aivana key; every AI call happens here.
// Run: node server.js   (or npm start)   ->  http://127.0.0.1:5000

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname, normalize, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import * as aivana from "./src/aivana.js";
import { AivanaError } from "./src/aivana.js";
import * as aiTasks from "./src/aiTasks.js";
import * as planner from "./src/planner.js";
import { memoPdf } from "./src/pdf.js";
import * as webHotels from "./src/webHotels.js";
import * as schedImport from "./src/scheduleImport.js";
import { checkRows, rowIsValid, toSavedGames, FIELDS as SCHEDULE_FIELDS, MAX_GAMES } from "./static/scheduleRules.js";
import { money, round, toInt, toFloat, parseDT, addHours, strftime, stableStringify, sha256, nowLocal } from "./src/util.js";

export const ROOT = dirname(fileURLToPath(import.meta.url));
const STATIC = join(ROOT, "static");

/** Minimal .env loader so no extra package is needed. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (let line of readFileSync(path, "utf8").split(/\r?\n/)) {
    line = line.trim();
    if (line && !line.startsWith("#") && line.includes("=")) {
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}
loadEnvFile(join(ROOT, ".env"));
if (process.argv.includes("--mock")) process.env.AIVANA_MOCK = "1"; // npm run mock: offline demo

export const DATA = planner.loadData();
// Feature 8: staff can import a schedule. The sample (data/schedule.json) is never changed; an import is saved to
// data/schedule.imported.json (gitignored) and used instead when present.
const SAMPLE_SCHEDULE = DATA.schedule;
let SCHEDULE_STATE = { source: "sample", warning: "" };
function useSchedule({ schedule, source, warning }) {
  DATA.schedule = schedule;
  SCHEDULE_STATE = { source, warning };
}
useSchedule(schedImport.loadSchedule(SAMPLE_SCHEDULE));
/** Tests: reload from whatever file SCHEDULE_IMPORTED_FILE points to now. */
export const _reloadSchedule = () => useSchedule(schedImport.loadSchedule(SAMPLE_SCHEDULE));
export const APPROVER_ROLES = ["Head Coach", "Director of Operations", "Travel Coordinator", "Sport Administrator (Associate AD)"];
// Local record of approvals (gitignored). Tests point this somewhere else.
let APPROVALS_FILE = process.env.APPROVALS_FILE || join(ROOT, "approvals.json");
export const SAMPLE_REQUEST = "Sunday at Lakeview State, 1 PM kickoff. 22 players, 4 coaches, 3 staff. " +
  "We train until noon Saturday. Budget is $6,000.";

function loadApprovals() {
  try { return JSON.parse(readFileSync(APPROVALS_FILE, "utf8")); } catch { return {}; }
}
let APPROVALS = loadApprovals();
export function _setApprovalsFile(path) { APPROVALS_FILE = path; APPROVALS = loadApprovals(); }

/** Identifies exactly what was approved: request, the game as scheduled, every setting, staff choices, option.
 * The game is included so an imported schedule that moves the date or kickoff makes the approval out of date. */
export function planFingerprint(req, settings, custom, optionId) {
  const s = Object.fromEntries(Object.keys(planner.EDITABLE_SETTINGS).map((k) => [k, settings[k] ?? null]));
  const g = planner.getGame(DATA, req?.game_id || "");
  const game = g && Object.fromEntries(["opponent", "city", "stadium", "date", "kickoff", "miles", "drive_hours"].map((k) => [k, g[k] ?? null]));
  return sha256(stableStringify({ req, game, settings: s, custom: custom ?? null, option: optionId })).slice(0, 16);
}

export function requiredAcks(pkg) {
  const acks = pkg.rule_checks.filter((r) => !r.ok).map((r) => `Breaks team rule: ${r.rule} (actual ${r.actual})`);
  acks.push(...(pkg.policy_checks || []).filter((r) => !r.ok).map((r) => `Example policy: ${r.rule} (actual ${r.actual})`));
  if (!pkg.within_budget) acks.push(`Over budget by $${money(-pkg.budget_gap)}`);
  return acks;
}

// ----------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(status, payload) { super(payload.error); this.status = status; this.payload = payload; }
}
const bad = (msg, extra = {}, status = 400) => new HttpError(status, { error: msg, ...extra });

function aiError(exc) {
  const st = exc.status;
  const status = st === null || st >= 500 || st === 429 || st === 402 ? 503 : 502;
  return new HttpError(status, exc.toJSON());
}

/** Validate input, settings and staff choices, then build packages. Returns {plan, req, settings, problems}. */
function makePlan(rawReq, overrides, custom = null) {
  const [req, errors, warnings] = planner.validateRequest(rawReq || {}, DATA);
  const [settings, sErrors] = planner.mergeSettings(DATA.settings, overrides);
  errors.push(...sErrors);
  if (errors.length) return { plan: null, req, settings, problems: { errors, warnings } };
  const [cleanCustom, cErrors] = planner.validateCustom(custom, req, DATA, settings);
  if (cErrors.length) return { plan: null, req, settings, problems: { errors: cErrors, warnings } };
  const plan = planner.buildPackages(req, DATA, settings, cleanCustom);
  plan.warnings = warnings;
  plan.custom = cleanCustom;
  return { plan, req, settings, problems: null };
}
const planFromBody = (b) => makePlan(b.request, b.settings, b.custom);
const findPkg = (plan, id) => plan.packages.find((p) => p.option_id === id) || null;

function planOrFail(b, msg = "Please fix the request first.") {
  const r = planFromBody(b);
  if (r.problems) throw bad(msg, r.problems);
  return r;
}
function pkgOrFail(plan, id) {
  const pkg = findPkg(plan, id);
  if (!pkg) throw bad("Select an option first.");
  return pkg;
}

/** The final plan is only produced for the exact approved version. */
function checkApproval(b, plan, req, settings, pkg) {
  const rec = APPROVALS[String(b.approval_id || "")];
  if (!rec) throw new HttpError(403, { error: "This plan has not been approved yet. Review it and press Approve first." });
  if (rec.fingerprint !== planFingerprint(req, settings, plan.custom, pkg.option_id)) {
    throw new HttpError(409, { error: "The plan changed after it was approved. Review the changes and approve again.",
      code: "approval_stale" });
  }
  return rec;
}

// ----------------------------------------------------------------- routes

/** Settings and travel party for the season routes. */
function seasonInputs(b) {
  const [settings, errors] = planner.mergeSettings(DATA.settings, b.settings);
  const given = b.party && typeof b.party === "object" ? b.party : {};
  const party = {};
  for (const [k, def] of [["num_players", 22], ["num_coaches", 4], ["num_staff", 3]]) {
    try {
      const v = toInt(k in given ? given[k] : def);
      party[k] = v >= 0 && v <= 150 ? v : def;
    } catch { party[k] = def; }
  }
  party.num_players = Math.max(1, party.num_players);
  if (errors.length) throw bad("Please fix the settings.", { errors });
  return { settings, party };
}

/** Which schedule is in use, for the Settings box. */
const scheduleInfo = () => ({ source: SCHEDULE_STATE.source, warning: SCHEDULE_STATE.warning, games: DATA.schedule.games.length });

/** Image upload for /api/schedule/read: checked from its own bytes, never from its name or claimed type. */
function checkedImage(img) {
  if (!img || typeof img !== "object" || typeof img.data !== "string") throw bad(schedImport.TYPE_MESSAGE);
  const b64 = img.data.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw bad(schedImport.TYPE_MESSAGE);
  const buf = Buffer.from(b64, "base64");
  // A PDF is refused here, before anything else, whatever it was called. It is never sent to Aivana.
  if (schedImport.isPdf(buf) || /pdf/i.test(String(img.mime_type || ""))) throw bad(schedImport.PDF_MESSAGE, { code: "pdf" });
  const { type, width } = schedImport.sniffImage(buf);
  if (!type) throw bad(schedImport.TYPE_MESSAGE, { code: "image_type" });
  if (!width) throw bad("This image couldn't be read. Take a new screenshot and try again.", { code: "image_type" });
  if (width > schedImport.MAX_WIDTH) {
    throw bad(`The image is ${width}px wide. The most is ${schedImport.MAX_WIDTH}px. Upload it again from this page, which shrinks it.`,
      { code: "image_width" });
  }
  return { mime_type: type, data: b64 };
}

/** Rows sent back by the browser -> plain rows with only the known fields. */
function cleanRows(rows) {
  if (!Array.isArray(rows)) throw bad("No rows to save. Read a schedule first.");
  if (rows.length > MAX_GAMES) throw bad(`At most ${MAX_GAMES} games can be imported.`);
  return rows.map((r) => {
    const o = r && typeof r === "object" ? r : {};
    const row = Object.fromEntries(SCHEDULE_FIELDS.map((f) => [f, o[f] === undefined ? null : o[f]]));
    for (const f of SCHEDULE_FIELDS) if (row[f] !== null && typeof row[f] !== "string" && typeof row[f] !== "number") row[f] = null;
    row.unclear = Array.isArray(o.unclear) ? o.unclear.filter((f) => SCHEDULE_FIELDS.includes(f)) : [];
    return row; // as_printed is never kept
  });
}

const routes = {
  "GET /api/bootstrap": () => ({
    games: DATA.schedule.games.map((x) => ({ ...x,
      label: `${x.opponent} - ${strftime(parseDT(x.date), "%a %b %d")} ${x.kickoff} (${x.miles} mi)` })),
    settings: Object.fromEntries(Object.keys(planner.EDITABLE_SETTINGS).map((k) => [k, DATA.settings[k] ?? null])),
    setting_groups: Object.fromEntries(Object.entries(planner.EDITABLE_SETTINGS).map(([k, v]) => [k, v[2]])),
    mock: aivana.mockMode(), home: DATA.schedule.home || {}, approver_roles: APPROVER_ROLES,
    sample_request: SAMPLE_REQUEST, disclaimer: planner.DISCLAIMER, active_players: planner.activePlayerCount(DATA),
    schedule: scheduleInfo(),
  }),

  "GET /api/usage": () => aivana.USAGE,

  // ------------------------------------------------------------- schedule import (Feature 8)
  /** Pasted text or a PNG/JPG screenshot -> preview rows. One Aivana call. Nothing is saved here. */
  "POST /api/schedule/read": async (b) => {
    let input;
    if (b.image !== undefined && b.image !== null) {
      input = { image: checkedImage(b.image) };
    } else {
      const text = String(b.text || "").trim();
      if (text.length < 10) throw bad("Paste the schedule (at least one game) or upload a screenshot.");
      if (text.length > 5000) throw bad(`The pasted schedule is ${text.length} characters. The most is 5,000. Paste only the games.`);
      const found = aiTasks.personalDetails(text);
      if (found.length) throw bad(aiTasks.PERSONAL_MESSAGE(found), { code: "personal_details" });
      input = { text };
    }
    let out;
    try { out = await aiTasks.readSchedule(input, SAMPLE_SCHEDULE); }
    catch (e) {
      if (e instanceof aiTasks.PersonalInAnswer) throw bad(e.message, { code: "personal_details" });
      if (e instanceof AivanaError) throw aiError(e);
      throw e;
    }
    if (!out.rows.length) throw bad("No games could be read. Try a clearer screenshot or paste the text.", { code: "no_games" });
    return { rows: out.rows, notes: out.notes, checks: checkRows(out.rows), mock: aivana.mockMode(),
      source: input.image ? "image" : "text" };
  },

  /** Staff-checked rows -> data/schedule.imported.json. Every row is checked again here. */
  "POST /api/schedule/save": (b) => {
    if (b.confirm !== true) throw bad("Tick the box to confirm that this replaces the current schedule.");
    const rows = cleanRows(b.rows);
    const checks = checkRows(rows);
    const errors = [];
    checks.forEach((c, i) => {
      for (const [f, why] of Object.entries(c.problems)) errors.push(`Row ${i + 1} ${f.replace("_", " ")}: ${why}`);
    });
    if (errors.length) throw bad("Fix the red cells first.", { errors: errors.slice(0, 20) });
    const games = toSavedGames(rows);
    if (!games.length) throw bad("There are no away games to save.");
    const schedule = schedImport.saveImported(games, SAMPLE_SCHEDULE);
    useSchedule({ schedule, source: "imported", warning: "" });
    return { schedule: scheduleInfo(), saved: games.length, skipped_home: rows.length - games.length };
  },

  /** Delete the imported schedule and go back to the sample. Safe to call when there is none. */
  "POST /api/schedule/reset": () => {
    schedImport.deleteImported();
    useSchedule({ schedule: SAMPLE_SCHEDULE, source: "sample", warning: "" });
    return { schedule: scheduleInfo() };
  },

  /** Season overview: per-game overnight verdict, hotel recommendations, per-game budget. Code only, no AI. */
  "POST /api/season": (b) => {
    const { settings, party } = seasonInputs(b);
    return planner.seasonOverview(DATA, settings, party);
  },

  /** Aivana explains the code's season plan. It cannot change the plan; its text is fact-checked. */
  "POST /api/season/explain": async (b) => {
    const { settings, party } = seasonInputs(b);
    const overview = planner.seasonOverview(DATA, settings, party);
    try { return { explanation: await aiTasks.explainSeason(overview), optimizer: overview.optimizer }; }
    catch (e) { if (e instanceof AivanaError) throw aiError(e); throw e; }
  },

  // ------------------------------------------------------------- core
  "POST /api/parse": async (b) => {
    const text = String(b.text || "").trim();
    if (text.length < 10) throw bad("Describe the trip in a sentence or two (game, headcount, departure limit, budget).");
    const found = aiTasks.personalDetails(text);
    if (found.length) throw bad(aiTasks.PERSONAL_MESSAGE(found), { code: "personal_details" });
    let out;
    try { out = await aiTasks.parseRequest(text, DATA); } catch (e) { if (e instanceof AivanaError) throw aiError(e); throw e; }
    const [clean, errors, warnings] = planner.validateRequest(out.request, DATA);
    const notes = [];
    // Departure not stated: put the assumed time in the form so it matches the warning.
    if (!out.request.depart_after && clean.depart_after) {
      out.request.depart_after = clean.depart_after;
      out.assumed = ["depart_after"];
    }
    if (!out.request.game_id) {
      notes.push("No game on the schedule matched. Away games: " +
        DATA.schedule.games.map((x) => `${x.opponent} (${strftime(parseDT(x.date), "%b %d").replace(" 0", " ")})`).join(", ") + ".");
    }
    return { ...out, errors, warnings, notes };
  },

  "POST /api/plan": (b) => {
    const { plan, req } = planOrFail(b, "Please fix the request.");
    return { plan, request: req };
  },

  "POST /api/recommend": async (b) => {
    const { plan } = planOrFail(b, "Please fix the request.");
    try { return { recommendation: await aiTasks.recommend(plan) }; } catch (e) { if (e instanceof AivanaError) throw aiError(e); throw e; }
  },

  // ------------------------------------------------------------- standard
  "POST /api/whatif": async (b) => {
    const message = String(b.message || "").trim();
    if (!message) throw bad("Type a what-if, for example: leave 3 players home.");
    const found = aiTasks.personalDetails(message);
    if (found.length) throw bad(aiTasks.PERSONAL_MESSAGE(found), { code: "personal_details" });
    const { plan: before, req, settings, problems } = planFromBody(b);
    if (problems) throw bad("Please fix the request first.", problems);
    const overrides = b.settings && typeof b.settings === "object" ? b.settings : {};
    let out;
    try {
      out = await aiTasks.whatif(message, b.history || [], req, overrides, settings, DATA, before, b.change_log || []);
    } catch (e) { if (e instanceof AivanaError) throw aiError(e); throw e; }
    const extra = {};
    let [newReq, newOver, applied, rejected] = planner.applyEdits(req, overrides, out.edits || [], settings, DATA, extra);

    // Staff choices carry over unless the game changed; a hotel request becomes a choice.
    let custom = before.custom;
    if (newReq.game_id !== req.game_id) custom = null;
    if (extra.hotel_id) {
      const sel = b.selected;
      const selPkg = sel ? findPkg(before, sel) : null;
      const target = selPkg && selPkg.nights ? sel : "B";
      custom = { option_id: target, hotel_id: extra.hotel_id,
        meals: (custom || {}).option_id === target ? (custom.meals || {}) : {} };
    }
    let r = makePlan(newReq, newOver, custom);
    if (r.problems && custom) {
      rejected = [...rejected, ...r.problems.errors];
      custom = null;
      r = makePlan(newReq, newOver, null);
    } else if (extra.hotel_id) {
      applied = [...applied, `hotel for option ${custom.option_id}: ${extra.hotel_id}`];
    }
    if (r.problems) {
      return { reply: out.reply || "", applied: [], rejected: [...rejected, ...r.problems.errors], request: req,
        settings: overrides, custom: before.custom, plan: before, changes: [] };
    }
    const after = r.plan;
    const changes = after.packages.map((p) => {
      const old = findPkg(before, p.option_id);
      return { option_id: p.option_id, before: old ? old.costs.total : null, after: p.costs.total,
        budget_gap: p.budget_gap, rules_broken: p.rules_broken };
    });
    const reply = out.reply || "";
    return { reply, applied, rejected, request: r.req, settings: newOver, custom: after.custom, plan: after, changes,
      unverified_numbers: planner.checkNumbers(reply, after), unverified_claims: planner.checkClaims(reply, after) };
  },

  "POST /api/memo": async (b, res) => {
    const { plan, req, settings } = planOrFail(b);
    const pkg = pkgOrFail(plan, b.option_id);
    const approval = checkApproval(b, plan, req, settings, pkg);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "X-Accel-Buffering": "no", "Cache-Control": "no-cache" });
    try {
      for await (const piece of aiTasks.memoStream(plan, pkg, req, approval)) res.write(piece);
    } catch (e) {
      res.write(`\n\n[Memo stopped: ${e.message}]`);
    }
    res.end();
    return undefined; // already sent
  },

  // ------------------------------------------------------------- web hotels (Feature 7)
  /** Aivana searches the web; code cleans, opens every link, sorts and numbers W1..Wn. Changes no total. */
  "POST /api/hotels/search": async (b) => {
    const { plan } = planOrFail(b);
    const pkg = pkgOrFail(plan, b.option_id);
    const [query, why] = webHotels.searchQuery(plan, pkg, { allowFictional: aivana.mockMode() });
    if (!query) throw bad(why);
    try { return await aiTasks.searchHotels(query); }
    catch (e) {
      if (!(e instanceof AivanaError)) throw e;
      return { query, hotels: [], status: "unavailable", message: webHotels.NO_RESULTS, detail: e.message };
    }
  },

  /** Staff confirm a web hotel. It goes into this trip's custom choices only (never data/hotels.json). */
  "POST /api/hotels/confirm": (b) => {
    const { plan } = planOrFail(b);
    const pkg = pkgOrFail(plan, b.option_id);
    const [query, why] = webHotels.searchQuery(plan, pkg, { allowFictional: aivana.mockMode() });
    if (!query) throw bad(why);
    const cand = (aiTasks.findSearch(query)?.hotels || []).find((h) => h.hotel_id === String(b.hotel_id || ""));
    if (!cand) throw bad("That web hotel isn't in the latest search for this trip. Search again.");
    const f = b.confirm && typeof b.confirm === "object" ? b.confirm : {};
    const web_hotel = { hotel_id: cand.hotel_id, name: cand.name, address: cand.address,
      source_url: ((cand.sources || []).find((x) => x.ok !== false) || {}).url || "",
      nightly_rate: f.nightly_rate, rooms_available: f.rooms_available, miles_to_stadium: f.miles_to_stadium,
      bus_parking: f.bus_parking, meeting_room: f.meeting_room, confirmed_by_staff: f.confirmed_by_staff === true };
    const base = b.custom && b.custom.option_id === pkg.option_id ? b.custom : { option_id: pkg.option_id, meals: {} };
    const r = makePlan(b.request, b.settings, { ...base, option_id: pkg.option_id, hotel_id: cand.hotel_id, web_hotel });
    if (r.problems) throw bad("Please fix the hotel details.", r.problems);
    return { custom: r.plan.custom, plan: r.plan };
  },

  /** Aivana's advisory "Which hotel?" from code-built fact cards (unconfirmed web hotels are never on a card). */
  "POST /api/hotels/recommend": async (b) => {
    const { plan, settings } = planOrFail(b);
    const pkg = pkgOrFail(plan, b.option_id);
    if (!pkg.nights) throw bad("This option has no hotel night.");
    const cards = webHotels.hotelCards(plan, pkg, DATA, settings);
    if (!cards.length) throw bad("No usable hotel for this option.");
    try { return { recommendation: await aiTasks.recommendHotel(cards), cards }; }
    catch (e) { if (e instanceof AivanaError) throw aiError(e); throw e; }
  },

  /** The approved memo as a PDF. The browser sends the memo text; nothing is stored. */
  "POST /api/memo/pdf": (b, res) => {
    const { plan, req, settings } = planOrFail(b);
    const pkg = pkgOrFail(plan, b.option_id);
    const approval = checkApproval(b, plan, req, settings, pkg);
    const text = String(b.text || "").trim();
    if (!text) throw bad("Write the memo first, then download it as a PDF.");
    if (text.length > 30000) throw bad("The memo is too long to export.");
    const pdf = memoPdf({ plan, pkg, approval, text, check: planner.checkMemoText(text, plan) });
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": pdf.length,
      "Content-Disposition": `attachment; filename=bgsu-trip-memo-${plan.game.game_id}-${pkg.option_id}.pdf` });
    res.end(pdf);
    return undefined;
  },

  "POST /api/check": (b) => {
    const { plan } = planOrFail(b);
    return planner.checkMemoText(String(b.text || ""), plan);
  },

  // ------------------------------------------------------------- advanced
  "POST /api/details": (b) => {
    const { plan, req, settings } = planOrFail(b);
    const pkg = pkgOrFail(plan, b.option_id);
    const rec = APPROVALS[String(b.approval_id || "")];
    const fp = planFingerprint(req, settings, plan.custom, pkg.option_id);
    return { package: pkg, rooming: pkg.nights ? planner.roomingList(DATA, req, settings) : null, game: plan.game,
      request: req, choices: planner.choicesFor(plan, pkg.option_id, DATA, settings), custom: plan.custom,
      required_acks: requiredAcks(pkg), approval_valid: Boolean(rec && rec.fingerprint === fp) };
  },

  /** Human approval gate. Staff must name their role and acknowledge every broken rule and budget overrun. */
  "POST /api/approve": (b) => {
    const { plan, req, settings } = planOrFail(b);
    const pkg = pkgOrFail(plan, b.option_id);
    if (!pkg.feasible) throw bad("This option is not possible with the current departure time, so it cannot be approved.");
    const role = b.role;
    if (!APPROVER_ROLES.includes(role)) throw bad("Choose who is approving (role).");
    const need = requiredAcks(pkg);
    const given = new Set(Array.isArray(b.acknowledged) ? b.acknowledged : []);
    const missing = need.filter((a) => !given.has(a));
    if (missing.length) throw bad("Please acknowledge each issue before approving.", { errors: missing });
    const rec = { approval_id: randomUUID().replaceAll("-", "").slice(0, 8),
      fingerprint: planFingerprint(req, settings, plan.custom, pkg.option_id),
      option_id: pkg.option_id, option_name: pkg.name, role, approved_at: nowLocal(), total: pkg.costs.total,
      budget: plan.budget, budget_gap: pkg.budget_gap, acknowledged: need, note: String(b.note || "").slice(0, 300),
      game_id: req.game_id };
    APPROVALS[rec.approval_id] = rec;
    try { writeFileSync(APPROVALS_FILE, JSON.stringify(APPROVALS, null, 1)); } catch { /* keep going in memory */ }
    return { approval: rec };
  },

  /** Everything for the final trip plan; only for the approved version. */
  "POST /api/final": (b) => {
    const { plan, req, settings } = planOrFail(b);
    const pkg = pkgOrFail(plan, b.option_id);
    const approval = checkApproval(b, plan, req, settings, pkg);
    return { approval, package: pkg, rooming: pkg.nights ? planner.roomingList(DATA, req, settings) : null,
      expense_report: planner.expenseReportInfo(pkg, settings) };
  },

  "POST /api/ics": (b, res) => {
    const { plan, req, settings } = planOrFail(b);
    const pkg = pkgOrFail(plan, b.option_id);
    checkApproval(b, plan, req, settings, pkg);
    const esc = (s) => s.replaceAll("\\", "\\\\").replaceAll(",", "\\,").replaceAll(";", "\\;").replaceAll("\n", "\\n");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Away-Game Travel Planner//EN"];
    pkg.timeline.forEach((ev, i) => {
      const start = parseDT(ev.time);
      lines.push("BEGIN:VEVENT", `UID:${plan.game.game_id}-${pkg.option_id}-${i}@away-game-planner`, `DTSTAMP:${stamp}`,
        `DTSTART:${strftime(start, "%Y%m%dT%H%M")}00`, `DTEND:${strftime(addHours(start, 0.5), "%Y%m%dT%H%M")}00`,
        `SUMMARY:${esc(ev.label)}`, `DESCRIPTION:${esc(`Option ${pkg.option_id}. Times are estimates.`)}`, "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    const fname = `trip-${plan.game.game_id}-${pkg.option_id}.ics`;
    res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename=${fname}` });
    res.end(lines.join("\r\n") + "\r\n");
    return undefined;
  },

  /** Budget vs actual after the trip. Pure arithmetic, no AI. */
  "POST /api/actuals": (b) => {
    const { plan, req, settings } = planOrFail(b);
    const pkg = pkgOrFail(plan, b.option_id);
    checkApproval(b, plan, req, settings, pkg);
    const rows = [], errors = [];
    const given = b.actuals && typeof b.actuals === "object" ? b.actuals : {};
    for (const cat of ["transport", "lodging", "meals", "extras"]) {
      let actual;
      try {
        actual = round(toFloat(given[cat]), 2);
        if (actual < 0) throw new Error();
      } catch { errors.push(`Actual ${cat} must be a number of 0 or more.`); continue; }
      const est = pkg.costs[cat];
      rows.push({ category: cat, estimated: est, actual, variance: round(actual - est, 2),
        variance_pct: est ? round((actual - est) / est * 100, 1) : null });
    }
    if (errors.length) throw bad("Please fix the actuals.", { errors });
    const totalActual = round(rows.reduce((a, r) => a + r.actual, 0), 2);
    return { rows, estimated_total: pkg.costs.total, actual_total: totalActual,
      variance_total: round(totalActual - pkg.costs.total, 2), budget: plan.budget,
      actual_vs_budget: round(plan.budget - totalActual, 2) };
  },
};

// ----------------------------------------------------------------- http plumbing

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon" };
const MAX_BODY = 1_000_000;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

// Feature 8: a screenshot is sent as base64, so this one route takes more (3 MB, about 2.2 MB of image).
const BODY_LIMITS = { "/api/schedule/read": schedImport.MAX_READ_BODY };

async function readBody(req, limit = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) {
      throw bad(limit > MAX_BODY ? "The image is too large even after shrinking. Crop it to the schedule and try again."
        : "Request body too large.", { code: "too_large" }, 413);
    }
    chunks.push(c);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/static\//, "");
  const file = normalize(join(STATIC, rel));
  if (!file.startsWith(STATIC + sep)) return sendJson(res, 404, { error: "Not found" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch { sendJson(res, 404, { error: "Not found" }); }
}

export async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  try {
    if (req.method === "GET" && (path === "/" || path.startsWith("/static/"))) return await serveStatic(res, path);
    const route = routes[`${req.method} ${path}`];
    if (!route) return sendJson(res, path.startsWith("/api/") ? 405 : 404, { error: "Not found" });
    const b = req.method === "POST" ? await readBody(req, BODY_LIMITS[path]) : {};
    const out = await route(b, res);
    if (out !== undefined) sendJson(res, 200, out);
  } catch (e) {
    if (res.headersSent) { res.end(); return; }
    if (e instanceof HttpError) return sendJson(res, e.status, e.payload);
    console.error(e);
    sendJson(res, 500, { error: "Server error. Check the server log." });
  }
}

export const app = createServer(handle);

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT || 5000);
  app.listen(port, "127.0.0.1", () => {
    console.log(`Away-Game Travel Planner on http://127.0.0.1:${port}  (mock mode: ${aivana.mockMode()})`);
  });
}
