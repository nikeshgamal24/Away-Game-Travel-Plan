// Feature 8: schedule import. Rules, routes, save/reset, the personal-details check on answers, and file checks.
// Synthetic data only: the sample's fictional games and the synthetic fixture image. Run: npm test
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const IMPORTED = join(tmpdir(), `schedule-imported-test-${process.pid}.json`);
process.env.AIVANA_MOCK = "1";
process.env.SCHEDULE_IMPORTED_FILE = IMPORTED;
process.env.APPROVALS_FILE = join(tmpdir(), `approvals-sched-test-${process.pid}.json`);
rmSync(IMPORTED, { force: true });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { app, DATA, _reloadSchedule } = await import("../server.js");
const aivana = await import("../src/aivana.js");
const aiTasks = await import("../src/aiTasks.js");
const rules = await import("../static/scheduleRules.js");

let base;
before(() => new Promise((r) => app.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${app.address().port}`; r(); })));
after(() => new Promise((r) => {
  rmSync(IMPORTED, { force: true });
  rmSync(process.env.APPROVALS_FILE, { force: true });
  app.close(r);
}));

async function post(path, body) {
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const getBoot = async () => (await fetch(base + "/api/bootstrap")).json();

/** A fully valid row (Lakeview State from the sample), with overrides. */
const row = (o = {}) => ({ home_away: "away", opponent: "Lakeview State", city: "Lakeview", stadium: "Lakeview Soccer Park",
  year: 2027, month: 9, day: 19, kickoff: "13:00", miles: 210, drive_hours: 4, unclear: [], ...o });
const problems = (r) => rules.checkRows([r])[0].problems;

// ---------------------------------------------------------------- rules (shared with the browser)
describe("row rules", () => {
  test("a complete row is valid", () => assert.deepEqual(problems(row()), {}));
  test("missing year is invalid with its own reason", () => {
    assert.equal(problems(row({ year: null })).year, "Year not shown. Type the year.");
  });
  test("a date that doesn't exist is invalid", () => {
    assert.equal(problems(row({ month: 2, day: 30 })).day, "Date unclear.");
    assert.equal(problems(row({ month: null })).month, "Date unclear.");
    assert.equal(problems(row({ year: 2027, month: 2, day: 29 })).year, "Date unclear."); // not a leap year
    assert.deepEqual(problems(row({ year: 2028, month: 2, day: 29 })), {});
  });
  test("a field Aivana marked unclear is invalid until staff edit it", () => {
    assert.equal(problems(row({ unclear: ["stadium"] })).stadium, "Hard to read. Check this.");
  });
  test("kickoff, home/away, text and numbers", () => {
    assert.equal(problems(row({ kickoff: null })).kickoff, "Kickoff missing. Type HH:MM.");
    assert.equal(problems(row({ kickoff: "7 PM" })).kickoff, "Kickoff missing. Type HH:MM.");
    assert.equal(problems(row({ home_away: "unclear" })).home_away, "Home or away? Pick one.");
    assert.equal(problems(row({ city: "  " })).city, "Required.");
    assert.equal(problems(row({ miles: 0 })).miles, "Required.");
    assert.equal(problems(row({ drive_hours: null })).drive_hours, "Required.");
    assert.deepEqual(problems(row({ kickoff: "9:05" })), {});
  });
  test("a home game is skipped, not checked", () => {
    const [c] = rules.checkRows([row({ home_away: "home", city: null, year: null, miles: null })]);
    assert.equal(c.skipped, true);
    assert.deepEqual(c.problems, {});
  });
  test("the same opponent on the same date twice is a duplicate", () => {
    const c = rules.checkRows([row(), row({ opponent: "lakeview state " })]);
    assert.equal(c[0].problems.opponent, "Duplicate game.");
    assert.equal(c[1].problems.opponent, "Duplicate game.");
  });
  test("saved games: date order, IDs G01…, no home games, no as_printed or unclear", () => {
    const games = rules.toSavedGames([
      row({ opponent: "Harbor City Tech", month: 10, day: 16, as_printed: "x" }),
      row({ home_away: "home", opponent: "Northfield State" }),
      row({ kickoff: "9:00" }),
    ]);
    assert.deepEqual(games.map((g) => [g.game_id, g.opponent, g.date, g.kickoff]),
      [["G01", "Lakeview State", "2027-09-19", "09:00"], ["G02", "Harbor City Tech", "2027-10-16", "13:00"]]);
    assert.ok(games.every((g) => !("as_printed" in g) && !("unclear" in g) && !("home_away" in g)));
  });
});

// ---------------------------------------------------------------- read (text)
describe("read a pasted schedule", () => {
  beforeEach(() => aiTasks._clearCache());
  test("mock mode works offline and shows the row with no year as invalid", async () => {
    const r = await post("/api/schedule/read", { text: "Sep 19 at Lakeview State 1:00 PM" });
    assert.equal(r.status, 200);
    assert.equal(r.json.mock, true);
    assert.equal(r.json.rows.length, 4);
    assert.equal(r.json.rows[1].year, null);
    assert.equal(r.json.checks[1].problems.year, "Year not shown. Type the year.");
    assert.equal(r.json.checks[2].problems.kickoff, "Hard to read. Check this.");
    assert.equal(r.json.checks[0].problems.miles, "Required."); // staff always type miles
  });
  test("too short, too long, and personal details in the text are refused before any call", async () => {
    const before = aivana.USAGE.calls;
    assert.equal((await post("/api/schedule/read", { text: "hi" })).status, 400);
    assert.equal((await post("/api/schedule/read", { text: "x".repeat(5001) })).status, 400);
    const r = await post("/api/schedule/read", { text: "Sep 19 at Lakeview State, call 419-555-0100" });
    assert.deepEqual([r.status, r.json.code], [400, "personal_details"]);
    assert.equal(aivana.USAGE.calls, before);
  });
});

// ---------------------------------------------------------------- answers from Aivana (fake transport)
describe("Aivana's answer (fake transport)", () => {
  const json = (status, body) => new Response(JSON.stringify(body), { status });
  let sent;
  function useFake(responses) {
    sent = [];
    aivana._setTransport({ fetch: async (url, init) => { sent.push(JSON.parse(init.body)); return responses.shift(); }, sleep: async () => {} });
  }
  const answer = (games) => json(200, { structured: { games, notes: [] }, usage: { input_tokens: 9, output_tokens: 0 } });
  const game = (o = {}) => ({ opponent: "Lakeview State", home_away: "away", city: "Lakeview", stadium: "Lakeview Soccer Park",
    year: 2027, month: 9, day: 19, kickoff: "13:00", miles: null, drive_hours: null,
    as_printed: "Sun, Sep 19, 2027 at Lakeview State 1:00 PM", unclear: [], ...o });
  before(() => { process.env.AIVANA_MOCK = "0"; process.env.AIVANA_API_KEY = "test-key-not-real"; });
  after(() => {
    process.env.AIVANA_MOCK = "1"; delete process.env.AIVANA_API_KEY;
    aivana._setTransport({ fetch: (...a) => fetch(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  });
  beforeEach(() => aiTasks._clearCache());

  test("text: one call with the schedule schema; TBA becomes an empty kickoff", async () => {
    useFake([answer([game({ kickoff: "TBA" })])]);
    const r = await post("/api/schedule/read", { text: "Sun, Sep 19, 2027 at Lakeview State TBA" });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].response_format.type, "json_schema");
    assert.ok(sent[0].response_format.schema.properties.games);
    assert.equal(sent[0].attachments, undefined);
    assert.equal(r.json.rows[0].kickoff, null);
    assert.equal(r.json.checks[0].problems.kickoff, "Kickoff missing. Type HH:MM.");
  });
  test("miles and drive hours: filled when the line shows them, null when it doesn't", async () => {
    const text = "Sun, Sep 19, 2027 at Lakeview State 1:00 PM 56 mi 1.2 hrs\nTue, Oct 5, 2027 at Riverbend University 7:00 PM";
    useFake([answer([
      game({ miles: 56, drive_hours: 1.2 }),
      game({ opponent: "Riverbend University", city: "Riverbend", stadium: "Riverbend Field", month: 10, day: 5, kickoff: "19:00",
        miles: null, drive_hours: null }),
    ])]);
    const r = await post("/api/schedule/read", { text });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.rows[0].miles, r.json.rows[0].drive_hours], [56, 1.2]);
    assert.equal(r.json.checks[0].problems.miles, undefined);
    assert.equal(r.json.checks[0].problems.drive_hours, undefined);
    assert.deepEqual([r.json.rows[1].miles, r.json.rows[1].drive_hours], [null, null]);
    assert.equal(r.json.checks[1].problems.miles, "Required.");
    assert.equal(r.json.checks[1].problems.drive_hours, "Required.");
    // The schema and prompt carry the rule.
    const item = sent[0].response_format.schema.properties.games.items;
    assert.ok(item.required.includes("miles") && item.required.includes("drive_hours"));
    assert.deepEqual(item.properties.miles.type, ["number", "null"]);
    assert.match(sent[0].system, /Never estimate a distance or a travel time/);
  });
  test("an estimated distance that isn't in the pasted text is emptied by the code", async () => {
    const text = "Tue, Oct 5, 2027 at Riverbend University 7:00 PM";
    useFake([answer([game({ opponent: "Riverbend University", month: 10, day: 5, kickoff: "19:00", miles: 95, drive_hours: 2 })])]);
    const r = await post("/api/schedule/read", { text });
    assert.deepEqual([r.json.rows[0].miles, r.json.rows[0].drive_hours], [null, null]);
    assert.ok(r.json.notes.some((n) => n.includes("weren't in the pasted text")));
  });
  test("zero or negative distance from Aivana becomes empty (Required.)", async () => {
    useFake([answer([game({ miles: 0, drive_hours: -1 })])]);
    const r = await post("/api/schedule/read", { text: "Sun, Sep 19, 2027 at Lakeview State 0 mi -1 hrs" });
    assert.deepEqual([r.json.rows[0].miles, r.json.rows[0].drive_hours], [null, null]);
    assert.equal(r.json.checks[0].problems.miles, "Required.");
  });
  test("personal details anywhere in the answer: refused, and nothing is cached", async () => {
    for (const bad of [{ as_printed: "Sep 19 at Lakeview State. Tickets: 419-555-0100" }, { stadium: "Coach Miller Field" }]) {
      aiTasks._clearCache();
      useFake([answer([game(bad)]), answer([game(bad)])]);
      const text = "Sun, Sep 19, 2027 at Lakeview State 1 PM";
      const r = await post("/api/schedule/read", { text });
      assert.deepEqual([r.status, r.json.code], [400, "personal_details"]);
      assert.ok(!JSON.stringify(r.json).includes("419-555"));
      await post("/api/schedule/read", { text });
      assert.equal(sent.length, 2, "a refused answer must not be cached");
    }
  });
  test("notes are checked too", async () => {
    useFake([json(200, { structured: { games: [game()], notes: ["Contact a.b@example.com for times"] } })]);
    assert.equal((await post("/api/schedule/read", { text: "Sun, Sep 19, 2027 at Lakeview State" })).json.code, "personal_details");
  });
  test("the same text twice makes one call", async () => {
    useFake([answer([game()])]);
    const text = "Sun, Sep 19, 2027 at Lakeview State 1:00 PM";
    assert.equal((await post("/api/schedule/read", { text })).status, 200);
    assert.equal((await post("/api/schedule/read", { text })).status, 200);
    assert.equal(sent.length, 1);
  });
  test("no games read -> a clear message", async () => {
    useFake([answer([])]);
    const r = await post("/api/schedule/read", { text: "Nothing here but words about soccer." });
    assert.deepEqual([r.status, r.json.code], [400, "no_games"]);
  });
});

// ---------------------------------------------------------------- save, load, reset
describe("save, load and reset", () => {
  const SAMPLE_FILE = join(ROOT, "data", "schedule.json");
  const sampleBefore = readFileSync(SAMPLE_FILE, "utf8");
  const valid = () => [
    row({ opponent: "Harbor City Tech", city: "Harbor City", stadium: "Harbor City Stadium", month: 10, day: 16, kickoff: "19:00",
      miles: 520, drive_hours: 9.5, as_printed: "Oct 16 at Harbor City Tech" }),
    row({ home_away: "home", opponent: "Northfield State", city: null, stadium: null }),
    row({ as_printed: "Sep 19 at Lakeview State" }),
  ];
  beforeEach(async () => { await post("/api/schedule/reset", {}); });

  test("save needs the confirm box", async () => {
    assert.equal((await post("/api/schedule/save", { rows: valid() })).status, 400);
    assert.equal(existsSync(IMPORTED), false);
  });
  test("any invalid row -> 400 listing the rows, and nothing is written", async () => {
    const rows = valid(); rows[2].year = null;
    const r = await post("/api/schedule/save", { rows, confirm: true });
    assert.equal(r.status, 400);
    assert.ok(r.json.errors.some((e) => e.startsWith("Row 3 year")));
    assert.equal(existsSync(IMPORTED), false);
  });
  test("a valid save writes the imported file only, in date order, without home games or as_printed", async () => {
    const r = await post("/api/schedule/save", { rows: valid(), confirm: true });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.saved, r.json.skipped_home, r.json.schedule.source], [2, 1, "imported"]);
    const saved = JSON.parse(readFileSync(IMPORTED, "utf8"));
    assert.deepEqual(saved.games.map((g) => `${g.game_id} ${g.opponent} ${g.date}`),
      ["G01 Lakeview State 2027-09-19", "G02 Harbor City Tech 2027-10-16"]);
    assert.ok(!readFileSync(IMPORTED, "utf8").includes("as_printed"));
    assert.equal(readFileSync(SAMPLE_FILE, "utf8"), sampleBefore, "the sample schedule is never changed");
    const boot = await getBoot();
    assert.equal(boot.schedule.source, "imported");
    assert.deepEqual(boot.games.map((g) => g.game_id), ["G01", "G02"]);
  });
  test("reset deletes the imported file and brings the sample back; reset with none is fine", async () => {
    await post("/api/schedule/save", { rows: valid(), confirm: true });
    let r = await post("/api/schedule/reset", {});
    assert.equal(r.json.schedule.source, "sample");
    assert.equal(existsSync(IMPORTED), false);
    assert.deepEqual((await getBoot()).games.map((g) => g.game_id), ["G06", "G07", "G08", "G09"]);
    r = await post("/api/schedule/reset", {});
    assert.equal(r.status, 200);
  });
  test("startup: uses the imported file if present, the sample if not, and the sample plus a warning if it's broken", async () => {
    await post("/api/schedule/save", { rows: valid(), confirm: true });
    _reloadSchedule();
    assert.equal((await getBoot()).schedule.source, "imported");
    writeFileSync(IMPORTED, "{ not json");
    _reloadSchedule();
    let boot = await getBoot();
    assert.equal(boot.schedule.source, "sample");
    assert.match(boot.schedule.warning, /couldn't be read/);
    writeFileSync(IMPORTED, JSON.stringify({ games: [{ game_id: "G01", opponent: "X" }] })); // missing fields
    _reloadSchedule();
    assert.equal((await getBoot()).schedule.source, "sample");
    rmSync(IMPORTED, { force: true });
    _reloadSchedule();
    boot = await getBoot();
    assert.deepEqual([boot.schedule.source, boot.schedule.warning], ["sample", ""]);
  });
  test("changing a game's kickoff after approval makes the approval out of date (409)", async () => {
    await post("/api/schedule/save", { rows: valid(), confirm: true });
    const req = { game_id: "G01", num_players: 22, num_coaches: 4, num_staff: 3, budget: 6000, depart_after: "2027-09-18T12:00" };
    const d = (await post("/api/plan", { request: req })).json;
    const pkg = d.plan.packages.find((p) => p.option_id === "B");
    const acks = (await post("/api/details", { request: req, option_id: "B" })).json?.required_acks ?? [];
    const ap = await post("/api/approve", { request: req, option_id: "B", role: "Head Coach", acknowledged: acks });
    assert.equal(ap.status, 200, JSON.stringify(ap.json));
    const aid = ap.json.approval.approval_id;
    assert.equal((await post("/api/final", { request: req, option_id: "B", approval_id: aid })).status, 200);
    const moved = valid(); moved[2].kickoff = "15:00";
    await post("/api/schedule/save", { rows: moved, confirm: true });
    const r = await post("/api/final", { request: req, option_id: "B", approval_id: aid });
    assert.deepEqual([r.status, r.json.code], [409, "approval_stale"]);
    assert.ok(pkg);
  });
  test("a reused game ID never picks up another game's flight fare", async () => {
    // Nine games so the ninth gets ID G09, the sample's Harbor City Tech fare ID, but it's a different opponent.
    const rows = Array.from({ length: 9 }, (_, i) => row({ opponent: `Team ${i + 1}`, month: 9, day: i + 1,
      miles: 600, drive_hours: 10 }));
    assert.equal((await post("/api/schedule/save", { rows, confirm: true })).status, 200);
    assert.equal(DATA.schedule.games[8].game_id, "G09");
    const req = { game_id: "G09", num_players: 22, num_coaches: 4, num_staff: 3, budget: 20000, depart_after: "2027-09-07T12:00" };
    const plan = (await post("/api/plan", { request: req })).json.plan;
    assert.ok(plan.packages.every((p) => p.mode !== "flight" && !/fl(y|ight)/i.test(p.name)), plan.packages.map((p) => p.name).join(", "));
  });
});
