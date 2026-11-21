// Unit tests for the math (no AI involved). Run: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as planner from "../src/planner.js";
import { setToday } from "../src/util.js";

const DATA = planner.loadData();
const REQ = { game_id: "G07", num_players: 22, num_coaches: 4, num_staff: 3, budget: 6000, depart_after: "2027-09-18T12:00" };
const REQ9 = { ...REQ, game_id: "G09", budget: 15000, depart_after: "2027-10-15T12:00" };

function plan(req = REQ, overrides = {}) {
  const [clean, errors] = planner.validateRequest(req, DATA);
  assert.deepEqual(errors, []);
  const [s] = planner.mergeSettings(DATA.settings, overrides);
  return { p: planner.buildPackages(clean, DATA, s), req: clean, s };
}
const opt = (p, id) => p.packages.find((x) => x.option_id === id);
const ids = (p) => p.packages.map((x) => x.option_id);
const totals = (p) => Object.fromEntries(p.packages.map((x) => [x.option_id, x.costs.total]));
const near = (a, b, places = 2) => assert.ok(Math.abs(a - b) < 0.5 * 10 ** -places, `${a} != ${b}`);

describe("counts", () => {
  test("buses and rooms", () => {
    const [s] = planner.mergeSettings(DATA.settings, {});
    const c = planner.counts({ num_players: 22, num_coaches: 4, num_staff: 3 }, s);
    assert.equal(c.travelers, 29);
    assert.equal(c.buses, 1); // 29 / 56 seats -> 1
    assert.equal(c.rooms, 11 + 7); // 2 per player room, 1 per staff room
  });
  test("settings change counts", () => {
    const [s] = planner.mergeSettings(DATA.settings, { seats_per_bus: 20, players_per_room: 3 });
    const c = planner.counts({ num_players: 22, num_coaches: 4, num_staff: 3 }, s);
    assert.equal(c.buses, 2);
    assert.equal(c.player_rooms, 8);
  });
});

describe("packages", () => {
  test("worked example totals", () => assert.deepEqual(totals(plan().p), { A: 3265, B: 6567.2, C: 7607.2 }));
  test("extras are staff settings", () => {
    assert.deepEqual(totals(plan(REQ, { extras_per_person_per_day: 0, extras_flat_per_trip: 0 }).p), { A: 2941, B: 6069.2, C: 7109.2 });
  });
  test("lodging includes tax", () => near(opt(plan().p, "B").costs.lodging, 18 * 119 * 1.1));
  test("picks", () => {
    const { p } = plan();
    assert.equal(p.best_within_budget, "A");
    assert.equal(p.best_fit_rules, "B");
  });
  test("no option in budget", () => {
    const { p } = plan({ ...REQ, budget: 1000 });
    assert.equal(p.best_within_budget, null);
    assert.ok(p.notes.some((n) => n.includes("No option fits the budget")));
  });
  test("hotel cap removes overnight", () => assert.deepEqual(ids(plan(REQ, { hotel_max_rate: 80 }).p), ["A"]));
  test("flight only for long trips", () => {
    assert.ok(ids(plan(REQ9).p).includes("D"));
    assert.ok(!ids(plan().p).includes("D"));
  });
  test("day trip infeasible when departure too late", () => {
    assert.equal(opt(plan({ ...REQ, depart_after: "2027-09-19T08:00" }).p, "A").feasible, false);
  });
  test("rule checks", () => {
    const { p } = plan();
    const broken = (id) => opt(p, id).rule_checks.filter((r) => !r.ok).map((r) => r.rule);
    assert.deepEqual(broken("A"), ["Depart no earlier than 7:00 AM", "Game-day travel 1.5 hrs or less"]);
    assert.deepEqual(broken("B"), []);
  });
  test("rules are staff settings", () => {
    const { p } = plan(REQ, { rule_earliest_departure_hour: 5, rule_max_gameday_travel_hours: 4 });
    assert.equal(opt(p, "A").rules_broken, 0);
    assert.equal(p.best_fit_rules, "A");
  });
  test("meal timing rule", () => {
    const a = opt(plan(REQ, { pregame_meal_hours_before: 4 }).p, "A");
    assert.ok(a.rule_checks.some((r) => !r.ok && r.rule.includes("Pregame meal")));
  });
  test("staff hotel and restaurant choice", () => {
    const { req, s } = plan();
    const [custom, errors] = planner.validateCustom({ option_id: "B", hotel_id: "H2", meals: { pregame: "R3" } }, req, DATA, s);
    assert.deepEqual(errors, []);
    const b = opt(planner.buildPackages(req, DATA, s, custom), "B");
    assert.equal(b.hotel.hotel_id, "H2");
    const pre = b.meals.find((m) => m.slot === "pregame");
    assert.deepEqual([pre.restaurant_id, pre.chosen_by, pre.cost], ["R3", "staff", 24 * 29]);
  });
  test("staff choice rejected when group does not fit", () => {
    const { req, s } = plan();
    const [, errors] = planner.validateCustom({ option_id: "B", hotel_id: "H3", meals: { pregame: "R6" } }, req, DATA, s);
    assert.equal(errors.length, 2); // Budget Lodge has no bus parking; Dockside Deli is in another city
  });
});

describe("what-if edits", () => {
  test("edits are applied in code", () => {
    const { req, s } = plan();
    const [newReq, over, , rejected] = planner.applyEdits(req, {}, [
      { field: "num_players", op: "add", value: -2 }, { field: "staff_per_room", op: "set", value: 2 }], s);
    assert.equal(newReq.num_players, 20);
    assert.equal(over.staff_per_room, 2);
    assert.deepEqual(rejected, []);
    const b = opt(plan(newReq, over).p, "B");
    assert.equal(b.costs.total, 5925.6);
    assert.ok(b.within_budget);
  });
  test("bad edits rejected", () => {
    const { req, s } = plan();
    const [, , applied, rejected] = planner.applyEdits(req, {}, [
      { field: "hotel_name", op: "set", value: 1 }, { field: "num_players", op: "add", value: -500 }], s);
    assert.deepEqual(applied, []);
    assert.equal(rejected.length, 2);
  });
  test("departure day and time", () => {
    const { req, s } = plan();
    const [n, , , rejected] = planner.applyEdits(req, {}, [
      { field: "depart_after_day", op: "set", text_value: "day_before" },
      { field: "depart_after_time", op: "set", value: 15 }], s, DATA);
    assert.equal(n.depart_after, "2027-09-18T15:00");
    assert.deepEqual(rejected, []);
  });
  test("game change keeps relative departure", () => {
    const { req, s } = plan();
    const [n] = planner.applyEdits(req, {}, [{ field: "game_id", op: "set", text_value: "G08" }], s, DATA);
    assert.deepEqual([n.game_id, n.depart_after], ["G08", "2027-10-04T12:00"]);
  });
  test("unknown ids rejected", () => {
    const { req, s } = plan();
    const [, , , rejected] = planner.applyEdits(req, {}, [
      { field: "game_id", op: "set", text_value: "G99" },
      { field: "depart_after_day", op: "set", text_value: "next_week" }], s, DATA, {});
    assert.equal(rejected.length, 2);
  });
});

describe("validation", () => {
  test("bad input", () => {
    const [, errors] = planner.validateRequest({ game_id: "NOPE", num_players: "abc", num_coaches: -1, num_staff: 2.5, budget: 0 }, DATA);
    assert.equal(errors.length, 5);
  });
  test("departure after kickoff", () => {
    const [, errors] = planner.validateRequest({ ...REQ, depart_after: "2027-09-20T09:00" }, DATA);
    assert.ok(errors.some((e) => e.includes("before kickoff")));
  });
  test("settings bounds", () => {
    const [, errors] = planner.mergeSettings(DATA.settings, { seats_per_bus: 0, players_per_room: "x" });
    assert.equal(errors.length, 2);
  });
});

describe("fact check", () => {
  test("grounded and invented numbers", () => {
    const { p } = plan();
    assert.deepEqual(planner.checkNumbers("B costs $6,567.20, $567.20 over.", p), []);
    assert.deepEqual(planner.checkNumbers("Flights would cost $9,999.", p), ["$9,999"]);
  });
  test("difference between options is allowed", () => {
    assert.deepEqual(planner.checkNumbers("B costs $3,302.20 more than A.", plan().p), []);
  });
  test("true claims pass", () => {
    assert.deepEqual(planner.checkClaims("Option B gets home by 8:00 PM and keeps every team rule. Option A breaks 2 rules.", plan().p), []);
  });
  test("false claims caught", () => {
    const issues = planner.checkClaims("Option B gets home by 9:00 PM. Option A keeps all rules. Option E is cheaper.", plan().p);
    assert.equal(issues.length, 3);
  });
});

describe("rooming list", () => {
  test("injured excluded and rooms filled", () => {
    const { req, s } = plan();
    const r = planner.roomingList(DATA, req, s);
    const got = r.player_rooms.flatMap((x) => x.occupants);
    const injured = new Set(DATA.roster.players.filter((p) => p.status !== "active").map((p) => p.player_id));
    assert.equal(got.length, 22);
    assert.ok(!got.some((i) => injured.has(i)));
    assert.equal(r.player_rooms.length, 11);
  });
});

describe("night game", () => {
  test("stay-after option offered when return is late", () => {
    const { p } = plan(REQ9);
    const e = opt(p, "E");
    assert.equal(e.nights, 2);
    assert.equal(e.facts.stay_after, true);
    assert.ok(e.rule_checks.find((r) => r.rule.startsWith("Home by")).ok);
    assert.equal(opt(p, "B").rule_checks.find((r) => r.rule.startsWith("Home by")).ok, false);
  });
  test("stay-after costs two nights", () => {
    const e = opt(plan(REQ9).p, "E");
    near(e.costs.lodging, 18 * 129 * 2 * 1.1);
    assert.equal(e.extras_detail.days, 3);
    assert.ok(e.meals.some((m) => m.slot === "breakfast_after"));
  });
  test("no stay-after for a day game", () => assert.ok(!ids(plan().p).includes("E")));
});

describe("hotel needs and example policy", () => {
  const REQ8 = { ...REQ, game_id: "G08", depart_after: "2027-10-04T12:00" };
  test("bus parking fee in lodging", () => assert.equal(opt(plan().p, "C").lodging_detail.bus_parking_cost, 40)); // 1 bus x $40 x 1 night
  test("required bus parking excludes hotel", () => {
    assert.ok(!ids(plan(REQ8).p).includes("C")); // River House has no bus parking
    assert.ok(ids(plan(REQ8, { require_bus_parking: 0 }).p).includes("C"));
  });
  test("required meeting room", () => assert.ok(!ids(plan(REQ9, { require_meeting_room: 1 }).p).includes("C"))); // Dome Gate
  test("policy lodging rate limit", () => {
    const c = opt(plan().p, "C");
    assert.equal(c.policy_issues, 1);
    assert.ok(c.flags.some((f) => f.includes("Example policy")));
  });
  test("policy: overnight not needed for a short trip", () => {
    const { p } = plan(REQ8);
    assert.equal(opt(p, "B").policy_issues, 1);
    assert.equal(p.best_fit_rules, "A");
  });
  test("policy: overnight justified for Lakeview", () => assert.equal(opt(plan().p, "B").policy_issues, 0));
});

describe("season overview", () => {
  const [s] = planner.mergeSettings(DATA.settings, {});
  const o = planner.seasonOverview(DATA, s);
  const by = Object.fromEntries(o.games.map((x) => [x.game_id, x]));
  test("within 50 miles is a day trip without hotels", () => {
    assert.deepEqual([by.G06.kind, by.G06.hotels], ["day", []]);
    assert.deepEqual(ids(plan({ ...REQ, game_id: "G06", depart_after: "2027-09-07T12:00" }).p), ["A"]);
  });
  test("far game needing overnight gets hotel recommendations", () => {
    assert.equal(by.G07.kind, "overnight");
    assert.deepEqual(by.G07.hotels.map((h) => h.name), ["Lakeview Inn", "Stadium Suites"]);
    assert.ok(by.G07.hotels_excluded.some((x) => x.name.includes("Budget Lodge")));
  });
  test("far game where a day trip fits", () => assert.equal(by.G08.kind, "day"));
  test("per-game budget is the season plan's pick, and the rest is the reserve", () => {
    const total = o.games.reduce((a, x) => a + x.allocated_budget, 0);
    near(total, o.optimizer.plan.total);
    near(o.season_reserve, o.season_budget - total);
    assert.ok(by.G09.allocated_budget > by.G07.allocated_budget);
  });
});

describe("benchmarks", () => {
  test("synthetic seasons only", () => {
    assert.match(DATA.benchmarks.note, /^Synthetic/);
    assert.equal(DATA.benchmarks.source.url, null);
    const rows = Object.fromEntries(planner.benchmarkRows(DATA).map((r) => [r.key, r]));
    assert.equal(rows["Sample season A"].per_trip, 7700); // 30,800 / 4
    assert.equal(rows["Sample season B"].per_trip, 8360); // 33,440 / 4
    assert.equal(rows["Sample season B"].change_vs_prior, 8.6);
    assert.equal(rows.avg.spread_pct, 8.6);
  });
  test("season budget from benchmark", () => {
    const [s] = planner.mergeSettings(DATA.settings, {});
    const b = planner.seasonOverview(DATA, s).benchmarks.find((x) => x.key === "Sample season B");
    near(b.season_budget_for_party, 380 * 22 * 4);
  });
});

describe("BGSU travel tips", () => {
  test("flight booking window", () => {
    try {
      setToday(() => Date.UTC(2027, 9, 1)); // 14 days before departure
      let d = opt(plan(REQ9).p, "D");
      assert.equal(d.policy_checks.find((c) => c.rule.startsWith("Flights bought")).ok, false);
      setToday(() => Date.UTC(2027, 7, 1));
      d = opt(plan(REQ9).p, "D");
      assert.equal(d.policy_checks.find((c) => c.rule.startsWith("Flights bought")).ok, true);
    } finally {
      setToday(() => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); });
    }
  });
  test("expense report due in 90 days", () => {
    const { p, s } = plan();
    const info = planner.expenseReportInfo(opt(p, "B"), s);
    assert.deepEqual([info.travel_ends, info.due_date], ["2027-09-19", "2027-12-18"]);
  });
});

describe("rule priorities", () => {
  const REQ8 = { game_id: "G08", num_players: 22, num_coaches: 4, num_staff: 3, budget: 15000 };
  const brokenIds = (o) => [...o.rule_checks, ...o.policy_checks].filter((r) => !r.ok).map((r) => r.id);

  test("every rule starts as important, so picks match counting rules", () => {
    assert.equal(plan(REQ8).p.best_fit_rules, "A"); // A and B each break 1 rule; A is cheaper
    assert.equal(plan(REQ9).p.best_fit_rules, "D");
    for (const r of [REQ, REQ8, REQ9]) {
      for (const o of plan(r).p.packages) {
        const b = o.broken_by_priority;
        assert.deepEqual([b.must, b.nice], [0, 0]);
        assert.equal(b.important, o.rules_broken + o.policy_issues);
        for (const c of [...o.rule_checks, ...o.policy_checks]) assert.equal(c.priority, 2);
      }
    }
  });
  test("home-by as must-have picks the costlier option that gets home on time", () => {
    const { p } = plan(REQ9, { priority_home_by: 3 });
    assert.equal(p.best_fit_rules, "E");
    assert.ok(opt(p, "E").costs.total > opt(p, "D").costs.total);
    assert.deepEqual(brokenIds(opt(p, "D")), ["home_by"]);
    assert.equal(opt(p, "D").broken_by_priority.must, 1);
    assert.ok(opt(p, "D").flags.some((f) => f.startsWith("Breaks team rule (must-have): Home by")));
  });
  test("must-have outranks a lesser rule even when it costs more", () => {
    assert.equal(plan(REQ8, { priority_gameday_travel: 3 }).p.best_fit_rules, "B");
  });
  test("a nice-to-have rule loses to an important one", () => {
    assert.equal(plan(REQ8, { priority_overnight_needed: 1 }).p.best_fit_rules, "B");
  });
  test("when levels tie, the cheaper option wins", () => {
    const { p } = plan(REQ8, { priority_gameday_travel: 1, priority_overnight_needed: 1 });
    assert.equal(p.best_fit_rules, "A");
    assert.equal(opt(p, "A").broken_by_priority.nice, 1);
  });
  test("bad levels are rejected", () => {
    for (const v of [0, 5, "high"]) {
      const [s, errors] = planner.mergeSettings(DATA.settings, { priority_home_by: v });
      assert.equal(errors.length, 1);
      assert.equal(s.priority_home_by, 2);
    }
  });
  test("fact check understands level wording", () => {
    const { p } = plan(REQ9, { priority_home_by: 3 });
    assert.deepEqual(planner.checkClaims("Option D breaks 1 must-have rule.", p), []);
    assert.equal(planner.checkClaims("Option D breaks 2 must-have rules.", p).length, 1);
    assert.equal(planner.checkClaims("Option E breaks 1 must-have rule.", p).length, 1);
  });
});

describe("season optimizer", () => {
  const season = (ov) => { const [s] = planner.mergeSettings(DATA.settings, ov); return planner.seasonOverview(DATA, s); };
  const picks = (o) => o.optimizer.plan.picks.map((p) => p.option_id).join("");
  const MUST = { priority_home_by: 3 };

  // Independent check: list every combination by hand and sort by the spec's rules.
  function bruteForce(o, budget, pct) {
    const games = o._plans.map((p) => p.packages.filter((x) => x.feasible));
    let all = [[]];
    for (const opts of games) all = all.flatMap((c) => opts.map((x) => [...c, x]));
    const limit = budget * (1 + pct / 100);
    const rows = all.map((c) => {
      const cost = Math.round(c.reduce((a, x) => a + x.costs.total, 0) * 100) / 100;
      const n = (k) => c.reduce((a, x) => a + x.broken_by_priority[k], 0);
      return { ids: c.map((x) => x.option_id).join(""), key: [n("must"), cost > budget ? 1 : 0, n("important"), n("nice"), cost], cost };
    }).filter((r) => r.cost <= limit + 1e-9);
    rows.sort((a, b) => { for (let i = 0; i < 5; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i]; return 0; });
    return rows[0] || null;
  }

  test("enough budget: same as planning each trip alone", () => {
    const o = season({});
    assert.equal(picks(o), "ABAD");
    assert.deepEqual(o.optimizer.changes, []);
    assert.equal(o.optimizer.same_as_strict, true);
    assert.equal(o.optimizer.combinations, 30);
  });
  test("home-by must-have at $25,000: day trip to Lakeview keeps Harbor City on time", () => {
    const o = season({ ...MUST, season_travel_budget: 25000 });
    assert.equal(picks(o), "AAAE");
    near(o.optimizer.plan.total, 21708.4);
    near(o.season_reserve, 3291.6);
    assert.deepEqual(o.optimizer.plan.broken, { must: 0, important: 4, nice: 0 });
    assert.deepEqual(o.optimizer.changes.map((c) => c.text),
      ["Lakeview State: B → A, saves $3,302.20, breaks 2 more important rule(s)"]);
  });
  test("tight budget with default levels stays under budget", () => {
    const o = season({ season_travel_budget: 22000 });
    assert.equal(picks(o), "ABAB");
    assert.equal(o.optimizer.plan.over_budget, false);
  });
  test("never worse than checking every plan by hand", () => {
    for (const ov of [{}, MUST, { priority_gameday_travel: 3 }, { priority_depart_earliest: 1 }]) {
      for (const budget of [10000, 15000, 18000, 20000, 22000, 25000, 30000]) {
        for (const pct of [0, 5, 10, 25]) {
          const o = season({ ...ov, season_travel_budget: budget, season_overbudget_pct: pct });
          const want = bruteForce(o, budget, pct);
          if (!want) { assert.equal(o.optimizer.fits, false); continue; }
          assert.equal(picks(o), want.ids, JSON.stringify({ ov, budget, pct }));
        }
      }
    }
  });
  test("nothing fits: says so and shows the cheapest season", () => {
    const o = season({ season_travel_budget: 10000 });
    assert.equal(o.optimizer.fits, false);
    assert.equal(picks(o), "AAAA");
    // $15,050 = $14,650 + $400 second driver on the 19-hour Harbor City day trip (Feature 3)
    assert.ok(o.optimizer.warnings[0].includes("The cheapest season costs $15,050.00, which is $5,050.00 over"));
  });
  test("goes slightly over budget only to keep a must-have rule", () => {
    let o = season({ ...MUST, season_travel_budget: 20000, season_overbudget_pct: 10 });
    assert.equal(picks(o), "AAAE");
    assert.equal(o.optimizer.plan.over_budget, true);
    near(-o.optimizer.plan.gap, 1708.4);
    assert.equal(o.optimizer.same_as_strict, false);
    assert.equal(o.optimizer.strict.picks.map((p) => p.option_id).join(""), "ABAA");
    assert.ok(o.optimizer.warnings.some((w) => w.includes("needs approval")));
    o = season({ ...MUST, season_travel_budget: 20000, season_overbudget_pct: 5 });
    assert.equal(picks(o), "ABAA");
    assert.equal(o.optimizer.plan.broken.must, 1);
    assert.ok(o.optimizer.warnings.some((w) => w.includes("needs $1,708.40 more")));
  });
  test("never goes over budget just to save important rules", () => {
    // $24,000 + 10% = $26,400 would allow ABAD ($24,900.40, fewer rules broken), but it only saves important rules.
    const o = season({ season_travel_budget: 24000, season_overbudget_pct: 10 });
    assert.equal(o.optimizer.plan.over_budget, false);
    assert.equal(picks(o), "ABAB");
  });
  test("'Plan this trip' with the per-game budget lands on the season pick", () => {
    const o = season({ ...MUST, season_travel_budget: 25000 });
    for (const row of o.games) {
      const day = new Date(`${row.date}T12:00Z`); day.setUTCDate(day.getUTCDate() - 1);
      const req = { game_id: row.game_id, num_players: 22, num_coaches: 4, num_staff: 3,
        budget: row.allocated_budget, depart_after: `${day.toISOString().slice(0, 10)}T12:00` };
      assert.equal(plan(req, MUST).p.best_within_budget, row.season_pick.option_id, row.game_id);
    }
  });
  test("season text fact check", () => {
    const o = season({ ...MUST, season_travel_budget: 25000 });
    const ok = "Take the day trip to Lakeview (option A, saves $3,302.20). The season costs $21,708.40, $3,291.60 under.";
    assert.deepEqual(planner.checkSeasonText(ok, o), { unverified_numbers: [], unverified_claims: [] });
    const badText = planner.checkSeasonText("This saves $9,999.00 with option Z.", o);
    assert.deepEqual(badText.unverified_numbers, ["$9,999.00"]);
    assert.equal(badText.unverified_claims.length, 1);
  });
});

describe("driver hours", () => {
  const REQ6 = { ...REQ, game_id: "G06", depart_after: "2027-09-07T12:00" };
  test("Lakeview day trip (8 hrs): one driver, same cost as before", () => {
    const a = opt(plan().p, "A");
    assert.deepEqual([a.drivers.longest, a.drivers.drivers, a.drivers.extra_cost], [8, 1, 0]);
    near(a.costs.total, 3265);
  });
  test("Harbor City day trip (19 hrs): second driver added to the cost", () => {
    const { p } = plan(REQ9);
    const a = opt(p, "A");
    assert.deepEqual([a.drivers.longest, a.drivers.drivers, a.drivers.extra_cost, a.feasible], [19, 2, 400, true]);
    const [s0] = planner.mergeSettings(DATA.settings, { second_driver_cost: 0 });
    near(a.costs.transport - planner.buildPackages(p.request ?? REQ9, DATA, s0).packages.find((x) => x.option_id === "A").costs.transport, 400);
    assert.ok(a.notes.some((n) => n.startsWith("Needs a second driver: 19 hrs")));
  });
  test("Harbor City overnights stay with one driver", () => {
    for (const id of ["B", "C", "E"]) {
      const o = opt(plan(REQ9).p, id);
      assert.equal(o.drivers.drivers, 1, id);
      assert.ok(o.drivers.longest <= 9.7 + 1e-9, id);
    }
  });
  test("the limit is 'or less'", () => {
    assert.equal(opt(plan(REQ, { driver_max_hours: 8 }).p, "A").drivers.drivers, 1);
    assert.equal(opt(plan(REQ, { driver_max_hours: 7.5 }).p, "A").drivers.drivers, 2);
  });
  test("more than two drivers can cover is not possible", () => {
    const a = opt(plan(REQ9, { driver_max_hours: 5 }).p, "A");
    assert.equal(a.feasible, false);
    assert.ok(a.notes.some((n) => n.startsWith("Not possible: 19 hrs of driving")));
  });
  test("second driver cost scales with buses", () => {
    const a = opt(plan(REQ9, { seats_per_bus: 20 }).p, "A");
    assert.deepEqual([a.bus.count, a.drivers.extra_cost], [2, 800]);
  });
  test("flights are not checked", () => assert.equal(opt(plan(REQ9).p, "D").drivers, undefined));
  test("short trips are unaffected", () => assert.equal(opt(plan(REQ6).p, "A").drivers.extra_cost, 0));
  test("fact check accepts the second-driver cost", () => {
    assert.deepEqual(planner.checkNumbers("Option A adds $400.00 for a second driver.", plan(REQ9).p), []);
  });
});
