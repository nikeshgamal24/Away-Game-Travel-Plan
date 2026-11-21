// API tests in mock mode, plus error handling with a fake Aivana. Run: npm test
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.AIVANA_MOCK = "1";
process.env.SCHEDULE_IMPORTED_FILE = join(tmpdir(), `schedule-imported-none-${process.pid}.json`); // never a local import
process.env.APPROVALS_FILE = join(tmpdir(), `approvals-test-${process.pid}.json`); // keep test approvals out of the app

const { app } = await import("../server.js");
const aivana = await import("../src/aivana.js");

const REQ = { game_id: "G07", num_players: 22, num_coaches: 4, num_staff: 3, budget: 6000, depart_after: "2027-09-18T12:00" };
let base;
before(() => new Promise((r) => app.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${app.address().port}`; r(); })));
after(() => new Promise((r) => app.close(r)));

async function post(path, body) {
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* text response */ }
  return { status: res.status, json, text };
}

describe("routes", () => {
  test("parse the sample request", async () => {
    const r = await post("/api/parse", { text: "Sunday at Lakeview State. 22 players, 4 coaches, 3 staff. Leave after noon Saturday. Budget $6,000." });
    assert.equal(r.json.request.game_id, "G07");
    assert.equal(r.json.request.depart_after, "2027-09-18T12:00");
  });
  test("plan uses rule levels from settings", async () => {
    const req = { game_id: "G09", num_players: 22, num_coaches: 4, num_staff: 3, budget: 15000, depart_after: "2027-10-15T12:00" };
    assert.equal((await post("/api/plan", { request: req })).json.plan.best_fit_rules, "D");
    const r = await post("/api/plan", { request: req, settings: { priority_home_by: 3 } });
    assert.equal(r.json.plan.best_fit_rules, "E");
    assert.equal((await post("/api/plan", { request: req, settings: { priority_home_by: 9 } })).status, 400);
  });
  test("Aivana sees each broken rule's level", async () => {
    const req = { game_id: "G09", num_players: 22, num_coaches: 4, num_staff: 3, budget: 15000, depart_after: "2027-10-15T12:00" };
    const rec = (await post("/api/recommend", { request: req, settings: { priority_home_by: 3 } })).json.recommendation;
    assert.deepEqual(rec.unverified_numbers, []);
    assert.deepEqual(rec.unverified_claims, []);
    assert.ok(rec.explanation.includes("(must-have)") || rec.recommended_option_id === "E");
  });
  test("season plan and Aivana's season explanation", async () => {
    const settings = { priority_home_by: 3, season_travel_budget: 25000 };
    const o = (await post("/api/season", { settings })).json;
    assert.equal(o.optimizer.plan.picks.map((p) => p.option_id).join(""), "AAAE");
    const r = (await post("/api/season/explain", { settings })).json;
    assert.ok(r.explanation.explanation.includes("Lakeview State: B → A"));
    assert.deepEqual(r.explanation.unverified_numbers, []);
    assert.deepEqual(r.explanation.unverified_claims, []);
    assert.equal((await post("/api/season/explain", { settings: { season_overbudget_pct: 99 } })).status, 400);
  });
  test("parse rejects text that is too short", async () => assert.equal((await post("/api/parse", { text: "hi" })).status, 400));
  test("personal details are stopped before they reach Aivana", async () => {
    for (const text of ["Lakeview State, 22 players, Coach Smith drives, budget $6,000",
      "Lakeview State, 22 players, one is injured, budget $6,000",
      "Lakeview State, 22 players, email me at a.b@example.com"]) {
      const r = await post("/api/parse", { text });
      assert.equal(r.status, 400, text);
      assert.equal(r.json.code, "personal_details");
    }
    const w = await post("/api/whatif", { request: REQ, settings: {}, history: [], message: "leave Player Jones home, he is sick" });
    assert.equal(w.status, 400);
    // Ordinary requests (opponent names, "3 staff. Budget") pass
    assert.equal((await post("/api/parse", { text: "Sunday at Lakeview State. 22 players, 4 coaches, 3 staff. Budget $6,000." })).status, 200);
  });
  test("parse fills the assumed departure and lists the schedule when no game matches", async () => {
    const a = (await post("/api/parse", { text: "Harbor City trip, 20 players, budget 12k" })).json;
    assert.ok(a.request.depart_after);
    assert.deepEqual(a.assumed, ["depart_after"]);
    const b = (await post("/api/parse", { text: "We play at Ohio State on Friday, 22 players" })).json;
    assert.equal(b.request.game_id, null);
    assert.ok(b.notes[0].includes("Lakeview State"));
  });
  test("recommendation uses a real option and passes the fact check", async () => {
    const rec = (await post("/api/recommend", { request: REQ })).json.recommendation;
    assert.ok(["A", "B", "C"].includes(rec.recommended_option_id));
    assert.deepEqual(rec.unverified_numbers, []);
    assert.deepEqual(rec.unverified_claims, []);
  });
  test("what-if recomputes in code", async () => {
    const out = (await post("/api/whatif", { request: REQ, settings: {}, history: [],
      message: "leave 2 players home, coaches two to a room" })).json;
    assert.equal(out.changes.find((c) => c.option_id === "B").after, 5925.6);
  });
  test("details with a staff choice", async () => {
    const out = (await post("/api/details", { request: REQ, option_id: "B", custom: { option_id: "B", hotel_id: "H2" } })).json;
    assert.equal(out.package.hotel.hotel_id, "H2");
    assert.equal(out.choices.hotels.length, 3);
  });
  test("bad staff choice rejected", async () => {
    assert.equal((await post("/api/details", { request: REQ, option_id: "B", custom: { option_id: "B", hotel_id: "H3" } })).status, 400);
  });
  test("chat hotel switch becomes a staff choice", async () => {
    const out = (await post("/api/whatif", { request: REQ, settings: {}, history: [], selected: "B", message: "switch to Stadium Suites" })).json;
    assert.equal(out.custom.hotel_id, "H2");
    assert.equal(out.changes.find((c) => c.option_id === "B").after, 7607.2);
  });
  test("chat departure change", async () => {
    const out = (await post("/api/whatif", { request: REQ, settings: {}, history: [], message: "leave Saturday at 3 pm" })).json;
    assert.equal(out.request.depart_after, "2027-09-18T15:00");
  });
  test("chat answers questions from the current options", async () => {
    const out = (await post("/api/whatif", { request: REQ, settings: {}, history: [], change_log: ["chat: leave 2 players home"],
      message: "why is B over budget?" })).json;
    assert.deepEqual(out.applied, []);
    assert.ok(out.reply.includes("$6,567.20"));
    assert.deepEqual(out.unverified_claims, []);
  });
  test("bad request rejected", async () => {
    const r = await post("/api/plan", { request: { game_id: "G07", num_players: -3 } });
    assert.equal(r.status, 400);
    assert.ok(r.json.errors.length);
  });
});

describe("approval gate", () => {
  async function approve(option = "B", req = REQ) {
    const d = (await post("/api/details", { request: req, option_id: option })).json;
    const out = (await post("/api/approve", { request: req, option_id: option, role: "Head Coach", acknowledged: d.required_acks })).json;
    return out.approval.approval_id;
  }
  test("final plan, memo and .ics require approval", async () => {
    for (const p of ["/api/memo", "/api/ics", "/api/final"]) assert.equal((await post(p, { request: REQ, option_id: "B" })).status, 403);
  });
  test("approval needs a role and every acknowledgement", async () => {
    let r = await post("/api/approve", { request: REQ, option_id: "A", role: "Head Coach", acknowledged: [] });
    assert.equal(r.status, 400);
    assert.equal(r.json.errors.length, 2); // two broken team rules
    r = await post("/api/approve", { request: REQ, option_id: "A", role: "Someone", acknowledged: [] });
    assert.equal(r.status, 400);
  });
  test("memo streams after approval", async () => {
    const aid = await approve("B");
    const r = await post("/api/memo", { request: REQ, option_id: "B", approval_id: aid });
    assert.ok(r.text.includes("Approved by Head Coach"));
    assert.ok(r.text.includes("Costs are estimates"));
  });
  test("memo PDF: only for an approved, unchanged plan", async () => {
    const text = "BGSU TRIP MEMO\nOverview\n- Option B";
    assert.equal((await post("/api/memo/pdf", { request: REQ, option_id: "B", text })).status, 403);
    const aid = await approve("B");
    const res = await fetch(base + "/api/memo/pdf", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: REQ, option_id: "B", approval_id: aid, text }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.match(res.headers.get("content-disposition"), /bgsu-trip-memo-G07-B\.pdf/);
    assert.ok(Buffer.from(await res.arrayBuffer()).toString("latin1").startsWith("%PDF-"));
    assert.equal((await post("/api/memo/pdf", { request: REQ, option_id: "B", approval_id: aid, text: " " })).status, 400);
    const r = await post("/api/memo/pdf", { request: { ...REQ, num_players: 20 }, option_id: "B", approval_id: aid, text });
    assert.deepEqual([r.status, r.json.code], [409, "approval_stale"]);
  });
  test("any change after approval is rejected", async () => {
    const aid = await approve("B");
    let r = await post("/api/memo", { request: { ...REQ, num_players: 20 }, option_id: "B", approval_id: aid });
    assert.deepEqual([r.status, r.json.code], [409, "approval_stale"]);
    r = await post("/api/final", { request: REQ, option_id: "B", approval_id: aid, custom: { option_id: "B", hotel_id: "H2" } });
    assert.equal(r.status, 409);
    r = await post("/api/final", { request: REQ, option_id: "B", approval_id: aid, settings: { meal_allowance: 20 } });
    assert.equal(r.status, 409);
  });
  test("changing a rule level after approval makes the approval out of date", async () => {
    const aid = await approve("B");
    const r = await post("/api/final", { request: REQ, option_id: "B", approval_id: aid, settings: { priority_home_by: 3 } });
    assert.deepEqual([r.status, r.json.code], [409, "approval_stale"]);
  });
  test("final plan includes the expense-report deadline", async () => {
    const aid = await approve("B");
    const r = await post("/api/final", { request: REQ, option_id: "B", approval_id: aid });
    assert.equal(r.json.expense_report.due_date, "2027-12-18");
  });
  test("budget vs actual", async () => {
    const aid = await approve("B");
    const r = await post("/api/actuals", { request: REQ, option_id: "B", approval_id: aid,
      actuals: { transport: 2350, lodging: 2400, meals: 1300, extras: 450 } });
    assert.equal(r.json.actual_total, 6500);
    assert.equal(r.json.variance_total, -67.2);
    assert.equal((await post("/api/actuals", { request: REQ, option_id: "B", approval_id: aid, actuals: { transport: -1 } })).status, 400);
  });
});

describe("Aivana errors (fake transport)", () => {
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
  let calls;
  function useFake(responses) {
    calls = [];
    aivana._setTransport({ fetch: async (url, init) => { calls.push({ url, init }); return responses.shift(); }, sleep: async () => {} });
  }
  before(() => { process.env.AIVANA_MOCK = "0"; process.env.AIVANA_API_KEY = "test-key-not-real"; });
  after(() => {
    process.env.AIVANA_MOCK = "1";
    delete process.env.AIVANA_API_KEY;
    aivana._setTransport({ fetch: (...a) => fetch(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  });

  test("retries 429, then succeeds", async () => {
    useFake([json(429, { error: { code: "rate_limit_exceeded", retry_after_ms: 10 } }, { "Retry-After": "0" }),
      json(200, { structured: { ok: true }, usage: { input_tokens: 5, output_tokens: 2 } })]);
    const out = await aivana.structured({ system: "s", messages: [{ role: "user", content: "x" }], schema: {} });
    assert.deepEqual(out, { ok: true });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.headers["X-API-Key"], "test-key-not-real");
    assert.equal(JSON.parse(calls[1].init.body).response_format.type, "json_schema");
  });
  test("empty balance is not retried", async () => {
    useFake([json(402, { error: { code: "insufficient_credit", request_id: "r1" } })]);
    await assert.rejects(aivana.structured({ system: "s", messages: [], schema: {} }),
      (e) => e instanceof aivana.AivanaError && e.message.includes("credit") && e.requestId === "r1");
    assert.equal(calls.length, 1);
  });
  test("invalid answer is retried once with feedback", async () => {
    useFake([json(200, { structured: { pick: "Z" } }), json(200, { structured: { pick: "A" } })]);
    const validate = (o) => { if (!["A", "B"].includes(o.pick)) throw new aivana.InvalidAnswer("pick must be A or B"); };
    const out = await aivana.structured({ system: "s", messages: [{ role: "user", content: "x" }], schema: {}, validate });
    assert.equal(out.pick, "A");
    assert.ok(JSON.parse(calls[1].init.body).messages.at(-1).content.includes("invalid"));
  });
  test("streaming reads delta and done events", async () => {
    const sse = "event: delta\ndata: {\"text\":\"Hello \"}\n\nevent: delta\ndata: {\"text\":\"team\"}\n\nevent: done\ndata: {\"usage\":{\"input_tokens\":3,\"output_tokens\":2}}\n\n";
    useFake([new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } })]);
    let text = "";
    for await (const piece of aivana.stream({ system: "s", messages: [{ role: "user", content: "x" }] })) text += piece;
    assert.equal(text, "Hello team");
    assert.ok(calls[0].url.endsWith("/generate:stream"));
  });
  test("route returns a friendly error", async () => {
    useFake([json(401, { error: { message: "bad key" } })]);
    const r = await post("/api/recommend", { request: { ...REQ, budget: 6001 } }); // new input, so no cached answer
    assert.ok(r.status >= 500);
    assert.ok(r.json.error.includes("API key"));
  });
});
