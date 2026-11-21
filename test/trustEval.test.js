// Tests for the trustworthiness eval (spec 04). No AI: a fake Aivana is used. Run: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as planner from "../src/planner.js";
import * as trust from "../src/trustEval.js";
import { money } from "../src/util.js";

const DATA = planner.loadData();

describe("trust eval scenarios", () => {
  test("same seed gives the same scenarios; another seed gives different ones", () => {
    assert.deepEqual(trust.makeScenarios(DATA, 30, 42), trust.makeScenarios(DATA, 30, 42));
    assert.notDeepEqual(trust.makeScenarios(DATA, 30, 42), trust.makeScenarios(DATA, 30, 7));
  });
  test("30 valid, different scenarios across every game", () => {
    const sc = trust.makeScenarios(DATA, 30, 42);
    assert.equal(sc.length, 30);
    assert.deepEqual([...new Set(sc.map((x) => x.request.game_id))].sort(), ["G06", "G07", "G08", "G09"]);
    for (const x of sc) {
      const [, errors] = planner.validateRequest(x.request, DATA);
      assert.deepEqual(errors, [], x.id);
      assert.ok(trust.planFor(DATA, x).plan.packages.some((p) => p.feasible), x.id);
    }
    assert.equal(new Set(trust.makeSeasonSetups(10).map((x) => JSON.stringify(x.settings))).size, 10);
  });
  test("--n 5 makes 5 scenarios", () => assert.equal(trust.makeScenarios(DATA, 5, 42).length, 5));
});

describe("fact checker vs planted mistakes", () => {
  test("every planted mistake is caught and true text passes", () => {
    const r = trust.checkTheChecker(DATA, trust.makeScenarios(DATA, 30, 42));
    assert.deepEqual([r.caught, r.planted, r.truth_passed], [120, 120, 30]);
    assert.deepEqual(r.missed, []);
  });
  test("memo check skips only the approval line", () => {
    const { plan } = trust.planFor(DATA, trust.makeScenarios(DATA, 1, 42)[0]);
    const line = "Approved by Travel Coordinator on Wed 9:00 AM (approval e0a1b2c3)";
    assert.deepEqual(planner.checkMemoText(line, plan), { unverified_numbers: [], unverified_claims: [] });
    assert.equal(planner.checkMemoText("Leave at 4:17 AM.", plan).unverified_claims.length, 1);
  });
});

describe("scoring with a fake Aivana", () => {
  // One different pick and one memo with a wrong amount; everything else is correct.
  function fakeAi() {
    let disagreed = false, memos = 0;
    return {
      async recommend(plan) {
        const best = trust.codeBest(plan);
        const other = plan.packages.find((p) => p.feasible && p.option_id !== best);
        const id = !disagreed && other ? (disagreed = true, other.option_id) : best;
        const text = `Go with option ${id}.`;
        return { recommended_option_id: id, headline: text, explanation: "",
          unverified_numbers: planner.checkNumbers(text, plan), unverified_claims: planner.checkClaims(text, plan) };
      },
      async *memoStream(plan, pkg) {
        memos += 1;
        yield memos === 3 ? "Total $99,999.99." : `Total $${money(pkg.costs.total)}.`;
      },
      async explainSeason() { return { headline: "Season plan.", explanation: "", unverified_numbers: [], unverified_claims: [] }; },
    };
  }

  test("counts exactly one fact-check miss and one disagreement", async () => {
    const r = await trust.runTrustEval({ data: DATA, ai: fakeAi(), n: 8, seasons: 2 });
    const s = r.scores;
    assert.deepEqual([s.fact_check.memo.passed, s.fact_check.memo.total], [7, 8]);
    assert.deepEqual([s.fact_check.recommend.passed, s.fact_check.season.passed], [8, 2]);
    assert.deepEqual([s.agrees.passed, s.agrees.total], [7, 8]);
    assert.equal(s.fact_check.all.total, 18);
    const md = trust.report(r, "offline mock");
    assert.ok(md.includes("`$99,999.99`"));
    assert.ok(md.includes("not** a real measure"));
    assert.ok(trust.demoLine(s, 8).includes("picked the app's best option 7 of 8 times"));
  });
  test("an Aivana error counts as a failed answer, not a crash", async () => {
    const ai = { ...fakeAi(), async recommend() { throw new Error("rate limited"); } };
    const r = await trust.runTrustEval({ data: DATA, ai, n: 2, seasons: 0 });
    assert.equal(r.scores.fact_check.recommend.passed, 0);
    assert.equal(r.scores.first_try.passed, 2); // the two memos
    assert.ok(trust.report(r, "Aivana API").includes("error: rate limited"));
  });
});
