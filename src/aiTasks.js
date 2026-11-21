// Prompts, JSON Schemas, validators and offline mocks for every Aivana call.
//
// Rule for every prompt: the model chooses, extracts and explains. It never
// computes, and it never states a price, distance or date that is not in the
// data we send it.

import * as aivana from "./aivana.js";
import { InvalidAnswer } from "./aivana.js";
import * as planner from "./planner.js";
import * as webHotels from "./webHotels.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { money, parseDT, addDays, fmtDate, strftime, fmtDayTime, stableStringify, sha256, clone, sortBy } from "./util.js";

// Token saving: identical inputs reuse the earlier answer instead of calling Aivana again.
const CACHE = new Map();
const CACHE_MAX = 100;

function cacheGet(kind, payload) {
  const key = `${kind}:${sha256(stableStringify(payload))}`;
  const hit = CACHE.get(key);
  if (hit !== undefined) aivana.USAGE.cache_hits = (aivana.USAGE.cache_hits || 0) + 1;
  return [key, hit !== undefined ? clone(hit) : null];
}
function cachePut(key, value) {
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, clone(value));
}
export const _clearCache = () => CACHE.clear();

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, "twenty-one": 21, "twenty-two": 22, "twenty-three": 23, "twenty-four": 24, "twenty-five": 25 };
const WORD_RE = Object.keys(WORDS).sort((a, b) => b.length - a.length).join("|");

/** Personal details that must not reach Aivana (names, health, contact or student IDs).
 * Pattern-based, so it catches the common cases, not every phrasing. Returns what was found. */
const PERSONAL_CHECKS = [
  ["a person's name", /\b(?:[Cc]oach|[Pp]layer|[Tt]rainer|[Cc]aptain|[Kk]eeper|[Gg]oalie|Mr|Mrs|Ms|Dr)\.?\s+[A-Z][a-z]+/],
  ["health or injury details", /\b(?:injur\w*|hurt|sick|ill|illness|concussion\w*|medical|medication\w*|surgery|diagnos\w*|hospital\w*|allerg\w*|pregnan\w*|disabilit\w*|rehab)\b/i],
  ["an email address", /[\w.+-]+@[\w-]+\.[\w.]+/],
  ["a phone number", /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/],
  ["a student ID", /\b\d{9}\b/],
];
export function personalDetails(text) {
  return PERSONAL_CHECKS.filter(([, re]) => re.test(String(text || ""))).map(([what]) => what);
}
const listJoin = (xs) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
export const PERSONAL_MESSAGE = (found) => `Please take out ${listJoin(found)} before sending this to Aivana. ` +
  "Use counts only, like \"21 players\" or \"leave 2 players home\". Who travels is managed in the app by player ID.";
const DAY_OFFSETS = { game_day: 0, day_before: 1, two_days_before: 2 };
const compact = (obj) => JSON.stringify(obj);
const num = (token) => {
  token = token.toLowerCase();
  return token in WORDS ? WORDS[token] : (/^\d+$/.test(token) ? parseInt(token, 10) : null);
};
const weekday = (t) => strftime(t, "%A").toLowerCase();

// ====================================================================== 1. parse

export function parseSchema(gameIds) {
  const nint = { type: ["integer", "null"] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["game_id", "num_players", "num_coaches", "num_staff", "budget",
      "depart_after_day", "depart_after_time", "missing", "assumptions"],
    properties: {
      game_id: { type: ["string", "null"], enum: [...gameIds, null],
        description: "ID of the matching game from the schedule, or null if unclear." },
      num_players: nint, num_coaches: nint, num_staff: nint,
      budget: { type: ["number", "null"], description: "Total trip budget in dollars, if stated." },
      depart_after_day: { type: ["string", "null"], enum: ["two_days_before", "day_before", "game_day", null],
        description: "Earliest departure day relative to the game, if stated." },
      depart_after_time: { type: ["string", "null"], description: "Earliest departure time as 24-hour HH:MM, if stated." },
      missing: { type: "array", items: { type: "string" }, description: "Required fields the text did not state." },
      assumptions: { type: "array", items: { type: "string" },
        description: "Any interpretation you made, in a few words each." },
    },
  };
}

const PARSE_SYSTEM =
  "You extract fields from a BGSU (Bowling Green State University) men's soccer staff member's away-match " +
  "travel request. Trips start and end at the BGSU campus. " +
  "Use only what the text says. Pick game_id only from the schedule provided, by matching the " +
  "opponent, city or day. If a number is not stated, return null and list it in missing; never guess " +
  "or calculate one. 'Noon' is 12:00. 'Friday' before a Saturday game is day_before.";

const scheduleLines = (data) => data.schedule.games
  .map((x) => `${x.game_id}|${x.opponent}|${x.city}|${strftime(planner.kickoffDT(x), "%a %Y-%m-%d %H:%M")}`).join("\n");

export function mockParse(text, data) {
  const t = text.toLowerCase();
  const game = data.schedule.games.find((x) => t.includes(x.opponent.toLowerCase()) || t.includes(x.city.toLowerCase()) ||
    t.includes(x.opponent.split(/\s+/)[0].toLowerCase())) || null;
  const grab = (word) => {
    const m = new RegExp(`(\\d+|${WORD_RE})\\s+${word}`).exec(t);
    return m ? num(m[1]) : null;
  };
  let budget = null;
  const bm = /\$\s?([\d,]+(?:\.\d+)?)\s*(k)?/.exec(t) || /budget (?:is |of )?([\d,]+)\s*(k)?/.exec(t);
  if (bm) budget = parseFloat(bm[1].replaceAll(",", "")) * (bm[2] ? 1000 : 1);
  let day = null;
  if (game) {
    const gd = parseDT(game.date);
    for (const [off, key] of [[1, "day_before"], [2, "two_days_before"], [0, "game_day"]]) {
      if (t.includes(weekday(addDays(gd, -off)))) { day = key; break; }
    }
  }
  let tm = null;
  if (t.includes("noon")) tm = "12:00";
  else {
    const m = /(\d{1,2})(?::(\d\d))?\s*(am|pm)/.exec(t);
    if (m) tm = `${String((Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0)).padStart(2, "0")}:${m[2] || "00"}`;
  }
  const out = { game_id: game ? game.game_id : null, num_players: grab("players"), num_coaches: grab("coaches"),
    num_staff: grab("staff"), budget, depart_after_day: day, depart_after_time: tm, assumptions: ["Parsed by offline mock"] };
  out.missing = ["game_id", "num_players", "num_coaches", "num_staff", "budget"].filter((k) => out[k] === null);
  return out;
}

/** Free text -> request fields. Code, not the model, turns day+time into a date. */
export async function parseRequest(text, data) {
  text = String(text).trim().slice(0, 2000);
  const ids = data.schedule.games.map((x) => x.game_id);
  const validate = (o) => {
    if (!(o.game_id === null || o.game_id === undefined || ids.includes(o.game_id))) {
      throw new InvalidAnswer("game_id must be one of the schedule IDs or null.");
    }
    const tm = o.depart_after_time;
    if (tm !== null && tm !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(tm)) {
      throw new InvalidAnswer("depart_after_time must be HH:MM.");
    }
  };
  const [key, cached] = cacheGet("parse", text);
  const out = cached ?? await aivana.structured({
    kind: "parse", system: PARSE_SYSTEM,
    messages: [{ role: "user", content: `Schedule (id|opponent|city|kickoff):\n${scheduleLines(data)}\n\nRequest:\n${text}` }],
    schema: parseSchema(ids), maxTokens: 400, mock: () => mockParse(text, data), validate });
  if (cached === null) cachePut(key, out);

  const req = Object.fromEntries(["game_id", "num_players", "num_coaches", "num_staff", "budget"].map((k) => [k, out[k] ?? null]));
  const game = planner.getGame(data, out.game_id || "");
  if (game && (out.depart_after_day || out.depart_after_time)) {
    const off = DAY_OFFSETS[out.depart_after_day || "day_before"] ?? 1;
    req.depart_after = `${fmtDate(addDays(parseDT(game.date), -off))}T${out.depart_after_time || "08:00"}`;
  }
  return { request: req, missing: out.missing || [], assumptions: out.assumptions || [] };
}

// ====================================================================== 2. recommend

const RECOMMEND_SYSTEM =
  "You advise BGSU men's soccer travel staff; every trip starts and ends at the BGSU campus. You get trip options that the app already priced and checked " +
  "against the staff's own team rules. Recommend one option by its option_id and explain the tradeoff " +
  "between cost and the team rules it keeps or breaks, using the facts given (departure time, hours on " +
  "the bus on game day, night in a hotel before the game, return time). " +
  "Options may also have example travel-policy issues; treat them like broken rules that need approval. " +
  "The policy values are staff-entered examples, not BGSU's current policy: call them example policy values " +
  "and never describe them as BGSU policy. " +
  "Each broken rule is tagged with the level staff gave it: must-have, important or nice-to-have. The app " +
  "ranks options by fewest must-have rules broken, then important, then nice-to-have, then cost. When a " +
  "rule's level decides the pick, name that rule and its level. " +
  "Rules: use only numbers that appear in the data, copied exactly with $ and two decimals; never " +
  "calculate new numbers; do not judge player health or give nutrition advice; do not mention prices, " +
  "hotels or facts not in the data; refer to options by ID. Keep the explanation under 90 words. " +
  "Advisory tone: staff decide.";

export function recommendSchema(ids) {
  return {
    type: "object", additionalProperties: false,
    required: ["recommended_option_id", "pick_type", "headline", "explanation", "tradeoffs"],
    properties: {
      recommended_option_id: { type: "string", enum: ids },
      pick_type: { type: "string", enum: ["best_within_budget", "best_fit_rules", "other"] },
      headline: { type: "string", description: "One short sentence." },
      explanation: { type: "string" },
      tradeoffs: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["option_id", "upside", "downside"],
        properties: { option_id: { type: "string", enum: ids }, upside: { type: "string" }, downside: { type: "string" } } } },
    },
  };
}

const hmLabel = (iso) => fmtDayTime(parseDT(iso));
const gapText = (gap) => (gap >= 0 ? `$${money(gap)} under` : `$${money(-gap)} over`);

const withLevel = (r) => `${r.rule} (${planner.PRIORITY_NAMES[r.priority] || "important"})`;
const levelCounts = (p) => { const b = p.broken_by_priority || planner.brokenByPriority(p);
  return { "must-have": b.must, important: b.important, "nice-to-have": b.nice }; };

export function packageSummary(plan) {
  return plan.packages.map((p) => {
    const f = p.facts;
    return { id: p.option_id, name: p.name, possible: p.feasible, total: `$${money(p.costs.total)}`,
      budget: gapText(p.budget_gap), depart: hmLabel(f.departure), night_in_hotel_before_game: f.night_before,
      gameday_bus_hours: f.gameday_travel_hours, home: hmLabel(f.return_time),
      team_rules_broken: p.rule_checks.filter((r) => !r.ok).map(withLevel),
      example_policy_issues: (p.policy_checks || []).filter((r) => !r.ok).map(withLevel),
      broken_by_level: levelCounts(p),
      ...(p.drivers ? { longest_driving_hours: p.drivers.longest, drivers_per_bus: p.drivers.drivers,
        second_driver_cost: p.drivers.extra_cost ? `$${money(p.drivers.extra_cost)}` : null } : {}),
      notes: p.notes.slice(0, 3), labels: p.labels };
  });
}

export function mockRecommend(plan) {
  const byId = Object.fromEntries(plan.packages.map((p) => [p.option_id, p]));
  const pick = plan.best_within_budget || plan.best_fit_rules || plan.packages[0].option_id;
  const kind = plan.best_within_budget ? "best_within_budget" : "best_fit_rules";
  const p = byId[pick];
  const broken = p.rule_checks.filter((r) => !r.ok).map(withLevel);
  let expl = `Option ${pick} totals $${money(p.costs.total)} (${gapText(p.budget_gap)} budget)`;
  expl += broken.length ? ` but breaks ${broken.length} team rule(s): ${broken.join("; ")}.` : " and keeps every team rule.";
  const other = plan.best_fit_rules;
  if (other && other !== pick) {
    const o = byId[other];
    expl += ` Option ${other} fits the rule priorities better at $${money(o.costs.total)} ($${money(-o.budget_gap)} over budget); ` +
      "a what-if may close that gap.";
  }
  const trade = plan.packages.map((q) => {
    const qb = sortBy([...q.rule_checks, ...(q.policy_checks || [])].filter((r) => !r.ok), (r) => [-r.priority]).map(withLevel);
    return { option_id: q.option_id,
      upside: q.facts.night_before ? "Night in a hotel before the game" : "Lowest cost, no hotel",
      downside: qb.length ? `Breaks: ${qb[0]}` : (q.notes[0] || "No issues found") };
  });
  return { recommended_option_id: pick, pick_type: kind, headline: `Go with option ${pick}: ${p.name}.`,
    explanation: expl, tradeoffs: trade };
}

export async function recommend(plan) {
  const ids = plan.packages.map((p) => p.option_id);
  const feasible = plan.packages.filter((p) => p.feasible).map((p) => p.option_id);
  const validate = (o) => {
    if (!(feasible.length ? feasible : ids).includes(o.recommended_option_id)) {
      throw new InvalidAnswer("recommended_option_id must be a possible option.");
    }
    for (const t of o.tradeoffs || []) {
      if (!ids.includes(t.option_id)) throw new InvalidAnswer("tradeoffs must reference real option IDs.");
    }
  };
  const payload = { budget: `$${money(plan.budget)}`, best_within_budget: plan.best_within_budget,
    best_fit_team_rules: plan.best_fit_rules, options: packageSummary(plan) };
  const [key, cached] = cacheGet("recommend", payload);
  let out;
  if (cached !== null) {
    out = cached;
    out.cached = true;
  } else {
    out = await aivana.structured({ kind: "recommend", system: RECOMMEND_SYSTEM,
      messages: [{ role: "user", content: compact(payload) }], schema: recommendSchema(ids), maxTokens: 600,
      mock: () => mockRecommend(plan), validate });
    cachePut(key, out);
  }
  const text = [out.headline || "", out.explanation || "",
    ...(out.tradeoffs || []).map((t) => `Option ${t.option_id}: ${t.upside || ""}. Option ${t.option_id}: ${t.downside || ""}.`)]
    .join(" ");
  out.unverified_numbers = planner.checkNumbers(text, plan);
  out.unverified_claims = planner.checkClaims(text, plan);
  return out;
}

// ====================================================================== 2b. season plan explanation

const SEASON_SYSTEM =
  "You explain a season travel plan to BGSU men's soccer staff. The app's code already picked one option " +
  "per away game so the season fits the budget and breaks as few rules as possible (must-have rules first, " +
  "then important, then nice-to-have, then cost). It may go over budget by a staff-set allowance, but only " +
  "to keep must-have rules. You do not choose or change anything; you explain the code's result. " +
  "In 2-4 sentences say which trips changed from the single-trip picks, how much that saves, which " +
  "must-have rules are protected or still broken, and any warning. Rules: use only numbers that appear " +
  "in the data, copied exactly with $ and two decimals; never calculate new numbers; refer to trips by " +
  "opponent and option ID; do not judge player health. Advisory tone: staff decide.";

const seasonSchema = () => ({
  type: "object", additionalProperties: false, required: ["headline", "explanation"],
  properties: { headline: { type: "string", description: "One short sentence." }, explanation: { type: "string" } },
});

const levelText = (b) => ({ "must-have": b.must, important: b.important, "nice-to-have": b.nice });

export function seasonFacts(overview) {
  const o = overview.optimizer;
  const planFacts = (pl) => pl && { total: `$${money(pl.total)}`,
    budget: pl.over_budget ? `$${money(-pl.gap)} over` : `$${money(pl.gap)} under`,
    rules_broken: levelText(pl.broken),
    picks: pl.picks.map((p) => ({ game: p.opponent, option: p.option_id, name: p.name, cost: `$${money(p.cost)}`,
      rules_broken: levelText(p.broken), single_trip_pick: p.single_pick, changed: p.changed })) };
  return { season_budget: `$${money(o.budget)}`, allowance: `${o.allowance_pct}% (up to $${money(o.limit)})`,
    fits: o.fits, season_plan: planFacts(o.plan),
    strict_budget_plan: o.same_as_strict ? "same as the season plan" : planFacts(o.strict),
    changes_from_single_trip_picks: o.changes.map((c) => c.text), warnings: o.warnings,
    season_reserve: `$${money(overview.season_reserve)}` };
}

export function mockSeason(overview) {
  const o = overview.optimizer, pl = o.plan;
  if (!pl) return { headline: "No season plan could be built.", explanation: o.warnings.join(" ") };
  const changes = o.changes.length
    ? `Changes from the single-trip picks: ${o.changes.map((c) => `${c.text}`).join("; ")}.`
    : "Every game keeps its single-trip pick.";
  const status = pl.over_budget ? `$${money(-pl.gap)} over` : `$${money(pl.gap)} under`;
  return { headline: `Season plan: $${money(pl.total)}, ${status} the $${money(o.budget)} budget.`,
    explanation: [changes, ...o.warnings].join(" ") };
}

export async function explainSeason(overview) {
  const payload = seasonFacts(overview);
  const [key, cached] = cacheGet("season", payload);
  let out = cached;
  if (out === null) {
    out = await aivana.structured({ kind: "season", system: SEASON_SYSTEM,
      messages: [{ role: "user", content: compact(payload) }], schema: seasonSchema(), maxTokens: 400,
      mock: () => mockSeason(overview) });
    cachePut(key, out);
  }
  out = { ...out };
  Object.assign(out, planner.checkSeasonText(`${out.headline || ""} ${out.explanation || ""}`, overview));
  return out;
}

// ====================================================================== 3. what-if chat

const WHATIF_SYSTEM =
  "You are the review assistant for a BGSU athletics travel coordinator. The staff and you go back and " +
  "forth until staff approve a plan; you never approve anything yourself. You get the current options " +
  "(already priced and rule-checked by the app) and the list of changes made so far. " +
  "If the staff asks a question, answer it from that data only, copying numbers exactly, with no edits. " +
  "If the staff asks for a change, turn it into edits; you do not compute results, the app recalculates. " +
  "When useful, mention which earlier changes are still in effect. Numeric fields: use op 'add' for relative changes (\"leave 3 players " +
  "home\" -> num_players add -3) and 'set' for absolute values (\"cap hotels at $120\" -> hotel_max_rate " +
  "set 120); 'clear' only removes the hotel cap. 'Coaches two to a room' -> staff_per_room set 2. " +
  "Supplies or hydration per person per day -> extras_per_person_per_day. " +
  "Departure: depart_after_day set with text_value game_day / day_before / two_days_before (relative to " +
  "the game shown), and depart_after_time set with value = hour on a 24-hour clock (3 PM -> 15). " +
  "Hotel: hotel_id set with text_value = an ID from the hotel list. Game: game_id set with text_value = an " +
  "ID from the game list. Use only IDs from the lists. If a request cannot be expressed, return no edits " +
  "and say so. Reply in at most three sentences. For a change request, do not state the new costs or " +
  "results (the app shows them). Never say the plan is approved or final.";

export function whatifSchema() {
  return {
    type: "object", additionalProperties: false, required: ["reply", "edits"],
    properties: {
      reply: { type: "string" },
      edits: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["field", "op", "value", "text_value"],
        properties: {
          field: { type: "string", enum: Object.keys(planner.WHATIF_FIELDS) },
          op: { type: "string", enum: ["set", "add", "clear"] },
          value: { type: ["number", "null"] },
          text_value: { type: ["string", "null"] } } } },
    },
  };
}

export function mockWhatif(message, data = null, game = null) {
  const t = message.toLowerCase();
  const edits = [];
  const e = (field, op, value = null, text = null) => edits.push({ field, op, value, text_value: text });

  let m = new RegExp(`(leave|drop|cut|remove)\\s+(\\d+|${WORD_RE})\\s+players?`).exec(t);
  if (m) e("num_players", "add", -num(m[2]));
  m = new RegExp(`(add|bring)\\s+(\\d+|${WORD_RE})\\s+(more\\s+)?players?`).exec(t);
  if (m) e("num_players", "add", num(m[2]));
  m = /(coach|staff)\w*[^.;]{0,30}?\b(\d+|two|three)\s+(to|per)\s+(a\s+)?room/.exec(t);
  if (m) e("staff_per_room", "set", num(m[2]));
  m = /players?(?:(?!coach|staff)[^.;]){0,30}?\b(\d+|two|three|four)\s+(to|per)\s+(a\s+)?room/.exec(t);
  if (m) e("players_per_room", "set", num(m[1]));
  if (/(remove|no|drop)\s+(the\s+)?(hotel\s+|lodging\s+)?cap/.test(t)) {
    e("hotel_max_rate", "clear");
  } else {
    m = /(cap|limit|under|max).{0,30}?\$\s?(\d+)/.exec(t);
    if (m && /hotel|lodging|room|night/.test(t)) e("hotel_max_rate", "set", parseFloat(m[2]));
  }
  m = /budget.{0,20}?\$\s?([\d,]+)\s*(k)?/.exec(t);
  if (m) e("budget", "set", parseFloat(m[1].replaceAll(",", "")) * (m[2] ? 1000 : 1));
  if (data) {
    for (const h of data.hotels.hotels) {
      if ((!game || h.city === game.city) && t.includes(h.name.toLowerCase())) e("hotel_id", "set", null, h.hotel_id);
    }
    for (const x of data.schedule.games) {
      if ((!game || x.game_id !== game.game_id) && (t.includes(x.opponent.toLowerCase()) || t.includes(x.city.toLowerCase()))) {
        e("game_id", "set", null, x.game_id);
        game = x;
        break;
      }
    }
  }
  if (/\b(leave|depart|departure|go)\b/.test(t)) {
    if (game) {
      const gd = parseDT(game.date);
      let found = false;
      for (const [off, key] of [[1, "day_before"], [2, "two_days_before"], [0, "game_day"]]) {
        if (t.includes(weekday(addDays(gd, -off)))) { e("depart_after_day", "set", null, key); found = true; break; }
      }
      if (!found) {
        if (t.includes("game day")) e("depart_after_day", "set", null, "game_day");
        else if (t.includes("day before")) e("depart_after_day", "set", null, "day_before");
      }
    }
    m = /(\d{1,2})(?::(\d\d))?\s*(am|pm)/.exec(t);
    if (m) e("depart_after_time", "set", (Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0) + Number(m[2] || 0) / 60);
    else if (t.includes("noon")) e("depart_after_time", "set", 12);
  }
  const reply = edits.length ? "Applying those changes and recalculating." :
    "I can change headcount, people per room, seats per bus, meal allowance, supplies, hotel rate cap, " +
    "budget, departure day and time, the hotel, or the game.";
  return { reply, edits };
}

export function mockAnswer(plan, changeLog) {
  const parts = plan.packages.map((p) =>
    `Option ${p.option_id} totals $${money(p.costs.total)} (${gapText(p.budget_gap)} budget) and breaks ` +
    `${p.rules_broken} team rule(s).`);
  if (changeLog.length) parts.push("Changes in effect: " + changeLog.slice(-3).join("; ") + ".");
  return parts.join(" ");
}

export async function whatif(message, history, req, overrides, settings, data, plan = null, changeLog = null) {
  const game = planner.getGame(data, req.game_id);
  changeLog = (Array.isArray(changeLog) ? changeLog : []).map((c) => String(c).slice(0, 160)).slice(-6);
  const state = Object.fromEntries(["game_id", "num_players", "num_coaches", "num_staff", "budget", "depart_after"]
    .map((k) => [k, req[k] ?? null]));
  for (const k of ["players_per_room", "staff_per_room", "seats_per_bus", "meal_allowance", "hotel_max_rate",
    "extras_per_person_per_day"]) state[k] = settings[k] ?? null;
  const context = {
    current: state,
    game: `${game.opponent} on ${strftime(parseDT(game.date), "%a %Y-%m-%d")}`,
    games: data.schedule.games.map((x) => `${x.game_id}=${x.opponent}`),
    hotels: data.hotels.hotels.filter((h) => h.city === game.city).map((h) => `${h.hotel_id}=${h.name}`),
    changes_so_far: changeLog,
    options: plan ? packageSummary(plan) : [],
  };
  const msgs = (Array.isArray(history) ? history : [])
    .filter((x) => x && ["user", "assistant"].includes(x.role) && typeof x.content === "string")
    .map((x) => ({ role: x.role, content: x.content.slice(0, 500) })).slice(-8);
  msgs.push({ role: "user", content: `${compact(context)}\nRequest: ${message.slice(0, 500)}` });
  const mock = () => {
    const out = mockWhatif(message, data, game);
    if (!out.edits.length && plan && /\?|\b(why|what|which|how|show|summar|status|where)\b/.test(message.toLowerCase())) {
      out.reply = mockAnswer(plan, changeLog);
    }
    return out;
  };
  return aivana.structured({ kind: "chat", system: WHATIF_SYSTEM, messages: msgs, schema: whatifSchema(), maxTokens: 400, mock });
}

// ====================================================================== 4. trip memo (streamed)

const MEMO_SYSTEM =
  "Write a BGSU athletics trip memo from the approved plan data provided. Start with the approval line. Use only those facts: do not add " +
  "prices, places, times or advice that are not in the data. Sections: Overview, Schedule, Lodging, " +
  "Meals, Costs, Team rules, Watch-outs. Short plain-text lines with dashes, under 300 words. " +
  "Copy dollar amounts exactly. Travel-policy values are examples, not BGSU's current policy: call them example " +
  "policy values and never present them as BGSU policy. End with: 'Costs are estimates from the data pack.'";

export function memoFacts(plan, pkg, req, approval = null) {
  return {
    approval: approval ? `Approved by ${approval.role} on ${hmLabel(approval.approved_at)} (approval ${approval.approval_id})`
      : "Not approved",
    from: plan.home || "BGSU campus",
    game: `${plan.game.opponent} at ${plan.game.stadium}, ${plan.game.city}`,
    option: `${pkg.option_id}: ${pkg.name}`,
    travelers: `${req.num_players} players, ${req.num_coaches} coaches, ${req.num_staff} staff`,
    transport: pkg.bus ? `${pkg.bus.count} charter bus${pkg.bus.count !== 1 ? "es" : ""} (${pkg.bus.vendor})`
      : `Charter flight (${pkg.flight.carrier}) plus local buses`,
    hotel: pkg.hotel ? `${pkg.hotel.name}, ${pkg.lodging_detail.rooms} rooms` : "None",
    schedule: pkg.timeline.map((e) => `${hmLabel(e.time)} - ${e.label}`),
    meals: pkg.meals.map((m) => `${m.label}: ${m.where}, $${money(m.cost)}`),
    costs: Object.fromEntries(Object.entries(pkg.costs).map(([k, v]) => [k, `$${money(v)}`])),
    budget: `$${money(plan.budget)}`,
    budget_gap: gapText(pkg.budget_gap),
    team_rules: pkg.rule_checks.map((r) => `${r.ok ? "OK" : `BROKEN, ${planner.PRIORITY_NAMES[r.priority]}`}: ${r.rule} (actual ${r.actual})`),
    example_policy: (pkg.policy_checks || []).map((r) => `${r.ok ? "OK" : `ISSUE, ${planner.PRIORITY_NAMES[r.priority]}`}: ${r.rule} (actual ${r.actual})`),
    flags: pkg.flags,
    drivers: pkg.drivers ? `${pkg.drivers.drivers} driver(s) per bus; longest driving stretch ${pkg.drivers.longest} hrs ` +
      `(limit ${pkg.drivers.limit} hrs)` + (pkg.drivers.extra_cost ? `; second driver $${money(pkg.drivers.extra_cost)}` : "") : null,
  };
}

export function mockMemo(f) {
  const cap = (k) => k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
  return [`BGSU TRIP MEMO: ${f.game}`, f.approval, "", "Overview",
    `- Option ${f.option}`, `- Travelers: ${f.travelers}`, `- Transport: ${f.transport}`, `- Hotel: ${f.hotel}`,
    "", "Schedule", ...f.schedule.map((s) => `- ${s}`),
    "", "Meals", ...f.meals.map((m) => `- ${m}`),
    "", "Costs", ...Object.entries(f.costs).map(([k, v]) => `- ${cap(k)}: ${v}`),
    `- Budget ${f.budget} (${f.budget_gap})`, "", "Team rules (set by staff)", ...f.team_rules.map((r) => `- ${r}`),
    "", "Example travel-policy checks (example values – confirm with BGSU Travel Services)", ...f.example_policy.map((r) => `- ${r}`),
    "", "Watch-outs", ...(f.flags.length ? f.flags.map((x) => `- ${x}`) : ["- None flagged"]),
    "", "Costs are estimates from the data pack."].join("\n");
}

export function memoStream(plan, pkg, req, approval = null) {
  const facts = memoFacts(plan, pkg, req, approval);
  return aivana.stream({ kind: "memo", system: MEMO_SYSTEM, messages: [{ role: "user", content: compact(facts) }],
    maxTokens: 700, mock: () => mockMemo(facts) });
}


// ====================================================================== 7. web hotels (Feature 7)
// Search: Aivana (web search on) finds candidates; webHotels.js cleans them and opens every link.
// Results are saved to data/web_cache/ (hotel fields + link pass/fail only, never page text), so a real
// search keeps working offline for the demo. Mock mode never writes that folder.

const WEB_CACHE_DIR = () => process.env.WEB_CACHE_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "data", "web_cache");
const webKey = (q) => sha256(stableStringify(q)).slice(0, 20);
function readWebCache(q) {
  try { const f = JSON.parse(readFileSync(join(WEB_CACHE_DIR(), `${webKey(q)}.json`), "utf8")); return f.result || null; }
  catch { return null; }
}
function writeWebCache(q, result) {
  try {
    mkdirSync(WEB_CACHE_DIR(), { recursive: true });
    writeFileSync(join(WEB_CACHE_DIR(), `${webKey(q)}.json`), JSON.stringify({ query: q, result }, null, 1) + "\n");
  } catch { /* read-only disk: memory cache still works */ }
}

const HOTEL_SEARCH_SYSTEM =
  "Search the web for hotels for a college soccer team's away trip. Return up to 6 real hotels near the stadium that " +
  "could host a team. For every hotel give the exact URL of up to 3 pages you found it on that name the hotel and " +
  "can be read without logging in. Prefer pages that load as plain web pages: the hotel's own independent website, the " +
  "city's visitor bureau listing, or the university's visitor/athletics travel page. Big chain booking pages often " +
  "block automated checks, so add a second page for those. Never invent a hotel, link, price or distance. nightly_rate_usd: a nightly price only " +
  "if a page shows one, else null. miles_to_stadium: only if a page states it, else null. bus_parking: 'yes' or 'no' " +
  "only if a page says so, else 'unknown'. Do not estimate or calculate anything.";

export function hotelSearchSchema() {
  return { type: "object", additionalProperties: false, required: ["hotels"], properties: {
    hotels: { type: "array", maxItems: 6, items: { type: "object", additionalProperties: false,
      required: ["name", "address", "nightly_rate_usd", "miles_to_stadium", "bus_parking", "source_urls"],
      properties: {
        name: { type: "string" }, address: { type: "string" },
        nightly_rate_usd: { type: ["number", "null"] }, miles_to_stadium: { type: ["number", "null"] },
        bus_parking: { type: "string", enum: ["yes", "no", "unknown"] },
        source_urls: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } } } } } } };
}

/** Offline sample. Clearly marked SAMPLE; it also includes a duplicate, an out-of-range rate and a hotel with no link,
 * so the demo shows the cleaning step. */
export function mockHotelSearch(q) {
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const h = (name, rate, miles, parking, n = 1) => ({ name: `SAMPLE ${name}`, address: `${100 + n} Stadium Way, ${q.city}`,
    nightly_rate_usd: rate, miles_to_stadium: miles, bus_parking: parking,
    source_urls: [`https://example.com/sample-hotels/${slug(name)}`] });
  return { hotels: [
    h("Stadium View Inn", 139, 0.8, "yes", 1), h("Riverside Suites", 118, 3.5, "unknown", 2),
    h("Downtown Grand", 189, 1.6, "no", 3), h("Airport Lodge", 12, 9, "yes", 4),          // rate out of range -> empty
    h("Stadium View Inn", 139, 0.8, "yes", 1),                                            // duplicate -> removed
    { ...h("Lakeside Motor Lodge", 99, 6, "yes", 6), source_urls: [] } ] };               // no link -> dropped
}

/**
 * Search the web for hotels. Order: memory cache -> saved file -> Aivana. Returns
 * { query, hotels:[{hotel_id,name,address,nightly_rate_usd,miles_to_stadium,bus_parking,sources:[{url,ok,reason}]}],
 *   links_checked, status: ok|none_verified|no_results, message, mock, cached }.
 */
export async function searchHotels(query, { verify, onRaw } = {}) {
  const [key, cached] = cacheGet("hotel_search", query);
  if (cached !== null) return { ...cached, cached: true };
  const saved = readWebCache(query);
  if (saved) { aivana.USAGE.cache_hits = (aivana.USAGE.cache_hits || 0) + 1; cachePut(key, saved); return { ...saved, cached: true }; }
  const mock = aivana.mockMode();
  let sources = [];
  const raw = await aivana.structured({ kind: "hotel_search", system: HOTEL_SEARCH_SYSTEM, webSearch: true,
    messages: [{ role: "user", content: compact({ find_hotels_near: query.stadium, city: query.city, check_in: query.checkin,
      check_out: query.checkout, rooms_needed: query.rooms }) }],
    schema: hotelSearchSchema(), maxTokens: 1200, mock: () => mockHotelSearch(query),
    onRaw: (r) => { sources = r.sources; if (onRaw) onRaw(r); } });
  const out = { query, ...(await webHotels.processSearch(raw, { sources, verify, mock })), mock,
    searched_at: new Date().toISOString().slice(0, 16) };
  cachePut(key, out);
  if (!mock) writeWebCache(query, out);
  return { ...out, cached: false };
}

/** Look up an earlier search without calling Aivana (the confirm step uses this). */
export function findSearch(query) {
  const [, cached] = cacheGet("hotel_search", query);
  return cached ?? readWebCache(query);
}

const HOTEL_REC_SYSTEM =
  "You advise BGSU athletics staff on which hotel to use for one trip option. Use only the hotel cards provided. " +
  "Copy numbers exactly as they appear on the cards; never calculate, add, subtract, round or estimate. " +
  "recommended_hotel_id must be one of the cards. Prefer hotels with no rules_failed, then lower trip_lodging_cost, " +
  "but say what the other hotels do better. reason: under 60 words. confirm_with_hotel: short things staff should " +
  "confirm by phone (group rate, rooms, bus parking, breakfast); no numbers that are not on the cards. Staff decide.";

export function hotelRecSchema(ids) {
  return { type: "object", additionalProperties: false,
    required: ["recommended_hotel_id", "headline", "reason", "tradeoffs", "confirm_with_hotel"], properties: {
      recommended_hotel_id: { type: "string", enum: ids }, headline: { type: "string" }, reason: { type: "string" },
      tradeoffs: { type: "array", items: { type: "object", additionalProperties: false, required: ["hotel_id", "upside", "downside"],
        properties: { hotel_id: { type: "string", enum: ids }, upside: { type: "string" }, downside: { type: "string" } } } },
      confirm_with_hotel: { type: "array", maxItems: 5, items: { type: "string" } } } };
}

export function mockHotelRec(cards) {
  const pick = cards.find((c) => c.labels.includes("lowest_cost") && !c.rules_failed.length) || cards[0];
  const near = cards.find((c) => c.labels.includes("closest"));
  return {
    recommended_hotel_id: pick.hotel_id,
    headline: `Use ${pick.name} (${pick.hotel_id}).`,
    reason: `${pick.name} has the lowest lodging cost for this trip, $${money(pick.trip_lodging_cost)} at ` +
      `$${money(pick.nightly_rate)}/night, ${pick.miles_to_stadium} mi from the stadium.` +
      (near && near !== pick ? ` ${near.name} is closer at ${near.miles_to_stadium} mi but costs more.` : ""),
    tradeoffs: cards.map((c) => ({ hotel_id: c.hotel_id,
      upside: c.labels.includes("closest") ? `Closest: ${c.miles_to_stadium} mi` : `Lodging $${money(c.trip_lodging_cost)}`,
      downside: c.rules_failed.length ? c.rules_failed[0] : c === pick ? "None on the cards" : `Lodging $${money(c.trip_lodging_cost)}` })),
    confirm_with_hotel: ["Group rate for the team's rooms", "Space to park the bus", "Breakfast time on game day"],
  };
}

/** Aivana's "Which hotel?" advice. Cards come from webHotels.hotelCards(); the reason is fact-checked against them. */
export async function recommendHotel(cards) {
  if (!cards.length) throw new Error("No usable hotel for this option.");
  const ids = cards.map((c) => c.hotel_id);
  const validate = (o) => {
    if (!ids.includes(o.recommended_hotel_id)) throw new InvalidAnswer(`recommended_hotel_id must be one of ${ids.join(", ")}.`);
    if (String(o.reason || "").split(/\s+/).filter(Boolean).length > 60) throw new InvalidAnswer("reason must be under 60 words.");
    for (const t of o.tradeoffs || []) if (!ids.includes(t.hotel_id)) throw new InvalidAnswer(`tradeoff hotel ${t.hotel_id} is not a card.`);
  };
  const [key, cached] = cacheGet("hotel_rec", cards);
  let out = cached;
  if (out === null) {
    out = await aivana.structured({ kind: "hotel_rec", system: HOTEL_REC_SYSTEM,
      messages: [{ role: "user", content: compact({ hotel_cards: cards }) }], schema: hotelRecSchema(ids), maxTokens: 500,
      mock: () => mockHotelRec(cards), validate });
    cachePut(key, out);
  }
  const text = [out.headline, out.reason, ...(out.tradeoffs || []).flatMap((t) => [t.upside, t.downside]), ...(out.confirm_with_hotel || [])].join(" ");
  return { ...out, ...webHotels.checkHotelText(text, cards), cached: cached !== null };
}
