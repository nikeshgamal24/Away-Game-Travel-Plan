// Trustworthiness eval (spec 04): how often does what Aivana writes match the app's math?
//
// Code makes repeatable scenarios (fixed seed), asks Aivana exactly as the app does
// (recommend, memo, season explanation), runs the same fact checker the app uses, and
// scores the results. It also plants mistakes in true text to prove the fact checker
// catches them. Run with: npm run eval:trust  (see scripts/eval-trust.js)

import * as planner from "./planner.js";
import { round, money, addDays, addHours, dayStart, fmtT } from "./util.js";

// ---------------------------------------------------------------- scenarios

/** Small seeded random generator (mulberry32), so every run makes the same scenarios. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SETTING_MIXES = [
  {}, {}, { priority_home_by: 3 }, { priority_gameday_travel: 3 }, { priority_depart_earliest: 1 },
  { players_per_room: 3 }, { priority_home_by: 3, players_per_room: 3 }, { hotel_max_rate: 150 },
];

/** n trip scenarios: valid requests with at least one possible option. Same seed -> same list. */
export function makeScenarios(data, n = 30, seed = 42) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const games = data.schedule.games;
  const out = [], seen = new Set();
  for (let tries = 0; out.length < n && tries < n * 20; tries++) {
    const game = games[out.length % games.length]; // every game gets used
    const settings = pick(SETTING_MIXES);
    const kick = planner.kickoffDT(game);
    const departDay = pick([1, 1, 2, 0]); // days before the game
    const departHour = departDay === 0 ? pick([6, 8]) : pick([8, 10, 12, 14]);
    const party = { num_players: int(15, 28), num_coaches: int(2, 5), num_staff: int(1, 4) };
    const depart = fmtT(addHours(dayStart(addDays(kick, -departDay)), departHour)).slice(0, 16);
    const [s, sErr] = planner.mergeSettings(data.settings, settings);
    const [probe, rErr] = planner.validateRequest({ ...party, game_id: game.game_id, budget: 1_000_000, depart_after: depart }, data);
    if (sErr.length || rErr.length) continue;
    const costs = planner.buildPackages(probe, data, s).packages.filter((p) => p.feasible).map((p) => p.costs.total);
    if (!costs.length) continue;
    const kind = pick(["tight", "normal", "normal", "large"]);
    const lo = Math.min(...costs), hi = Math.max(...costs);
    const budget = Math.round((kind === "tight" ? lo * 0.85 : kind === "large" ? hi * 1.2 : (lo + hi) / 2) / 100) * 100;
    const request = { ...party, game_id: game.game_id, budget, depart_after: depart };
    // Skip a scenario that would ask Aivana the same question as an earlier one (same options, costs, rules)
    const [clean] = planner.validateRequest(request, data);
    const pl = planner.buildPackages(clean, data, s);
    const sig = JSON.stringify([budget, pl.packages.map((p) => [p.option_id, p.costs.total, p.facts.departure,
      [...p.rule_checks, ...(p.policy_checks || [])].map((c) => (c.ok ? 1 : c.priority * 10))])]);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ id: `T${String(out.length + 1).padStart(2, "0")}`, request, settings, budget_kind: kind });
  }
  return out;
}

/** Season setups for the season-explanation part: n different ones (up to 36), same seed -> same list. */
export function makeSeasonSetups(n = 10, seed = 42) {
  const r = rng(seed + 1);
  const all = [];
  for (const budget of [15000, 18000, 20000, 22000, 25000, 30000]) {
    for (const pct of [0, 5, 10]) for (const must of [false, true]) all.push({ budget, pct, must });
  }
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return all.slice(0, n).map((x, i) => ({
    id: `S${String(i + 1).padStart(2, "0")}`,
    settings: { season_travel_budget: x.budget, season_overbudget_pct: x.pct, ...(x.must ? { priority_home_by: 3 } : {}) },
  }));
}

/** Build the code's plan for a scenario (same path as the app). */
export function planFor(data, sc) {
  const [s] = planner.mergeSettings(data.settings, sc.settings);
  const [req] = planner.validateRequest(sc.request, data);
  return { plan: planner.buildPackages(req, data, s), req, s };
}

/** The code's best option: best within budget, else best fit for team rules. */
export const codeBest = (plan) => plan.best_within_budget || plan.best_fit_rules;

// ---------------------------------------------------------------- planted mistakes

/** True text built from the code's own numbers, plus copies with one planted mistake each.
 * Returns { truth, mistakes: [{ kind, text }] }. Every mistake is one the checker must catch. */
export function plantMistakes(plan) {
  const id = codeBest(plan) || plan.packages[0].option_id;
  const p = plan.packages.find((x) => x.option_id === id);
  const total = `$${money(p.costs.total)}`;
  const truth = `Option ${id} costs ${total} and breaks ${p.rules_broken} rule(s).`;
  const facts = [...planner.moneyFacts(plan)];
  let wrong = round(p.costs.total + 137.45, 2);
  while (facts.some((f) => Math.abs(wrong - f) <= 1)) wrong = round(wrong + 111.11, 2);
  const known = planner.timesInPlan(plan);
  let t = 0;
  while (known.has(`${Math.floor(t / 60)}:${t % 60}`)) t += 7; // first clock time not in any schedule or rule
  const h = Math.floor(t / 60), m = t % 60;
  const clock = `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  const ids = new Set(plan.packages.map((x) => x.option_id));
  const fake = [..."ZYXWVUTS"].find((c) => !ids.has(c));
  return { truth, mistakes: [
    { kind: "wrong amount", text: `Option ${id} costs $${money(wrong)} and breaks ${p.rules_broken} rule(s).` },
    { kind: "made-up time", text: `${truth} The bus leaves at ${clock}.` },
    { kind: "option that does not exist", text: `${truth} Option ${fake} is cheaper.` },
    { kind: "wrong rule count", text: `Option ${id} costs ${total} and breaks ${p.rules_broken + 1} rule(s).` },
  ] };
}

const flagged = (r) => r.unverified_numbers.length + r.unverified_claims.length > 0;

/** Code only (no tokens): does the checker pass true text and catch every planted mistake? */
export function checkTheChecker(data, scenarios) {
  const out = { truth_total: 0, truth_passed: 0, planted: 0, caught: 0, missed: [], false_alarms: [] };
  for (const sc of scenarios) {
    const { plan } = planFor(data, sc);
    const { truth, mistakes } = plantMistakes(plan);
    out.truth_total += 1;
    const tr = planner.checkMemoText(truth, plan);
    if (!flagged(tr)) out.truth_passed += 1;
    else out.false_alarms.push({ scenario: sc.id, text: truth, flags: [...tr.unverified_numbers, ...tr.unverified_claims] });
    for (const mk of mistakes) {
      out.planted += 1;
      if (flagged(planner.checkMemoText(mk.text, plan))) out.caught += 1;
      else out.missed.push({ scenario: sc.id, kind: mk.kind, text: mk.text });
    }
  }
  return out;
}

// ---------------------------------------------------------------- running Aivana

const EVAL_APPROVAL = { role: "Travel Coordinator", approved_at: "2027-09-01T09:00", approval_id: "e0a1b2c3" };

/** Calls made for one kind, from the usage counter. */
const callsOf = (usage, kind) => usage?.by_kind?.[kind]?.calls ?? 0;

/**
 * Run the eval. `ai` = { recommend, memoStream, explainSeason } (aiTasks, or a fake in tests).
 * `usage` = the Aivana usage counter (aivana.USAGE) for retries and tokens.
 */
export async function runTrustEval({ data, ai, usage = null, n = 30, seasons = 10, seed = 42, onProgress = null }) {
  const scenarios = makeScenarios(data, n, seed);
  const startUsage = usage ? JSON.parse(JSON.stringify(usage)) : null;
  const answers = [], picks = [];
  const tick = (msg) => onProgress && onProgress(msg);

  for (const sc of scenarios) {
    const { plan, req } = planFor(data, sc);
    const best = codeBest(plan);
    // 1. recommendation
    let before = callsOf(usage, "recommend");
    try {
      const rec = await ai.recommend(plan);
      const text = [rec.headline, rec.explanation].filter(Boolean).join(" ");
      answers.push({ kind: "recommend", scenario: sc.id, ok: !flagged(rec), first_try: callsOf(usage, "recommend") - before <= 1,
        flags: [...rec.unverified_numbers, ...rec.unverified_claims], text });
      picks.push({ scenario: sc.id, aivana: rec.recommended_option_id, code: best, agrees: rec.recommended_option_id === best,
        text });
    } catch (e) {
      answers.push({ kind: "recommend", scenario: sc.id, ok: false, first_try: false, error: e.message, flags: [], text: "" });
      picks.push({ scenario: sc.id, aivana: null, code: best, agrees: false, text: `error: ${e.message}` });
    }
    // 2. memo for the code's best option, with a test approval record (as after approval in the app)
    const pkg = plan.packages.find((p) => p.option_id === best);
    try {
      let memo = "";
      for await (const piece of ai.memoStream(plan, pkg, req, EVAL_APPROVAL)) memo += piece;
      const chk = planner.checkMemoText(memo, plan);
      answers.push({ kind: "memo", scenario: sc.id, ok: !flagged(chk), first_try: true,
        flags: [...chk.unverified_numbers, ...chk.unverified_claims], text: memo });
    } catch (e) {
      answers.push({ kind: "memo", scenario: sc.id, ok: false, first_try: false, error: e.message, flags: [], text: "" });
    }
    tick(`${sc.id} done`);
  }

  for (const st of makeSeasonSetups(seasons, seed)) {
    const [s] = planner.mergeSettings(data.settings, st.settings);
    const overview = planner.seasonOverview(data, s);
    const before = callsOf(usage, "season");
    try {
      const ex = await ai.explainSeason(overview);
      answers.push({ kind: "season", scenario: st.id, ok: !flagged(ex), first_try: callsOf(usage, "season") - before <= 1,
        flags: [...ex.unverified_numbers, ...ex.unverified_claims], text: [ex.headline, ex.explanation].join(" ") });
    } catch (e) {
      answers.push({ kind: "season", scenario: st.id, ok: false, first_try: false, error: e.message, flags: [], text: "" });
    }
    tick(`${st.id} done`);
  }

  const checker = checkTheChecker(data, scenarios);
  const tokens = usage && startUsage ? {
    calls: usage.calls - startUsage.calls,
    input_tokens: usage.input_tokens - startUsage.input_tokens,
    output_tokens: usage.output_tokens - startUsage.output_tokens,
  } : null;
  return { seed, scenarios, answers, picks, checker, tokens, scores: score(answers, picks, checker) };
}

// ---------------------------------------------------------------- scoring and report

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export function score(answers, picks, checker) {
  const by = (k) => answers.filter((a) => a.kind === k);
  const rate = (xs, f) => ({ passed: xs.filter(f).length, total: xs.length, pct: pct(xs.filter(f).length, xs.length) });
  return {
    fact_check: { all: rate(answers, (a) => a.ok), recommend: rate(by("recommend"), (a) => a.ok),
      memo: rate(by("memo"), (a) => a.ok), season: rate(by("season"), (a) => a.ok) },
    agrees: rate(picks, (p) => p.agrees),
    first_try: rate(answers, (a) => a.first_try),
    checker: { caught: checker.caught, planted: checker.planted, pct: pct(checker.caught, checker.planted),
      truth_passed: checker.truth_passed, truth_total: checker.truth_total },
  };
}

export function demoLine(scores, n) {
  const f = scores.fact_check, c = scores.checker;
  return `In ${n} test trips, ${f.all.pct}% of Aivana's answers passed the fact check ` +
    `(recommendations ${f.recommend.pct}%, memos ${f.memo.pct}%, season explanations ${f.season.pct}%), ` +
    `Aivana picked the app's best option ${scores.agrees.passed} of ${scores.agrees.total} times, ` +
    `and the fact checker caught ${c.caught} of ${c.planted} planted mistakes.`;
}

export function report(result, mode) {
  const s = result.scores, n = result.scenarios.length;
  const row = (label, r) => `| ${label} | ${r.passed}/${r.total} | ${r.pct}% |`;
  const lines = [`# Trustworthiness eval (${mode})`, ""];
  if (mode !== "Aivana API") {
    lines.push("> **Offline mock:** the mock writes its text from the code's own facts, so it always scores",
      "> 100%. This is **not** a real measure. Set AIVANA_API_KEY and run again for real numbers.", "");
  }
  lines.push(`Scenarios: ${n} trips + ${result.answers.filter((a) => a.kind === "season").length} season plans. Seed: ${result.seed}.`, "",
    "## Scores", "", "| Score | Result | Rate |", "|---|---|---|",
    row("Fact check: all answers", s.fact_check.all), row("Fact check: recommendations", s.fact_check.recommend),
    row("Fact check: memos", s.fact_check.memo), row("Fact check: season explanations", s.fact_check.season),
    row("Aivana agrees with the code's best option", s.agrees), row("Valid answer on the first try", s.first_try),
    `| Fact checker caught planted mistakes | ${s.checker.caught}/${s.checker.planted} | ${s.checker.pct}% |`,
    `| True text passed the fact checker (no false alarms) | ${s.checker.truth_passed}/${s.checker.truth_total} | ${pct(s.checker.truth_passed, s.checker.truth_total)}% |`,
    "", "## What each test checks, and why", "",
    "| Test | Aim (what it checks) | Purpose (why we do it) |", "|---|---|---|",
    "| Fact check: recommendations | Every amount, time, option and rule count in Aivana's recommendation matches the app's computed numbers. | Staff act on the recommendation, so a made-up price or time could lead to a wrong booking. |",
    "| Fact check: memos | Every fact in the trip memo matches the approved plan (the approval line is skipped, because it comes from the approval record). | The memo goes to coaches and players, so it has to be exactly right. |",
    "| Fact check: season explanations | Every amount Aivana uses to explain the season plan is a real number from the season optimizer. | Season budgets are large sums, so a wrong saving or total could mislead the budget decision. |",
    "| Aivana agrees with the code's best option | Aivana recommends the same option the code ranks best (best within budget, else best fit for team rules). | It shows that Aivana explains the code's decision instead of inventing its own. A disagreement is fine only if Aivana says why, so each one is listed below for review. |",
    "| Valid answer on the first try | Aivana returns a usable answer with no error and no retry. | It measures reliability: how often staff get an answer straight away. |",
    "| Fact checker caught planted mistakes | Wrong amounts, made-up times, fake options and wrong rule counts are put into true text, and the checker must flag each one. | A checker that passes everything would also score 100%. This proves the fact check scores above mean something. |",
    "| True text passed the fact checker | Correct text built from the app's own numbers is not flagged. | It shows that the checker doesn't raise false alarms, which would make staff ignore its warnings. |",
    "| Cost | The number of Aivana calls and tokens used. | It shows what running Aivana costs, so we can plan a budget for real use. |",
    "", "## Cost", "",
    result.tokens ? `${result.tokens.calls} Aivana calls, ${result.tokens.input_tokens} input tokens, ${result.tokens.output_tokens} output tokens` +
      (mode !== "Aivana API" ? " (mock: no tokens used)." : ".") : "Not measured.",
    "", "## Demo line", "", `> ${demoLine(s, n)}`, "", "## Misses", "");
  const fails = result.answers.filter((a) => !a.ok);
  const dis = result.picks.filter((p) => !p.agrees);
  const ch = result.checker;
  if (!fails.length && !dis.length && !ch.missed.length && !ch.false_alarms.length) lines.push("- None");
  for (const a of fails) {
    lines.push(`- **${a.scenario} ${a.kind}:** ${a.error ? `error: ${a.error}` : `flagged ${a.flags.map((x) => `\`${x}\``).join(", ")}`}`);
    if (a.text) lines.push(`  - Text: ${a.text.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  for (const p of dis) lines.push(`- **${p.scenario} pick:** Aivana picked ${p.aivana ?? "nothing"}, code's best is ${p.code}. ${p.text.replace(/\s+/g, " ").slice(0, 300)}`);
  for (const m of ch.missed) lines.push(`- **${m.scenario} fact checker missed a ${m.kind}:** ${m.text}`);
  for (const f of ch.false_alarms) lines.push(`- **${f.scenario} false alarm on true text:** ${f.text} (flagged ${f.flags.join(", ")})`);
  lines.push("", "## Scenarios", "", "| ID | Game | Party | Budget | Leave after | Settings |", "|---|---|---|---|---|---|");
  for (const sc of result.scenarios) {
    const r = sc.request;
    lines.push(`| ${sc.id} | ${r.game_id} | ${r.num_players}+${r.num_coaches}+${r.num_staff} | $${money(r.budget)} (${sc.budget_kind}) | ${r.depart_after} | ${JSON.stringify(sc.settings)} |`);
  }
  return lines.join("\n") + "\n";
}

