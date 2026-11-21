// All trip math lives here: counting, costing, scheduling, rule checks, sorting.
//
// Design rule: code does the math, staff set the rules, Aivana explains.
// Nothing in this file is decided by the model or by an opinion-based score:
// every option is described by plain facts and checked against rules that
// staff edit in Settings. Covered by test/planner.test.js.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  round, money, g, toInt, toFloat, isNum, sum, sortBy, minBy, unique, cmpKeys,
  parseDT, addHours, addDays, dayStart, hoursBetween, daysBetween, hourOf, clockHours, hm,
  strftime, fmtT, fmtDate, fmtDayTime, today,
} from "./util.js";

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const DATA_FILES = ["schedule", "hotels", "restaurants", "bus_rates", "flight_fares", "roster", "settings"];
const OPTIONAL_FILES = ["benchmarks"];

// Rules that staff can rank. id -> label. Each gets a setting `priority_<id>`.
export const RULE_PRIORITY_LABELS = {
  depart_earliest: "Earliest departure", gameday_travel: "Max hours on the bus on game day",
  pregame_meal: "Pregame meal time", checkin: "Hotel check-in time", home_by: "Home by",
  per_diem_day_trip: "No per-diem cash on day trips", overnight_needed: "Overnight only when needed",
  flight_booking: "Buy flights early enough", lodging_rate: "Hotel rate limit",
};
export const PRIORITY_NAMES = { 3: "must-have", 2: "important", 1: "nice-to-have" };
export const DEFAULT_PRIORITY = 2;

// Settings staff may edit: key -> [min, max, group]
export const EDITABLE_SETTINGS = {
  // Team rules (set by coaching staff); options are checked against these
  rule_earliest_departure_hour: [0, 23.99, "rules"],
  rule_max_gameday_travel_hours: [0, 24, "rules"],
  driver_max_hours: [1, 24, "rules"], // safety limit: never broken; a second driver is added instead
  pregame_meal_hours_before: [0, 8, "rules"],
  arrival_buffer_hours: [0, 12, "rules"],
  rule_latest_checkin_hour: [12, 30, "rules"],
  rule_latest_return_hour: [12, 36, "rules"],
  require_bus_parking: [0, 1, "rules"],
  require_meeting_room: [0, 1, "rules"],
  // Example travel-policy values (not BGSU's current policy; staff confirm each with BGSU Travel Services)
  policy_overnight_min_miles: [0, 500, "policy"],
  policy_lodging_rate_limit: [0, 1000, "policy"],
  season_travel_budget: [0, 10000000, "policy"],
  season_overbudget_pct: [0, 50, "policy"], // season plan may go this far over budget, only to keep must-have rules
  policy_flight_booking_days: [0, 365, "policy"],
  policy_expense_report_days: [1, 365, "policy"],
  // Cost settings
  seats_per_bus: [10, 90, "costs"],
  players_per_room: [1, 4, "costs"],
  staff_per_room: [1, 4, "costs"],
  meal_allowance: [0, 200, "costs"],
  breakfast_allowance: [0, 200, "costs"],
  postgame_meal_cost: [0, 200, "costs"],
  hotel_tax_rate: [0, 0.5, "costs"],
  hotel_max_rate: [0, 2000, "costs"],
  second_driver_cost: [0, 5000, "costs"],
  // Planning assumptions (not in the data pack; visible and editable so nothing is hidden)
  game_length_hours: [1, 6, "assumptions"],
  postgame_hours: [0, 6, "assumptions"],
  overnight_depart_hour: [0, 23.99, "assumptions"],
  post_stay_departure_hour: [0, 23.99, "assumptions"],
  local_bus_mph: [5, 70, "assumptions"],
  // Extras entered by staff (not in the data pack)
  extras_per_person_per_day: [0, 200, "extras"],
  extras_flat_per_trip: [0, 20000, "extras"],
  // Rule priorities (3 = must-have, 2 = important, 1 = nice-to-have); used to rank options
  ...Object.fromEntries(Object.keys(RULE_PRIORITY_LABELS).map((id) => [`priority_${id}`, [1, 3, "priorities"]])),
};
export const INT_SETTINGS = new Set(["seats_per_bus", "players_per_room", "staff_per_room",
  "require_bus_parking", "require_meeting_room", ...Object.keys(RULE_PRIORITY_LABELS).map((id) => `priority_${id}`)]);

export const DISCLAIMER =
  "Costs are estimates calculated from the data pack plus staff-entered extras, not live prices. " +
  "Team rules are set by staff. The recommendation is advisory; staff make the final decision.";

export const MEAL_SLOTS = { dinner_before: "dinner", breakfast: "breakfast", pregame: null, breakfast_after: "breakfast" };

// ---------------------------------------------------------------- data

export function loadData(dataDir = DATA_DIR) {
  const data = {};
  for (const name of DATA_FILES) data[name] = JSON.parse(readFileSync(join(dataDir, `${name}.json`), "utf8"));
  for (const name of OPTIONAL_FILES) {
    const p = join(dataDir, `${name}.json`);
    data[name] = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  }
  return data;
}

/** Travel benchmarks per fiscal year, plus an average row (all computed here). */
export function benchmarkRows(data) {
  const b = data.benchmarks;
  if (!b || !b.years || !b.years.length) return [];
  const rows = [];
  let prev = null;
  for (const y of b.years) {
    const perTrip = round(y.team_travel / y.away_trips, 2);
    rows.push({ key: y.fiscal_year, ...y, per_trip: perTrip,
      per_player_per_trip: round(perTrip / y.participants, 2),
      change_vs_prior: prev ? round((y.team_travel / prev - 1) * 100, 1) : null });
    prev = y.team_travel;
  }
  const n = rows.length;
  const avg = (k) => round(sum(rows.map((r) => r[k])) / n, 2);
  const trips = rows.map((r) => r.per_trip);
  rows.push({ key: "avg", fiscal_year: `${n}-year average`, season: "",
    team_travel: avg("team_travel"), away_trips: avg("away_trips"), participants: avg("participants"),
    per_trip: avg("per_trip"), per_player_per_trip: avg("per_player_per_trip"),
    change_vs_prior: null, schedule_note: "", schedule_source: "",
    spread_pct: round((Math.max(...trips) - Math.min(...trips)) / Math.min(...trips) * 100, 1) });
  return rows;
}

/** Apply staff overrides to known, bounded settings only. Returns [settings, errors]. */
export function mergeSettings(defaults, overrides) {
  const settings = { ...defaults };
  const errors = [];
  const ov = overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides : {};
  for (const [key, raw] of Object.entries(ov)) {
    if (!(key in EDITABLE_SETTINGS)) continue;
    if (raw === null || raw === "") {
      if (key === "hotel_max_rate") settings[key] = null;
      continue;
    }
    let value;
    try { value = toFloat(raw); } catch { errors.push(`Setting ${key} must be a number.`); continue; }
    const [lo, hi] = EDITABLE_SETTINGS[key];
    if (!(lo <= value && value <= hi)) { errors.push(`Setting ${key} must be between ${g(lo)} and ${g(hi)}.`); continue; }
    if (INT_SETTINGS.has(key)) value = Math.trunc(value);
    settings[key] = value;
  }
  return [settings, errors];
}

export const getGame = (data, id) => data.schedule.games.find((x) => x.game_id === id) || null;
export const homeName = (data) => data.schedule.home?.short ?? "home campus";
export const kickoffDT = (game) => parseDT(`${game.date}T${game.kickoff}`);
/** The group fare for a game. A fare names its opponent too, so an imported schedule that reuses an ID (G09)
 * for a different game never picks up another game's fare (Feature 8). */
export const findFare = (data, game) => data.flight_fares.fares.find((f) => f.game_id === game.game_id &&
  (!f.opponent || f.opponent === game.opponent)) || undefined;
export const activePlayerCount = (data) => data.roster.players.filter((p) => p.status === "active").length;

/** 7.5 -> '7:30 AM', 24 -> 'midnight', 26 -> '2:00 AM (next day)'. */
export function clock(hours) {
  if (Math.abs(hours - 24) < 1e-9) return "midnight";
  const nxt = hours >= 24;
  const h = ((hours % 24) + 24) % 24;
  let hh = Math.trunc(h), mm = Math.trunc(round((h - Math.trunc(h)) * 60));
  if (mm === 60) { hh += 1; mm = 0; }
  const s = strftime(Date.UTC(2000, 0, 1, hh % 24, mm), "%I:%M %p").replace(/^0+/, "");
  return s + (nxt ? " (next day)" : "");
}

/** Hours since midnight of baseDay (can exceed 24). */
const hoursOf = (t, baseDay) => hoursBetween(t, dayStart(baseDay));

// ---------------------------------------------------------------- request

/** Returns [cleanRequest, errors, warnings]. Errors block planning. */
export function validateRequest(req, data) {
  req = req && typeof req === "object" ? req : {};
  const errors = [], warnings = [], clean = {};

  const game = getGame(data, String(req.game_id || ""));
  if (!game) errors.push("Choose a game from the schedule.");
  else clean.game_id = game.game_id;

  const limits = { num_players: [1, 150], num_coaches: [0, 40], num_staff: [0, 40] };
  for (const [field, [lo, hi]] of Object.entries(limits)) {
    const raw = req[field];
    const label = field.replace("num_", "Number of ");
    let val;
    try {
      val = toInt(raw);
      if (toFloat(raw) !== val) throw new Error();
    } catch { errors.push(`${label} must be a whole number.`); continue; }
    if (!(lo <= val && val <= hi)) { errors.push(`${label} must be between ${lo} and ${hi}.`); continue; }
    clean[field] = val;
  }

  try {
    const budget = toFloat(req.budget);
    if (budget <= 0) throw new Error();
    clean.budget = round(budget, 2);
  } catch { errors.push("Budget must be a positive number."); }

  const dep = req.depart_after;
  if (dep) {
    try {
      const depDT = parseDT(dep);
      clean.depart_after = fmtT(depDT);
      if (game && depDT >= kickoffDT(game)) errors.push("Earliest departure must be before kickoff.");
    } catch { errors.push("Earliest departure must look like 2026-11-27T12:00."); }
  } else if (game) {
    clean.depart_after = fmtT(addHours(dayStart(addDays(kickoffDT(game), -2)), 8));
    warnings.push("No departure constraint given; assumed 8:00 AM two days before the game.");
  }

  if ("num_players" in clean && clean.num_players > activePlayerCount(data)) {
    warnings.push(`Request has ${clean.num_players} players but the roster lists ${activePlayerCount(data)} active players.`);
  }
  return [clean, errors, warnings];
}

// ---------------------------------------------------------------- pieces

export function counts(req, s) {
  const travelers = req.num_players + req.num_coaches + req.num_staff;
  const playerRooms = Math.ceil(req.num_players / s.players_per_room);
  const staffRooms = Math.ceil((req.num_coaches + req.num_staff) / s.staff_per_room);
  return { travelers, buses: Math.ceil(travelers / s.seats_per_bus),
    player_rooms: playerRooms, staff_rooms: staffRooms, rooms: playerRooms + staffRooms };
}

/** Per-bus round-trip cost from every vendor, cheapest first. */
export function busQuotes(data, miles, nights) {
  const out = data.bus_rates.vendors.map((v) => {
    const mileage = round(v.per_mile * miles * 2, 2);
    const base = Math.max(v.min_charge, mileage);
    return { vendor_id: v.vendor_id, vendor: v.name, per_mile: v.per_mile, round_trip_miles: miles * 2,
      mileage_cost: mileage, min_charge: v.min_charge, overnight_fees: round(v.driver_overnight_fee * nights, 2),
      per_bus: round(base + v.driver_overnight_fee * nights, 2) };
  });
  return sortBy(out, (q) => [q.per_bus]);
}

/** Driver hours: compare the longest driving stretch (driving between two rests) with the staff limit.
 * Over the limit -> a second driver on every bus (extra cost). Over 2x the limit -> not possible. */
export function driverCheck(stretches, s, buses) {
  const lim = Number(s.driver_max_hours ?? 10);
  const longest = round(Math.max(0, ...stretches), 2);
  const drivers = longest <= lim + 1e-9 ? 1 : 2;
  const ok = longest <= lim * 2 + 1e-9;
  const perBus = Number(s.second_driver_cost ?? 0);
  return { limit: lim, longest, drivers, ok, per_bus: perBus,
    extra_cost: drivers === 2 ? round(perBus * buses, 2) : 0 };
}

/** Apply the driver check to a bus package: cost, note, feasibility. */
function applyDrivers(pkg, stretches, s, c) {
  const d = driverCheck(stretches, s, c.buses);
  pkg.drivers = d;
  if (d.extra_cost) pkg.costs.transport = round(pkg.costs.transport + d.extra_cost, 2);
  if (!d.ok) {
    pkg.feasible = false;
    pkg.notes.push(`Not possible: ${g(d.longest)} hrs of driving in one stretch is more than two drivers can cover ` +
      `(limit ${g(d.limit)} hrs each)`);
  } else if (d.drivers === 2) {
    pkg.notes.push(`Needs a second driver: ${g(d.longest)} hrs of driving in one stretch, limit ${g(d.limit)} hrs ` +
      `($${money(d.extra_cost)} added)`);
  }
}

export const lodgingCost = (rooms, rate, nights, s) => round(rooms * rate * nights * (1 + s.hotel_tax_rate), 2);
export const parkingCost = (h, buses, nights) => round((h.bus_parking_fee_per_night ?? 0) * buses * nights, 2);

/** Every hotel in the city, with whether it meets the team's needs and what it would cost. */
export function hotelOptions(data, city, c, nights, s, extra = []) {
  const cap = s.hotel_max_rate ?? null;
  const n = Math.max(nights, 1);
  const out = [];
  for (const h of [...data.hotels.hotels, ...extra]) {
    if (h.city !== city) continue;
    const reasons = [];
    if (h.rooms_available < c.rooms) reasons.push(`only ${h.rooms_available} rooms free, team needs ${c.rooms}`);
    if (cap !== null && h.nightly_rate > cap) reasons.push(`above the $${g(cap)}/night cap`);
    if (s.require_bus_parking && !(h.bus_parking ?? true)) reasons.push("no bus parking (team rule)");
    if (s.require_meeting_room && !(h.meeting_room ?? true)) reasons.push("no meeting room (team rule)");
    out.push({ ...h, usable: !reasons.length, reason: reasons.join("; "),
      parking_cost: parkingCost(h, c.buses, n),
      lodging_cost: round(lodgingCost(c.rooms, h.nightly_rate, n, s) + parkingCost(h, c.buses, n), 2) });
  }
  return sortBy(out, (h) => [!h.usable, h.nightly_rate]);
}

export function restaurantOptions(data, city, mealType, travelers, s) {
  const allowance = mealType === "breakfast" ? s.breakfast_allowance : s.meal_allowance;
  const out = [];
  for (const r of data.restaurants.restaurants) {
    if (r.city !== city || !r.meal_types.includes(mealType)) continue;
    const fits = r.group_max >= travelers;
    out.push({ restaurant_id: r.restaurant_id, name: r.name, price_per_person: r.price_per_person,
      group_max: r.group_max, miles_to_stadium: r.miles_to_stadium, usable: fits,
      within_allowance: r.price_per_person <= allowance,
      reason: fits ? "" : `seats ${r.group_max}, team is ${travelers}`,
      cost: round(r.price_per_person * travelers, 2) });
  }
  return sortBy(out, (r) => [!r.usable, !r.within_allowance, r.price_per_person]);
}

/** Decide how a meal is covered and what it costs. Returns a meal line. */
export function priceMeal(data, city, mealType, when, travelers, s, hotel = null, slot = null, forcedId = null) {
  const base = { slot, meal: mealType, time: fmtT(when) };
  const allowance = mealType === "breakfast" ? s.breakfast_allowance : s.meal_allowance;
  if (mealType === "postgame") {
    const pp = s.postgame_meal_cost;
    return { ...base, where: "Boxed postgame meal", per_person: pp, cost: round(pp * travelers, 2), chosen_by: "rule" };
  }
  if (forcedId) {
    const r = data.restaurants.restaurants.find((x) => x.restaurant_id === forcedId);
    if (r && r.city === city && r.meal_types.includes(mealType) && r.group_max >= travelers) {
      const line = { ...base, where: r.name, restaurant_id: r.restaurant_id, per_person: r.price_per_person,
        cost: round(r.price_per_person * travelers, 2), chosen_by: "staff" };
      if (r.price_per_person > allowance) line.note = `${r.name} is over the $${g(allowance)} ${mealType} allowance (staff choice)`;
      return line;
    }
  }
  if (mealType === "breakfast" && hotel && hotel.breakfast_included && (forcedId == null || forcedId === "hotel")) {
    return { ...base, where: `${hotel.name} (breakfast included)`, per_person: 0, cost: 0, chosen_by: "rule" };
  }
  const usable = restaurantOptions(data, city, mealType, travelers, s).filter((r) => r.usable);
  if (usable.length) {
    const r = usable[0];
    const line = { ...base, where: r.name, restaurant_id: r.restaurant_id, per_person: r.price_per_person,
      cost: r.cost, chosen_by: "rule" };
    if (!r.within_allowance) line.note = `No ${mealType} option within the $${g(allowance)} allowance; cheapest that fits used`;
    return line;
  }
  return { ...base, where: "Per-diem cash (no restaurant in the data pack seats the group)", per_person: allowance,
    cost: round(allowance * travelers, 2), chosen_by: "rule", note: `No ${mealType} restaurant seats ${travelers}; per-diem used` };
}

// ---------------------------------------------------------------- rule checks

const startsWithAny = (s, prefixes) => prefixes.some((p) => s.startsWith(p));

/** Example travel-policy checks. The values are staff-editable examples, not BGSU's current policy;
 * staff confirm each with BGSU Travel Services. Pure comparisons in code. */
export function checkPolicy(pkg, dayTrip, game, s) {
  const out = [];
  const perDiem = pkg.meals.filter((m) => String(m.where ?? "").startsWith("Per-diem"));
  const team = pkg.meals.filter((m) => !perDiem.includes(m));
  out.push({ id: "per_diem_team_meals", rule: "Per diem only for meals not provided as team meals", ok: true,
    actual: `${team.length} team meals, ${perDiem.length} per-diem` });
  if (pkg.nights === 0) {
    out.push({ id: "per_diem_day_trip", rule: "Same-day trip: no per-diem meal cash", ok: !perDiem.length, actual: `${perDiem.length} per-diem meal(s)` });
  } else {
    const lim = s.policy_overnight_min_miles;
    let timingNeedsIt = true;
    if (dayTrip && dayTrip.feasible) {
      timingNeedsIt = dayTrip.rule_checks.some((r) => startsWithAny(r.rule, ["Depart no earlier", "Home by"]) && !r.ok);
    }
    const far = game.miles > lim;
    out.push({ id: "overnight_needed", rule: `Overnight only if over ${g(lim)} miles and same-day timing doesn't work`, ok: far && timingNeedsIt,
      actual: `${game.miles} mi; same-day trip ` + (timingNeedsIt ? "breaks the departure/home-by rules" : "fits the time rules") });
    if (pkg.mode === "flight") {
      const need = Math.trunc(s.policy_flight_booking_days ?? 30);
      const left = daysBetween(parseDT(pkg.facts.departure), today());
      out.push({ id: "flight_booking", rule: `Flights bought ${need}+ days before travel`, ok: left >= need, actual: `${left} days until departure` });
    }
    const rateLim = s.policy_lodging_rate_limit;
    const rate = pkg.hotel.nightly_rate;
    out.push({ id: "lodging_rate", rule: `Hotel at or under $${g(rateLim)}/night (above needs prior approval)`, ok: rate <= rateLim,
      actual: `$${g(rate)}/night` });
  }
  return withPriority(out, s);
}

/** Staff-set level of one rule: 3 = must-have, 2 = important, 1 = nice-to-have. */
export function rulePriority(id, s) {
  const v = s[`priority_${id}`];
  return v === 1 || v === 2 || v === 3 ? v : DEFAULT_PRIORITY;
}
const withPriority = (checks, s) => checks.map((c) => ({ ...c, priority: rulePriority(c.id, s) }));

/** Broken rules (team + policy) counted by level. */
export function brokenByPriority(pkg) {
  const out = { must: 0, important: 0, nice: 0 };
  for (const c of [...(pkg.rule_checks || []), ...(pkg.policy_checks || [])]) {
    if (!c.ok) out[c.priority === 3 ? "must" : c.priority === 1 ? "nice" : "important"] += 1;
  }
  return out;
}

/** Short text like "1 must-have, 2 important rule(s)"; "" when nothing is broken. */
export function brokenText(b) {
  const parts = [[b.must, "must-have"], [b.important, "important"], [b.nice, "nice-to-have"]]
    .filter(([n]) => n).map(([n, w]) => `${n} ${w}`);
  return parts.length ? `${parts.join(", ")} rule(s)` : "";
}

/** Compare an option's facts with the staff's rules. Pure comparisons, no judgment. */
export function checkRules(pkg, kickoff, s) {
  const f = pkg.facts;
  const dep = parseDT(f.departure);
  const ret = parseDT(f.return_time);
  const checks = [];

  let lim = s.rule_earliest_departure_hour;
  const deps = [dep, ...(f.stay_after ? [parseDT(f.return_departure)] : [])];
  checks.push({ id: "depart_earliest", rule: `Depart no earlier than ${clock(lim)}`, ok: deps.every((d) => clockHours(d) >= lim - 1e-9),
    actual: deps.map(fmtDayTime).join(" / ") });

  lim = s.rule_max_gameday_travel_hours;
  checks.push({ id: "gameday_travel", rule: `Game-day travel ${g(lim)} hrs or less`, ok: f.gameday_travel_hours <= lim + 1e-9,
    actual: `${g(f.gameday_travel_hours)} hrs` });

  lim = s.pregame_meal_hours_before;
  checks.push({ id: "pregame_meal", rule: `Pregame meal ${g(lim)} hrs before kickoff`, ok: f.pregame_meal_gap_hours >= lim - 1e-9,
    actual: `${g(f.pregame_meal_gap_hours)} hrs before` });

  if (f.hotel_checkin) {
    const ci = parseDT(f.hotel_checkin);
    lim = s.rule_latest_checkin_hour;
    checks.push({ id: "checkin", rule: `Hotel check-in by ${clock(lim)}`, ok: hoursOf(ci, addDays(kickoff, -1)) <= lim + 1e-9,
      actual: fmtDayTime(ci) });
  }

  // "Home by" is measured from the day the trip home starts, so a team that stays over
  // after a night game and drives home next morning is judged on that day.
  lim = s.rule_latest_return_hour;
  const retDay = f.stay_after ? parseDT(f.return_departure) : kickoff;
  checks.push({ id: "home_by", rule: `Home by ${clock(lim)} (on the day you travel home)`, ok: hoursOf(ret, retDay) <= lim + 1e-9,
    actual: fmtDayTime(ret) });
  return withPriority(checks, s);
}

// ---------------------------------------------------------------- packages

function finish(pkg, req, s, kickoff, c) {
  const days = pkg.nights + 1;
  const costs = pkg.costs;
  costs.meals = round(sum(pkg.meals.map((m) => m.cost)), 2);
  costs.extras = round(s.extras_per_person_per_day * c.travelers * days + s.extras_flat_per_trip, 2);
  pkg.extras_detail = { per_person_per_day: s.extras_per_person_per_day, travelers: c.travelers, days,
    flat: s.extras_flat_per_trip };
  costs.total = round(costs.transport + costs.lodging + costs.meals + costs.extras, 2);
  pkg.budget_gap = round(req.budget - costs.total, 2); // positive = under budget
  pkg.within_budget = pkg.budget_gap >= 0;

  pkg.rule_checks = checkRules(pkg, kickoff, s);
  pkg.rules_broken = pkg.rule_checks.filter((r) => !r.ok).length;
  const notes = pkg.notes || [];
  if (!pkg.within_budget) notes.push(`Over budget by $${money(-pkg.budget_gap)}`);
  for (const m of pkg.meals) if (m.note) notes.push(m.note);
  pkg.notes = unique(notes);
  // One list for the memo and the AI: broken rules first, then cost/data notes
  pkg.flags = [...pkg.rule_checks.filter((r) => !r.ok).map((r) =>
    `Breaks team rule (${PRIORITY_NAMES[r.priority]}): ${r.rule} (actual ${r.actual})`),
    ...pkg.notes];
  pkg.timeline = sortBy(pkg.timeline, (e) => [e.time]);
  return pkg;
}

/** Adds kickoff and the trip home to the timeline. Returns [endGame, departHome, home]. */
function gameEnd(pkg, kickoff, game, travelHomeH, s, modeLabel, stayAfter = false, hotelName = null, homeLabel = "campus") {
  const endGame = addHours(kickoff, s.game_length_hours);
  pkg.timeline.push({ time: fmtT(kickoff), label: `Kickoff vs ${game.opponent} at ${game.stadium}` },
    { time: fmtT(endGame), label: "Game ends (estimated)" });
  let departHome;
  if (stayAfter) {
    const back = addHours(endGame, s.postgame_hours);
    pkg.timeline.push({ time: fmtT(back), label: `Bus back to ${hotelName}; second night` });
    departHome = addHours(dayStart(addDays(kickoff, 1)), s.post_stay_departure_hour);
    departHome = Math.max(departHome, addHours(back, 8)); // at least 8 hrs at the hotel
  } else {
    departHome = addHours(endGame, s.postgame_hours);
  }
  const home = addHours(departHome, travelHomeH);
  pkg.timeline.push({ time: fmtT(departHome), label: `Depart for home by ${modeLabel}` },
    { time: fmtT(home), label: `Arrive at ${homeLabel} (estimated)` });
  return [endGame, departHome, home];
}

const busLabel = (data, c, bus) =>
  `Depart ${homeName(data)} by charter bus (${c.buses} bus${c.buses !== 1 ? "es" : ""}, ${bus.vendor})`;

export function buildDayTrip(req, data, s, game, c, mealChoice = null) {
  mealChoice = mealChoice || {};
  const kickoff = kickoffDT(game);
  const departAfter = parseDT(req.depart_after);
  const depart = addHours(kickoff, -(s.arrival_buffer_hours + game.drive_hours));
  const arrive = addHours(depart, game.drive_hours);
  const quotes = busQuotes(data, game.miles, 0);
  const bus = quotes[0];
  const pkg = { option_id: "A", name: "Bus day trip", mode: "bus", nights: 0, hotel: null,
    bus: { ...bus, count: c.buses }, bus_quotes: quotes, timeline: [], meals: [],
    costs: { transport: round(bus.per_bus * c.buses, 2), lodging: 0 }, feasible: true, notes: [] };
  if (depart < departAfter) {
    pkg.feasible = false;
    pkg.notes.push("Not possible: the bus would have to leave before the earliest allowed time");
  }
  pkg.notes.push("Breakfast before departure is not budgeted");
  pkg.timeline.push({ time: fmtT(depart), label: busLabel(data, c, bus) },
    { time: fmtT(arrive), label: `Arrive in ${game.city}` });
  const mealT = Math.max(addHours(kickoff, -s.pregame_meal_hours_before), arrive);
  const hr = hourOf(mealT);
  const preType = hr >= 10 && hr < 16 ? "lunch" : (hr < 10 ? "breakfast" : "dinner");
  const pre = priceMeal(data, game.city, preType, mealT, c.travelers, s, null, "pregame", mealChoice.pregame);
  pre.label = "Pregame meal";
  pkg.meals.push(pre);
  pkg.timeline.push({ time: pre.time, label: `Pregame meal at ${pre.where}` });
  const [endGame, departHome, home] = gameEnd(pkg, kickoff, game, game.drive_hours, s, "bus", false, null, homeName(data));
  const post = priceMeal(data, game.city, "postgame", addHours(endGame, 1), c.travelers, s, null, "postgame");
  post.label = "Postgame meal";
  pkg.meals.push(post);
  pkg.timeline.push({ time: post.time, label: "Postgame boxed meal" });
  applyDrivers(pkg, [game.drive_hours * 2], s, c);
  pkg.facts = {
    night_before: false, departure: fmtT(depart), arrive_destination: fmtT(arrive),
    arrive_before_kickoff_hours: round(hoursBetween(kickoff, arrive), 2),
    gameday_travel_hours: game.drive_hours, total_travel_hours: round(game.drive_hours * 2, 2),
    pregame_meal_gap_hours: round(hoursBetween(kickoff, mealT), 2),
    hotel_checkin: null, return_departure: fmtT(departHome), return_time: fmtT(home), stay_after: false,
  };
  return finish(pkg, req, s, kickoff, c);
}

const HOTEL_KEYS = ["hotel_id", "name", "nightly_rate", "miles_to_stadium", "breakfast_included", "rooms_available",
  "bus_parking", "bus_parking_fee_per_night", "meeting_room", "late_checkout", "source", "source_url"];

export function buildOvernight(req, data, s, game, c, hotel, optionId, name,
  { mode = "bus", mealChoice = null, stayAfter = false } = {}) {
  mealChoice = mealChoice || {};
  const kickoff = kickoffDT(game);
  const departAfter = parseDT(req.depart_after);
  const dayBefore = dayStart(addDays(kickoff, -1));
  const preferred = addHours(dayBefore, s.overnight_depart_hour);
  const depart = Math.max(departAfter, preferred);
  const nights = stayAfter ? 2 : 1;
  const pkg = { option_id: optionId, name, mode, nights,
    hotel: Object.fromEntries(HOTEL_KEYS.map((k) => [k, hotel[k] ?? null])),
    timeline: [], meals: [], feasible: true, notes: [] };
  const toStadiumH = round(hotel.miles_to_stadium / s.local_bus_mph, 2);

  let transport, arrive, travelHomeH, modeLabel;
  if (mode === "bus") {
    const quotes = busQuotes(data, game.miles, nights);
    const bus = quotes[0];
    pkg.bus = { ...bus, count: c.buses };
    pkg.bus_quotes = quotes;
    transport = round(bus.per_bus * c.buses, 2);
    arrive = addHours(depart, game.drive_hours);
    travelHomeH = game.drive_hours;
    pkg.timeline.push({ time: fmtT(depart), label: busLabel(data, c, bus) });
    modeLabel = "bus";
  } else {
    const fare = findFare(data, game);
    const localBus = fare.local_bus_per_day * (nights + 1) * c.buses;
    transport = round(fare.fare_per_seat * c.travelers + localBus, 2);
    pkg.flight = { carrier: fare.carrier, fare_per_seat: fare.fare_per_seat, flight_hours: fare.flight_hours,
      local_bus_cost: localBus };
    const doorH = fare.airport_buffer_hours + fare.flight_hours + fare.transfer_hours;
    arrive = addHours(depart, doorH);
    travelHomeH = doorH;
    pkg.timeline.push({ time: fmtT(depart), label: `Depart ${homeName(data)} for airport; flight with ${fare.carrier}` });
    modeLabel = "flight";
  }

  const park = mode === "bus" ? parkingCost(hotel, c.buses, nights) : 0;
  pkg.costs = { transport, lodging: round(lodgingCost(c.rooms, hotel.nightly_rate, nights, s) + park, 2) };
  pkg.lodging_detail = { rooms: c.rooms, player_rooms: c.player_rooms, staff_rooms: c.staff_rooms,
    nightly_rate: hotel.nightly_rate, nights, tax_rate: s.hotel_tax_rate, bus_parking_cost: park };
  pkg.timeline.push({ time: fmtT(arrive), label: `Check in at ${hotel.name}` });
  if (arrive >= addHours(kickoff, -s.arrival_buffer_hours)) {
    pkg.feasible = false;
    pkg.notes.push("Not possible: cannot reach the hotel before the game with this departure time");
  }

  const dinnerT = Math.max(addHours(arrive, 1), addHours(dayBefore, 18));
  const dinner = priceMeal(data, game.city, "dinner", dinnerT, c.travelers, s, hotel, "dinner_before", mealChoice.dinner_before);
  dinner.label = "Team dinner (night before)";
  pkg.meals.push(dinner);
  pkg.timeline.push({ time: dinner.time, label: `Team dinner at ${dinner.where}` });

  const preT = addHours(kickoff, -s.pregame_meal_hours_before);
  const bfastT = addHours(dayStart(kickoff), 8);
  if (hoursBetween(preT, bfastT) >= 2) {
    const b = priceMeal(data, game.city, "breakfast", bfastT, c.travelers, s, hotel, "breakfast", mealChoice.breakfast);
    b.label = "Breakfast";
    pkg.meals.push(b);
    pkg.timeline.push({ time: b.time, label: `Breakfast: ${b.where}` });
  }
  const ph = hourOf(preT);
  const preType = ph < 10 ? "breakfast" : (ph < 16 ? "lunch" : "dinner");
  const pre = priceMeal(data, game.city, preType, preT, c.travelers, s, hotel, "pregame", mealChoice.pregame);
  pre.label = "Pregame meal";
  pkg.meals.push(pre);
  pkg.timeline.push({ time: pre.time, label: `Pregame meal at ${pre.where}` });
  const leaveHotel = addHours(addHours(kickoff, -s.arrival_buffer_hours), -toStadiumH);
  pkg.timeline.push({ time: fmtT(leaveHotel), label: stayAfter ? "Bus to stadium" : "Check out; bus to stadium" });

  const [endGame, departHome, home] = gameEnd(pkg, kickoff, game, travelHomeH, s, modeLabel, stayAfter, hotel.name,
    homeName(data));
  const post = priceMeal(data, game.city, "postgame", addHours(endGame, 1), c.travelers, s, null, "postgame");
  post.label = "Postgame meal";
  pkg.meals.push(post);
  pkg.timeline.push({ time: post.time, label: "Postgame boxed meal" });
  if (stayAfter) {
    const b2 = priceMeal(data, game.city, "breakfast", addHours(departHome, -1), c.travelers, s, hotel, "breakfast_after",
      mealChoice.breakfast_after);
    b2.label = "Breakfast (morning after)";
    pkg.meals.push(b2);
    pkg.timeline.push({ time: b2.time, label: `Breakfast: ${b2.where}; check out` });
    if (travelHomeH >= 3) {
      const roadT = addHours(departHome, round(travelHomeH / 2));
      const pp = s.meal_allowance;
      pkg.meals.push({ slot: "road", meal: "lunch", time: fmtT(roadT), label: "Meal on the way home",
        where: "Per-diem (meal allowance)", per_person: pp, cost: round(pp * c.travelers, 2), chosen_by: "rule" });
      pkg.timeline.push({ time: fmtT(roadT), label: "Meal stop on the way home (per-diem)" });
    }
  }

  if (mode === "bus") {
    applyDrivers(pkg, stayAfter ? [game.drive_hours, toStadiumH * 2, game.drive_hours]
      : [game.drive_hours, toStadiumH + game.drive_hours], s, c);
  }
  pkg.facts = {
    night_before: pkg.feasible, departure: fmtT(depart), arrive_destination: fmtT(arrive),
    arrive_before_kickoff_hours: round(hoursBetween(kickoff, arrive), 2),
    gameday_travel_hours: toStadiumH, total_travel_hours: round(travelHomeH * 2 + toStadiumH * 2, 2),
    pregame_meal_gap_hours: s.pregame_meal_hours_before,
    hotel_checkin: fmtT(arrive), return_departure: fmtT(departHome), return_time: fmtT(home), stay_after: stayAfter,
  };
  return finish(pkg, req, s, kickoff, c);
}

/** A web hotel that staff confirmed (Feature 7). Every number here was typed or checked by staff;
 * the web only supplied the name, address and source link. Returns [clean, errors]. */
export function cleanWebHotel(w, game) {
  const errors = [];
  if (!w || typeof w !== "object") return [null, ["The web hotel is missing."]];
  if (w.confirmed_by_staff !== true) errors.push("Tick 'I confirmed this rate with the hotel' before using a web hotel.");
  const id = String(w.hotel_id || "");
  if (!/^W\d{1,2}$/.test(id)) errors.push("The web hotel ID must look like W1.");
  const name = String(w.name || "").trim().slice(0, 120);
  if (!name) errors.push("The web hotel needs a name.");
  const numIn = (v, lo, hi, what, int = false) => {
    const x = Number(v);
    if (v === null || v === undefined || v === "" || !Number.isFinite(x) || x < lo || x > hi || (int && !Number.isInteger(x))) {
      errors.push(`${what} must be ${int ? "a whole number " : ""}between ${lo} and ${hi}.`); return null;
    }
    return round(x, 2);
  };
  const yn = (v, what) => { if (v === true || v === false) return v; errors.push(`Choose yes or no for ${what}.`); return null; };
  const url = String(w.source_url || "");
  if (url && !/^https:\/\//.test(url)) errors.push("The source link must start with https://.");
  const clean = { hotel_id: id, city: game.city, name, address: String(w.address || "").slice(0, 200),
    nightly_rate: numIn(w.nightly_rate, 40, 1000, "Nightly rate"),
    rooms_available: numIn(w.rooms_available, 1, 500, "Rooms available", true),
    miles_to_stadium: numIn(w.miles_to_stadium, 0, 100, "Miles to the stadium"),
    bus_parking: yn(w.bus_parking, "bus parking"), meeting_room: yn(w.meeting_room, "meeting room"),
    bus_parking_fee_per_night: 0, breakfast_included: false, late_checkout: false,
    source: "web", source_url: url, confirmed_by_staff: true };
  return [errors.length ? null : clean, errors];
}
const webExtra = (custom) => (custom && custom.web_hotel ? [custom.web_hotel] : []);

/** Check a staff choice of hotel / restaurants against the data pack. Returns [clean, errors]. */
export function validateCustom(custom, req, data, s) {
  if (!custom || typeof custom !== "object" || !custom.option_id) return [null, []];
  const game = getGame(data, req.game_id);
  const c = counts(req, s);
  const errors = [];
  const clean = { option_id: String(custom.option_id), meals: {} };
  let extra = [];
  if (custom.web_hotel) {
    const [wh, wErrors] = cleanWebHotel(custom.web_hotel, game);
    if (wErrors.length) errors.push(...wErrors);
    else { clean.web_hotel = wh; extra = [wh]; }
  }
  const hid = custom.hotel_id;
  const webFailed = custom.web_hotel && !clean.web_hotel;   // its own errors already explain why
  if (hid && !(webFailed && String(hid) === String(custom.web_hotel.hotel_id))) {
    const h = hotelOptions(data, game.city, c, 1, s, extra).find((x) => x.hotel_id === hid);
    if (!h) errors.push("That hotel is not in this city's data.");
    else if (!h.usable) errors.push(`${h.name} can't be used: ${h.reason}.`);
    else clean.hotel_id = hid;
  }
  const meals = custom.meals && typeof custom.meals === "object" ? custom.meals : {};
  for (const [slot, rid] of Object.entries(meals)) {
    if (!(slot in MEAL_SLOTS) || !rid) continue;
    if (rid === "hotel") { clean.meals[slot] = "hotel"; continue; }
    const r = data.restaurants.restaurants.find((x) => x.restaurant_id === rid);
    if (!r || r.city !== game.city) errors.push(`Restaurant ${rid} is not in this city's data.`);
    else if (r.group_max < c.travelers) errors.push(`${r.name} seats ${r.group_max}; the team is ${c.travelers}.`);
    else clean.meals[slot] = rid;
  }
  return [clean, errors];
}

/** Build comparable options, check them against team rules, label the picks. */
export function buildPackages(req, data, s, custom = null) {
  const game = getGame(data, req.game_id);
  const c = counts(req, s);
  custom = custom || {};
  const cid = custom.option_id;
  const mealsFor = (oid) => (cid === oid ? custom.meals : null);

  let packages = [buildDayTrip(req, data, s, game, c, mealsFor("A"))];
  const notes = [];
  const withinRadius = game.miles <= s.policy_overnight_min_miles;
  const hotels = withinRadius ? [] : hotelOptions(data, game.city, c, 1, s, webExtra(custom)).filter((h) => h.usable);
  if (withinRadius) {
    notes.push(`${game.opponent} is ${game.miles} miles from BGSU, within ${g(s.policy_overnight_min_miles)} miles. ` +
      "The example travel-policy value (confirm with BGSU Travel Services) allows overnight stays only over that distance, so only the day trip is offered.");
  } else if (!hotels.length) {
    notes.push(`No hotel in ${game.city} has ${c.rooms} rooms` +
      (s.hotel_max_rate ? ` at or under $${g(s.hotel_max_rate)}/night` : "") + "; overnight options are unavailable.");
  } else {
    const byId = Object.fromEntries(hotels.map((h) => [h.hotel_id, h]));
    const value = minBy(hotels, (h) => [h.nightly_rate, h.miles_to_stadium]);
    const close = minBy(hotels, (h) => [h.miles_to_stadium, h.nightly_rate]);
    const hotelFor = (oid, def) => {
      if (cid === oid && custom.hotel_id in byId) {
        const h = byId[custom.hotel_id];
        return [h, h.hotel_id !== def.hotel_id];
      }
      return [def, false];
    };

    let [h, picked] = hotelFor("B", value);
    packages.push(buildOvernight(req, data, s, game, c, h, "B",
      `Bus + overnight at ${h.name}` + (picked ? " (staff choice)" : " (lowest rate)"), { mealChoice: mealsFor("B") }));
    if (close.hotel_id !== value.hotel_id || cid === "C") {
      [h, picked] = hotelFor("C", close);
      packages.push(buildOvernight(req, data, s, game, c, h, "C",
        `Bus + overnight at ${h.name}` + (picked ? " (staff choice)" : " (closest)"), { mealChoice: mealsFor("C") }));
    }
    // Night games: if a same-day return breaks the "home by" rule, offer staying a second night.
    const late = packages.filter((p) => p.feasible && p.mode === "bus" &&
      p.rule_checks.some((r) => !r.ok && r.rule.startsWith("Home by")));
    if (late.length || cid === "E") {
      [h] = hotelFor("E", value);
      packages.push(buildOvernight(req, data, s, game, c, h, "E", `Bus + 2 nights at ${h.name} (stay after the game)`,
        { mealChoice: mealsFor("E"), stayAfter: true }));
    }
    const fare = findFare(data, game);
    if (game.miles >= s.flight_min_miles && fare) {
      [h] = hotelFor("D", value);
      packages.push(buildOvernight(req, data, s, game, c, h, "D", `Flight (group fare) + overnight at ${h.name}`,
        { mode: "flight", mealChoice: mealsFor("D") }));
    } else if (game.miles >= s.flight_min_miles) {
      notes.push("Trip is long enough for a flight, but the data pack has no fare for this game.");
    }
  }

  packages = sortBy(packages, (p) => [p.option_id]);
  const day = packages.find((p) => p.option_id === "A") || null;
  for (const p of packages) {
    p.policy_checks = checkPolicy(p, day, game, s);
    p.policy_issues = p.policy_checks.filter((x) => !x.ok).length;
    p.flags = [...p.flags, ...p.policy_checks.filter((x) => !x.ok).map((x) =>
      `Example policy (${PRIORITY_NAMES[x.priority]}): ${x.rule} (actual ${x.actual})`)];
    p.broken_by_priority = brokenByPriority(p);
    if (p.hotel && p.hotel.source === "web") {
      p.notes = [...p.notes, `${p.hotel.name}: rate confirmed by staff with the hotel (found on the web, not in the data pack).`];
    }
  }
  const feasible = packages.filter((p) => p.feasible);
  const within = feasible.filter((p) => p.within_budget);
  // Fewest must-have broken, then important, then nice-to-have, then cheapest.
  // With every rule at the default level this equals [rules broken, cost].
  const rank = (p) => { const b = p.broken_by_priority; return [b.must, b.important, b.nice, p.costs.total]; };
  const bestBudget = within.length ? minBy(within, rank) : null;
  const bestRules = feasible.length ? minBy(feasible, rank) : null;
  for (const p of packages) {
    p.labels = [];
    if (bestBudget === p) p.labels.push("best_within_budget");
    if (bestRules === p) p.labels.push("best_fit_rules");
  }
  if (!within.length) {
    notes.push("No option fits the budget. Try a what-if: fewer travelers, more people per room, " +
      "a hotel rate cap, or a higher budget.");
  } else if (bestBudget !== bestRules && bestRules !== null) {
    const why = brokenText(bestBudget.broken_by_priority);
    notes.push(`Tradeoff: option ${bestBudget.option_id} fits the budget but breaks ${why || "more rules"}; ` +
      `option ${bestRules.option_id} fits the rule priorities better but costs more.`);
  }

  return { game, counts: c, budget: req.budget, packages,
    settings_used: Object.fromEntries(Object.keys(EDITABLE_SETTINGS).map((k) => [k, s[k] ?? null])),
    home: homeName(data),
    best_within_budget: bestBudget ? bestBudget.option_id : null,
    best_fit_rules: bestRules ? bestRules.option_id : null,
    notes, disclaimer: DISCLAIMER };
}

/** Hotel and restaurant lists for the staff picker of one option. */
export function choicesFor(plan, optionId, data, s) {
  const pkg = plan.packages.find((p) => p.option_id === optionId);
  const { game, counts: c } = plan;
  const out = { hotels: pkg.nights ? hotelOptions(data, game.city, c, pkg.nights, s, webExtra(plan.custom)) : [], meals: [] };
  for (const m of pkg.meals) {
    if (!(m.slot in MEAL_SLOTS)) continue;
    let opts = restaurantOptions(data, game.city, m.meal, c.travelers, s);
    if ((m.slot === "breakfast" || m.slot === "breakfast_after") && pkg.hotel && pkg.hotel.breakfast_included) {
      opts = [{ restaurant_id: "hotel", name: `${pkg.hotel.name} (included)`, price_per_person: 0, usable: true,
        within_allowance: true, reason: "", cost: 0, group_max: null, miles_to_stadium: pkg.hotel.miles_to_stadium },
      ...opts];
    }
    out.meals.push({ slot: m.slot, label: m.label, meal: m.meal, time: m.time,
      current: m.restaurant_id || (m.cost === 0 ? "hotel" : null), options: opts });
  }
  return out;
}

// ---------------------------------------------------------------- season overview

/** Every away game: is an overnight justified, which hotels fit, estimated cost, and a per-game
 * budget split from the season travel budget in proportion to each trip's estimated cost. All code. */
export function seasonOverview(data, s, party = null) {
  party = party || { num_players: 22, num_coaches: 4, num_staff: 3 };
  const lim = s.policy_overnight_min_miles;
  const rows = [], seasonGames = [], plans = [];
  for (const gm of data.schedule.games) {
    const kick = kickoffDT(gm);
    const req = { ...party, game_id: gm.game_id, budget: 10_000_000,
      depart_after: fmtT(addHours(dayStart(addDays(kick, -2)), 8)) };
    const plan = buildPackages(req, data, s);
    const byId = Object.fromEntries(plan.packages.map((p) => [p.option_id, p]));
    const day = byId.A;
    const dayFits = Boolean(day && day.feasible && !day.rule_checks.some(
      (r) => startsWithAny(r.rule, ["Depart no earlier", "Home by"]) && !r.ok));
    let verdict, kind;
    if (gm.miles <= lim) [verdict, kind] = [`Day trip: within ${g(lim)} miles, no hotel`, "day"];
    else if (dayFits) [verdict, kind] = ["Day trip fits the time rules; an overnight would need justification", "day"];
    else [verdict, kind] = ["Overnight recommended: a same-day trip breaks the departure / home-by rules", "overnight"];
    const best = plan.best_fit_rules ? byId[plan.best_fit_rules] : null;
    seasonGames.push({ game_id: gm.game_id, opponent: gm.opponent, single_pick: plan.best_fit_rules,
      options: plan.packages.filter((p) => p.feasible).map((p) => ({ option_id: p.option_id, name: p.name,
        cost: p.costs.total, broken: p.broken_by_priority })) });
    plans.push(plan);
    const c = plan.counts;
    const hotels = [];
    let excluded = [];
    if (gm.miles > lim) {
      const all = hotelOptions(data, gm.city, c, 1, s);
      const usable = all.filter((h) => h.usable);
      const picks = [];
      if (usable.length) {
        const value = minBy(usable, (h) => [h.lodging_cost, h.miles_to_stadium]);
        const close = minBy(usable, (h) => [h.miles_to_stadium, h.lodging_cost]);
        picks.push(["Best value", value]);
        if (close !== value) picks.push(["Closest", close]);
      }
      for (const [label, h] of picks) {
        hotels.push({ label, hotel_id: h.hotel_id, name: h.name, nightly_rate: h.nightly_rate,
          miles_to_stadium: h.miles_to_stadium, breakfast_included: h.breakfast_included,
          bus_parking: h.bus_parking ?? null, bus_parking_fee_per_night: h.bus_parking_fee_per_night ?? 0,
          meeting_room: h.meeting_room ?? null, lodging_cost_1_night: h.lodging_cost,
          within_rate_limit: h.nightly_rate <= s.policy_lodging_rate_limit });
      }
      excluded = all.filter((h) => !h.usable).map((h) => ({ name: h.name, reason: h.reason }));
    }
    rows.push({ game_id: gm.game_id, opponent: gm.opponent, city: gm.city, date: gm.date, kickoff: gm.kickoff,
      miles: gm.miles, verdict, kind,
      recommended_option: best ? best.option_id : null, recommended_name: best ? best.name : null,
      estimated_cost: best ? best.costs.total : null, rules_broken: best ? best.rules_broken : null,
      policy_issues: best ? best.policy_issues : null, hotels, hotels_excluded: excluded });
  }
  const totalEst = sum(rows.map((r) => r.estimated_cost || 0));
  const season = Number(s.season_travel_budget || 0);
  const bench = benchmarkRows(data).map((x) => ({ ...x,
    season_budget_for_party: round(x.per_player_per_trip * party.num_players * rows.length, 2),
    our_avg_per_player_per_trip: rows.length ? round(totalEst / rows.length / party.num_players, 2) : 0 }));
  const optimizer = optimizeSeason(seasonGames, season, Number(s.season_overbudget_pct ?? 0));
  const picked = Object.fromEntries((optimizer.plan?.picks || []).map((p) => [p.game_id, p]));
  for (const r of rows) {
    const p = picked[r.game_id] || null;
    r.season_pick = p;
    // Per-game budget = the cost of the season plan's pick for this game
    r.allocated_budget = p ? p.cost : 0;
    r.budget_share = season ? round(r.allocated_budget / season, 4) : 0;
  }
  const out = { party, season_budget: season, total_estimated: round(totalEst, 2), benchmarks: bench,
    benchmark_source: data.benchmarks?.source ?? null, benchmark_notes: data.benchmarks?.definition_notes ?? [],
    season_gap: round(season - totalEst, 2), games: rows, optimizer,
    season_reserve: optimizer.plan ? round(season - optimizer.plan.total, 2) : season,
    method: "Season plan: the code tries every combination of one option per game and keeps the one that " +
      "breaks the fewest must-have rules, then stays under the season budget, then breaks the fewest " +
      "important and nice-to-have rules, then costs the least. It may go over budget by the staff-set " +
      "allowance, but only to keep must-have rules. Per-game budget = the cost of that game's pick." };
  Object.defineProperty(out, "_plans", { value: plans, enumerable: false }); // for the fact checker
  return out;
}

// ---------------------------------------------------------------- season optimizer

export const SEASON_COMBO_LIMIT = 2_000_000;
const LEVEL_WORDS = [["must", "must-have"], ["important", "important"], ["nice", "nice-to-have"]];

/** Pick one option per game for the whole season. Exact: tries every combination.
 * games: [{ game_id, opponent, single_pick, options: [{ option_id, name, cost, broken }] }].
 * Ranking: [must-have broken, over budget?, important, nice-to-have, total cost], with
 * total <= budget x (1 + pct/100). So the plan only goes over budget to break fewer must-have rules. */
export function optimizeSeason(games, budget, pct = 0) {
  budget = Number(budget) || 0;
  const limit = round(budget * (1 + pct / 100), 2);
  const playable = games.filter((gm) => gm.options.length);
  const combos = playable.reduce((n, gm) => n * gm.options.length, 1);
  const base = { budget, allowance_pct: pct, limit, combinations: combos };
  if (combos > SEASON_COMBO_LIMIT) {
    return { ...base, fits: false, plan: null, strict: null, changes: [], warnings:
      [`Too many combinations to check (${combos}); plan the season in parts.`] };
  }
  let best = null, strict = null, cheapest = null, safe = null;
  const better = (k, cur) => cur === null || cmpKeys(k, cur.k) < 0;
  const pick = [];
  const walk = (i, cost, must, important, nice) => {
    if (i === playable.length) {
      cost = round(cost, 2);
      const over = cost > budget + 1e-9 ? 1 : 0;
      const c = { cost, must, important, nice, picks: [...pick] };
      let k = [must, over, important, nice, cost];
      if (cost <= limit + 1e-9 && better(k, best)) best = { ...c, k };
      k = [must, important, nice, cost];
      if (!over && better(k, strict)) strict = { ...c, k };
      k = [cost, must, important, nice];
      if (better(k, cheapest)) cheapest = { ...c, k };
      k = [cost, important, nice];
      if (must === 0 && better(k, safe)) safe = { ...c, k };
      return;
    }
    for (const o of playable[i].options) {
      pick.push(o);
      walk(i + 1, cost + o.cost, must + o.broken.must, important + o.broken.important, nice + o.broken.nice);
      pick.pop();
    }
  };
  walk(0, 0, 0, 0, 0);

  const describe = (c) => c && {
    total: c.cost, gap: round(budget - c.cost, 2), over_budget: c.cost > budget + 1e-9,
    broken: { must: c.must, important: c.important, nice: c.nice },
    picks: c.picks.map((o, i) => ({ game_id: playable[i].game_id, opponent: playable[i].opponent,
      option_id: o.option_id, name: o.name, cost: o.cost, broken: o.broken,
      single_pick: playable[i].single_pick, changed: o.option_id !== playable[i].single_pick })),
  };
  const plan = describe(best || cheapest);
  const strictPlan = describe(strict);
  const warnings = [];
  if (!best && plan) {
    warnings.push(`No season plan fits $${money(budget)}` + (pct ? ` plus the ${g(pct)}% allowance` : "") +
      `. The cheapest season costs $${money(plan.total)}, which is $${money(-plan.gap)} over the budget.`);
  } else if (plan && plan.over_budget) {
    warnings.push(`This plan is $${money(-plan.gap)} over the season budget (inside the ${g(pct)}% allowance) ` +
      "so that it breaks fewer must-have rules. Going over budget needs approval.");
  }
  let needsMore = null;
  if (plan && plan.broken.must) {
    if (safe) {
      needsMore = round(safe.cost - budget, 2);
      warnings.push(`This plan breaks ${plan.broken.must} must-have rule(s). Keeping every must-have rule ` +
        `needs $${money(needsMore)} more than the season budget.`);
    } else warnings.push(`This plan breaks ${plan.broken.must} must-have rule(s). No season plan keeps every must-have rule.`);
  }
  const byGame = Object.fromEntries(games.map((gm) => [gm.game_id, gm]));
  const changes = (plan?.picks || []).filter((p) => p.changed && p.single_pick).map((p) => {
    const was = byGame[p.game_id].options.find((o) => o.option_id === p.single_pick);
    const diff = round(was.cost - p.cost, 2);
    const parts = [diff >= 0 ? `saves $${money(diff)}` : `costs $${money(-diff)} more`];
    for (const [k, w] of LEVEL_WORDS) {
      const d = p.broken[k] - was.broken[k];
      if (d) parts.push(`breaks ${Math.abs(d)} ${d > 0 ? "more" : "fewer"} ${w} rule(s)`);
    }
    return { game_id: p.game_id, opponent: p.opponent, from: p.single_pick, to: p.option_id, saves: diff,
      text: `${p.opponent}: ${p.single_pick} → ${p.option_id}, ${parts.join(", ")}` };
  });
  const same = Boolean(plan && strictPlan && plan.picks.every((p, i) => p.option_id === strictPlan.picks[i].option_id));
  return { ...base, fits: Boolean(best), plan, strict: strictPlan, same_as_strict: same,
    keep_all_must_total: safe ? safe.cost : null, needs_more_for_must: needsMore, changes, warnings };
}

/** Money and claim checks for AI text about the season plan. */
export function checkSeasonText(text, overview) {
  const o = overview.optimizer;
  const facts = new Set([o.budget, o.limit, overview.season_reserve, Math.abs(overview.season_reserve)]);
  const add = (v) => { if (isNum(v)) facts.add(round(Math.abs(v), 2)); };
  for (const pl of [o.plan, o.strict]) if (pl) { add(pl.total); add(pl.gap); }
  add(o.keep_all_must_total); add(o.needs_more_for_must);
  if (o.plan && o.strict) add(o.plan.total - o.strict.total);
  for (const c of o.changes) add(c.saves);
  for (const p of overview._plans || []) for (const v of moneyFacts(p)) add(v);
  const unverified_numbers = [];
  for (const m of String(text).matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|K)?/g)) {
    let val = parseFloat(m[1].replaceAll(",", ""));
    if (m[2]) val *= 1000;
    const tol = m[2] ? 500 : 1.0;
    if (![...facts].some((f) => Math.abs(val - f) <= tol)) unverified_numbers.push(m[0].trim());
  }
  const issues = [];
  const optionIds = new Set((overview._plans || []).flatMap((p) => p.packages.map((x) => x.option_id)));
  for (const m of String(text).matchAll(/\b[Oo]ptions? ([A-Z])\b/g)) {
    if (!optionIds.has(m[1])) issues.push(`mentions option ${m[1]}, which does not exist`);
  }
  const known = new Set((overview._plans || []).flatMap((p) => [...timesInPlan(p)]));
  for (const m of String(text).matchAll(/\b(\d{1,2})(?::(\d{2}))?\s?([AaPp])\.?[Mm]\b/g)) {
    const h = (Number(m[1]) % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
    if (!known.has(`${h}:${Number(m[2] || 0)}`)) issues.push(`time '${m[0].trim()}' is not in any computed schedule or rule`);
  }
  return { unverified_numbers: unique(unverified_numbers), unverified_claims: unique(issues) };
}

// ---------------------------------------------------------------- what-if edits

export const WHATIF_FIELDS = {
  num_players: "request", num_coaches: "request", num_staff: "request", budget: "request",
  game_id: "special", depart_after_day: "special", depart_after_time: "special", hotel_id: "special",
  players_per_room: "settings", staff_per_room: "settings", seats_per_bus: "settings",
  meal_allowance: "settings", hotel_max_rate: "settings", extras_per_person_per_day: "settings",
};
export const DAY_OFFSETS = { game_day: 0, day_before: 1, two_days_before: 2 };

/** Apply model-proposed edits. The arithmetic and date math happen here, not in the model.
 * `effective` = current settings; `data` = data pack; `extra` receives a requested hotel_id.
 * Returns [request, overrides, applied, rejected]. */
export function applyEdits(req, overrides, edits, effective = null, data = null, extra = null) {
  req = { ...req };
  overrides = { ...(overrides || {}) };
  effective = { ...(effective || {}) };
  extra = extra ?? {};
  const applied = [], rejected = [];
  let newDay = null, newTime = null;
  const show = (v) => (v === null || v === undefined || v === "" ? "none" : String(v));

  for (const e of Array.isArray(edits) ? edits : []) {
    const { field, op, value } = e || {};
    const text = e?.text_value;
    if (!(field in WHATIF_FIELDS) || !["set", "add", "clear"].includes(op)) {
      rejected.push(`Unsupported change: ${field} ${op}`);
      continue;
    }
    const kind = WHATIF_FIELDS[field];
    if (kind === "special") {
      if (field === "game_id") {
        const game = getGame(data || { schedule: { games: [] } }, String(text || ""));
        if (!game) { rejected.push(`Unknown game: ${text}`); continue; }
        const old = data ? getGame(data, req.game_id || "") : null;
        if (old && req.depart_after) {
          // keep the same 'days before kickoff' and clock time for the new game
          const dep = parseDT(req.depart_after);
          const offset = daysBetween(parseDT(old.date), dep);
          req.depart_after = fmtT(addDays(parseDT(game.date), -offset) + (dep - dayStart(dep)));
        }
        req.game_id = game.game_id;
        applied.push(`game: ${old ? old.opponent : "none"} → ${game.opponent}`);
      } else if (field === "depart_after_day") {
        if (!(text in DAY_OFFSETS)) { rejected.push(`Unknown departure day: ${text}`); continue; }
        newDay = text;
      } else if (field === "depart_after_time") {
        if (!isNum(value) || !(value >= 0 && value < 24)) {
          rejected.push("Departure time must be an hour from 0 to 23.99");
          continue;
        }
        newTime = value;
      } else if (field === "hotel_id") {
        extra.hotel_id = String(text || "");
      }
      continue;
    }

    const target = kind === "request" ? req : overrides;
    if (op === "clear") {
      if (field !== "hotel_max_rate") { rejected.push(`Cannot clear ${field}`); continue; }
      target[field] = "";
      applied.push("Removed the hotel rate cap");
      continue;
    }
    if (!isNum(value)) { rejected.push(`Change to ${field} needs a number`); continue; }
    const current = field in target ? target[field] : effective[field];
    let next;
    if (op === "add") {
      let cur;
      try { cur = current === null || current === undefined || current === "" ? null : toFloat(current); } catch { cur = null; }
      if (cur === null) { rejected.push(`Cannot add to ${field}: it has no current value`); continue; }
      next = cur + value;
    } else {
      next = value;
    }
    if (next < 0) { rejected.push(`${field} cannot go below zero`); continue; }
    if (field.startsWith("num_") || INT_SETTINGS.has(field)) next = round(next);
    target[field] = next;
    applied.push(`${field}: ${show(current)} → ${next}`);
  }

  if ((newDay || newTime !== null) && data) {
    const game = getGame(data, req.game_id || "");
    if (game) {
      const gd = parseDT(game.date);
      const old = req.depart_after ? parseDT(req.depart_after) : null;
      const day = newDay ? addDays(gd, -DAY_OFFSETS[newDay]) : (old !== null ? dayStart(old) : addDays(gd, -1));
      const t = newTime !== null ? newTime : (old !== null ? clockHours(old) : 8);
      const newDT = addHours(day, t);
      applied.push(`earliest departure: ${old !== null ? strftime(old, "%a %I:%M %p") : "none"} → ${strftime(newDT, "%a %I:%M %p")}`);
      req.depart_after = fmtT(newDT);
    }
  }
  return [req, overrides, applied, rejected];
}

// ---------------------------------------------------------------- rooming list

export function roomingList(data, req, s) {
  let players = sortBy(data.roster.players.filter((p) => p.status === "active"), (p) => [p.depth_rank])
    .slice(0, req.num_players);
  players = sortBy(players, (p) => [p.position, p.depth_rank]);
  const per = s.players_per_room;
  const rooms = [];
  for (let i = 0; i < players.length; i += per) {
    rooms.push({ room: `P${Math.floor(i / per) + 1}`, occupants: players.slice(i, i + per).map((p) => p.player_id) });
  }
  const pad = (prefix, have, n) => {
    const out = have.slice(0, n);
    for (let i = out.length + 1; i <= n; i++) out.push(`${prefix}${String(i).padStart(2, "0")}`);
    return out;
  };
  const ids = [...pad("C", data.roster.coaches.map((x) => x.coach_id), req.num_coaches),
    ...pad("S", data.roster.staff.map((x) => x.staff_id), req.num_staff)];
  const sper = s.staff_per_room;
  const srooms = [];
  for (let i = 0; i < ids.length; i += sper) srooms.push({ room: `S${Math.floor(i / sper) + 1}`, occupants: ids.slice(i, i + sper) });
  const short = req.num_players - players.length;
  return { player_rooms: rooms, staff_rooms: srooms,
    note: short > 0 ? `Roster has only ${players.length} active players; ${short} unassigned.` : null };
}

// ---------------------------------------------------------------- grounding check

export function moneyFacts(plan) {
  const facts = new Set([Number(plan.budget)]);
  for (const k of ["meal_allowance", "breakfast_allowance", "postgame_meal_cost", "hotel_max_rate",
    "extras_per_person_per_day", "extras_flat_per_trip", "policy_lodging_rate_limit"]) {
    const v = (plan.settings_used || {})[k];
    if (isNum(v)) facts.add(v);
  }
  for (const p of plan.packages) {
    for (const v of Object.values(p.costs)) facts.add(Number(v));
    facts.add(Math.abs(p.budget_gap));
    for (const m of p.meals) { facts.add(Number(m.cost)); facts.add(Number(m.per_person)); }
    if (p.hotel) facts.add(Number(p.hotel.nightly_rate));
    if (p.bus) { facts.add(Number(p.bus.per_bus)); facts.add(Number(p.bus.per_mile)); }
    if (p.drivers) { facts.add(Number(p.drivers.per_bus)); facts.add(Number(p.drivers.extra_cost)); }
    facts.add(Number(p.extras_detail.per_person_per_day));
    facts.add(Number(p.extras_detail.flat));
    if (p.lodging_detail) facts.add(Number(p.lodging_detail.bus_parking_cost ?? 0));
  }
  for (const a of plan.packages) for (const b of plan.packages) facts.add(round(Math.abs(a.costs.total - b.costs.total), 2));
  return facts;
}

/** Dollar amounts in the model's text that don't match any computed figure. */
export function checkNumbers(text, plan) {
  const facts = [...moneyFacts(plan)];
  const bad = [];
  for (const m of String(text).matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|K)?/g)) {
    let val = parseFloat(m[1].replaceAll(",", ""));
    if (m[2]) val *= 1000;
    const tol = m[2] ? 500 : 1.0;
    if (!facts.some((f) => Math.abs(val - f) <= tol)) bad.push(m[0].trim());
  }
  return bad;
}

export function timesInPlan(plan) {
  const out = new Set();
  for (const p of plan.packages) {
    for (const e of p.timeline) out.add(hm(parseDT(e.time)).join(":"));
    for (const r of p.rule_checks) {
      for (const m of `${r.rule} ${r.actual}`.matchAll(/(\d{1,2}):(\d{2}) (AM|PM)/g)) {
        out.add(`${(Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0)}:${Number(m[2])}`);
      }
      if (r.rule.includes("midnight")) out.add("0:0");
    }
  }
  return out;
}

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/** Fact check for a trip memo (used by POST /api/check and the trust eval). */
export function checkMemoText(text, plan) {
  // The approval line comes from the approval record, not the trip plan, so its time is not a trip fact to check.
  text = String(text).replace(/^.*\bApproved by\b.*\(approval [0-9a-f]+\).*$/gim, "");
  return { unverified_numbers: checkNumbers(text, plan), unverified_claims: checkClaims(text, plan) };
}

/** Non-dollar claims in AI text: option IDs, clock times, and 'keeps/breaks N rules' statements. */
export function checkClaims(text, plan) {
  text = String(text);
  const issues = [];
  const byId = Object.fromEntries(plan.packages.map((p) => [p.option_id, p]));
  for (const m of text.matchAll(/\b[Oo]ptions? ([A-Z])\b/g)) {
    if (!(m[1] in byId)) issues.push(`mentions option ${m[1]}, which does not exist`);
  }
  const known = timesInPlan(plan);
  for (const m of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s?([AaPp])\.?[Mm]\b/g)) {
    const h = (Number(m[1]) % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
    if (!known.has(`${h}:${Number(m[2] || 0)}`)) issues.push(`time '${m[0].trim()}' is not in any computed schedule or rule`);
  }
  for (const sent of text.split(/(?<=[.;!?])\s+/)) {
    const ids = [...sent.matchAll(/\b[Oo]ption ([A-Z])\b/g)].map((m) => m[1]);
    if (new Set(ids).size !== 1 || !(ids[0] in byId)) continue;
    const p = byId[ids[0]];
    if (/\b(keeps|meets|follows|passes) (every|all)\b/i.test(sent) && p.rules_broken) {
      issues.push(`says option ${ids[0]} keeps every rule, but it breaks ${p.rules_broken}`);
    }
    const m = /\bbreaks (\d+|one|two|three|four|five)\b(?:\s+(must-have|important|nice-to-have)\b)?/i.exec(sent);
    if (m) {
      const n = NUM_WORDS[m[1].toLowerCase()] ?? parseInt(m[1], 10);
      if (m[2]) {
        // "breaks 1 must-have rule": compare with that level's count (team rules + example policy)
        const key = { "must-have": "must", important: "important", "nice-to-have": "nice" }[m[2].toLowerCase()];
        const have = (p.broken_by_priority || brokenByPriority(p))[key];
        if (n !== have) issues.push(`says option ${ids[0]} breaks ${n} ${m[2].toLowerCase()} rule(s), but it breaks ${have}`);
      } else if (n !== p.rules_broken) issues.push(`says option ${ids[0]} breaks ${n} rule(s), but it breaks ${p.rules_broken}`);
    }
  }
  return unique(issues);
}

/** Example expense-report checklist (staff-editable days; confirm with BGSU Travel Services). */
export function expenseReportInfo(pkg, s) {
  const ret = dayStart(parseDT(pkg.facts.return_time));
  const days = Math.trunc(s.policy_expense_report_days ?? 90);
  const due = addDays(ret, days);
  return { travel_ends: fmtDate(ret), due_date: fmtDate(due), days,
    notes: ["Example checklist, not BGSU's current policy – confirm with BGSU Travel Services.",
      "Submit one expense report for this trip, named for the trip's purpose.",
      `Submit within ${days} days of travel (example policy value): by ${strftime(due, "%a %b %d, %Y").replaceAll(" 0", " ")}.`,
      "Both the first and last days count as travel days for per diem.",
      "Meals provided as team meals are not claimed as per diem.",
      "Receipts are not needed for tolls, taxis and parking under $25."] };
}
