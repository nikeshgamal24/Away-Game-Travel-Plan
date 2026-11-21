// Feature 7: web hotel search, link checks, staff confirmation and "Which hotel?". Run: npm test
// No real internet and no real Aivana: fetch and DNS are faked.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";

process.env.AIVANA_MOCK = "1";
process.env.APPROVALS_FILE = join(tmpdir(), `approvals-web-${process.pid}.json`);
process.env.WEB_CACHE_DIR = mkdtempSync(join(tmpdir(), "web-cache-"));

const { app, DATA } = await import("../server.js");
const aivana = await import("../src/aivana.js");
const aiTasks = await import("../src/aiTasks.js");
const { verifySource, numbersIn, milesIn, isPrivateAddress, rateOnPage } = await import("../src/webCheck.js");
const web = await import("../src/webHotels.js");

const REQ = { game_id: "G09", num_players: 22, num_coaches: 4, num_staff: 3, budget: 15000, depart_after: "2027-10-15T12:00" };
let base;
before(() => new Promise((r) => app.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${app.address().port}`; r(); })));
after(() => new Promise((r) => app.close(r)));
async function post(path, body) {
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const CONFIRM = { nightly_rate: 109, rooms_available: 40, miles_to_stadium: 3.5, bus_parking: true, meeting_room: true, confirmed_by_staff: true };

// ------------------------------------------------------------------ fake web for verifySource
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
const page = (html, { type = "text/html; charset=utf-8", status = 200, headers = {} } = {}) =>
  new Response(html, { status, headers: { "content-type": type, ...headers } });

describe("link checks (verifySource)", () => {
  const opts = (fetchImpl, lookup = publicDns) => ({ fetchImpl, lookup });
  test("a page that names the hotel passes; rate and miles found when shown", async () => {
    const r = await verifySource("https://hotel.example/stay", { name: "Stadium View Inn", rate: 139, miles: 0.8 },
      opts(async () => page("<h1>Stadium View Inn</h1><p>Rooms from USD 139.00 a night, 0.8 miles to the stadium</p>")));
    assert.deepEqual(r, { url: "https://hotel.example/stay", ok: true, reason: "", rate_found: true, miles_found: true });
    assert.equal(Object.keys(r).includes("text"), false);       // never returns page text
  });
  test("a page that doesn't name the hotel fails; rate/miles not on the page are not found", async () => {
    const r = await verifySource("https://hotel.example/x", { name: "Stadium View Inn", rate: 139, miles: 0.8 },
      opts(async () => page("<h1>Some Other Hotel</h1>")));
    assert.equal(r.ok, false);
    const r2 = await verifySource("https://hotel.example/x", { name: "Stadium View Inn", rate: 139, miles: 0.8 },
      opts(async () => page("<h1>Stadium View Inn</h1><p>Call for rates.</p>")));
    assert.deepEqual([r2.ok, r2.rate_found, r2.miles_found], [true, false, false]);
  });
  test("http links, private addresses and logins are refused without fetching", async () => {
    let fetched = 0;
    const f = async () => { fetched++; return page("Stadium View Inn"); };
    for (const url of ["http://hotel.example/", "https://127.0.0.1/", "https://[::1]/", "https://10.0.0.5/", "https://192.168.1.2/",
      "https://169.254.169.254/latest", "https://localhost/", "https://user:pw@hotel.example/", "https://hotel.example:8443/"]) {
      assert.equal((await verifySource(url, { name: "Stadium View Inn" }, opts(f))).ok, false, url);
    }
    const r = await verifySource("https://intranet.example/", { name: "Stadium View Inn" }, opts(f, async () => [{ address: "172.20.1.1", family: 4 }]));
    assert.match(r.reason, /private/);
    assert.equal(fetched, 0);
  });
  test("a redirect to a private address is refused; a public redirect is followed", async () => {
    const hops = [];
    const f = async (url) => { hops.push(url); return url.includes("start") ? page("", { status: 302, headers: { location: "https://10.1.2.3/admin" } }) : page("Stadium View Inn"); };
    const r = await verifySource("https://hotel.example/start", { name: "Stadium View Inn" }, opts(f));
    assert.deepEqual([r.ok, r.reason, hops.length], [false, "redirect: private address refused", 1]);
    const g = async (url) => (url.includes("start") ? page("", { status: 301, headers: { location: "/final" } }) : page("Stadium View Inn"));
    assert.equal((await verifySource("https://hotel.example/start", { name: "Stadium View Inn" }, opts(g))).ok, true);
  });
  test("PDFs and pages over 1 MB are refused", async () => {
    const pdf = await verifySource("https://hotel.example/rates.pdf", { name: "Stadium View Inn" },
      opts(async () => page("%PDF Stadium View Inn", { type: "application/pdf" })));
    assert.deepEqual([pdf.ok, pdf.reason], [false, "not a web page"]);
    const big = await verifySource("https://hotel.example/", { name: "Stadium View Inn" },
      opts(async () => page("Stadium View Inn " + "x".repeat(1_100_000))));
    assert.deepEqual([big.ok, big.reason], [false, "page over 1 MB"]);
  });
  test("numbers are normalized before matching", () => {
    for (const t of ["$139", "139.00", "USD 139", "US$139 per night", "from $ 139"]) assert.ok(rateOnPage(139, t), t);
    assert.ok(!rateOnPage(139, "$1,139"));
    assert.deepEqual(numbersIn("$1,139.50 and 42"), [1139.5, 42]);
    assert.deepEqual(milesIn("0.8 mi from the stadium, 3 miles to downtown"), [0.8, 3]);
  });
  test("private address list", () => {
    for (const ip of ["127.0.0.1", "10.1.1.1", "172.31.0.1", "192.168.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      assert.ok(isPrivateAddress(ip), ip);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
  });
});

describe("cleaning web results", () => {
  const raw = { hotels: [
    { name: "B Hotel", address: "2 Main St", nightly_rate_usd: 150, miles_to_stadium: 1, bus_parking: "yes", source_urls: ["https://b.example/"] },
    { name: "A Hotel", address: "1 Main St", nightly_rate_usd: 120, miles_to_stadium: 2, bus_parking: "maybe", source_urls: ["https://a.example/"] },
    { name: "No Rate Inn", address: "3 Main St", nightly_rate_usd: null, miles_to_stadium: null, bus_parking: "no", source_urls: ["https://c.example/"] },
    { name: "Cheap Shack", address: "4 Main St", nightly_rate_usd: 15, miles_to_stadium: 1, bus_parking: "yes", source_urls: ["https://d.example/"] },
    { name: "A  hotel", address: "elsewhere", nightly_rate_usd: 99, miles_to_stadium: 1, bus_parking: "yes", source_urls: ["https://e.example/"] },
    { name: "No Link Lodge", address: "6 Main St", nightly_rate_usd: 100, miles_to_stadium: 1, bus_parking: "yes", source_urls: [] },
    { name: "Fake Link Lodge", address: "7 Main St", nightly_rate_usd: 101, miles_to_stadium: 1, bus_parking: "yes", source_urls: ["https://fake.example/"] },
  ] };
  const verify = async (url, { rate, miles }) => (url.includes("fake")
    ? { url, ok: false, reason: "page doesn't mention the hotel", rate_found: false, miles_found: false }
    : { url, ok: true, reason: "", rate_found: !url.includes("b.example"), miles_found: true });

  test("sorted by rate (empty last), W-IDs, duplicates/out-of-range/no-link/fake-link handled", async () => {
    const out = await web.processSearch(raw, { verify });
    assert.equal(out.status, "ok");
    assert.deepEqual(out.hotels.map((h) => `${h.hotel_id}:${h.name}:${h.nightly_rate_usd}`),
      ["W1:A Hotel:120", "W2:B Hotel:null", "W3:Cheap Shack:null", "W4:No Rate Inn:null"]);
    assert.equal(out.hotels[0].bus_parking, "unknown");                       // only yes/no/unknown
    assert.ok(!out.hotels.some((h) => /No Link|Fake Link/.test(h.name)));
    assert.deepEqual(out.hotels[0].sources, [{ url: "https://a.example/", ok: true, reason: "" }]);
  });
  test("if Aivana ever lists its sources, links outside that list are rejected", () => {
    const c = web.cleanCandidates(raw, [{ url: "https://a.example/", title: "" }]);
    assert.deepEqual(c.map((h) => h.name), ["A Hotel"]);
  });
  test("every link failing gives the 'no hotel could be verified' message", async () => {
    const out = await web.processSearch(raw, { verify: async (url) => ({ url, ok: false, reason: "blocked", rate_found: false, miles_found: false }) });
    assert.deepEqual([out.status, out.message, out.hotels.length], ["none_verified", "No hotel could be verified online. Use the data-pack hotels.", 0]);
    assert.deepEqual(out.rejected.map((h) => h.name).sort(), ["A Hotel", "B Hotel", "Cheap Shack", "Fake Link Lodge", "No Rate Inn"]);
    assert.deepEqual(Object.keys(out.rejected[0]).sort(), ["name", "sources"]);                // name + link pass/fail only
  });
});

describe("web hotel routes (mock mode)", () => {
  beforeEach(() => aiTasks._clearCache());
  async function approve(option = "B", custom = null) {
    const d = (await post("/api/details", { request: REQ, option_id: option, custom })).json;
    return (await post("/api/approve", { request: REQ, option_id: option, custom, role: "Head Coach", acknowledged: d.required_acks })).json.approval.approval_id;
  }
  test("search returns sorted W-IDs; a repeat search is served from the cache", async () => {
    const calls = aivana.USAGE.calls;
    const r = await post("/api/hotels/search", { request: REQ, option_id: "B" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.hotels.map((h) => h.hotel_id), ["W1", "W2", "W3", "W4"]);
    const rates = r.json.hotels.map((h) => h.nightly_rate_usd ?? Infinity);
    assert.deepEqual(rates, [...rates].sort((a, b) => a - b));
    assert.deepEqual([r.json.query.checkin, r.json.query.checkout, r.json.query.rooms], ["2027-10-15", "2027-10-16", 18]);
    const again = await post("/api/hotels/search", { request: REQ, option_id: "B" });
    assert.equal(again.json.cached, true);
    assert.equal(aivana.USAGE.calls, calls + 1);
    assert.equal(readdirSync(process.env.WEB_CACHE_DIR).length, 0);           // mock results are never saved to disk
  });
  test("a day trip has no hotel to search for", async () => {
    assert.equal((await post("/api/hotels/search", { request: REQ, option_id: "A" })).status, 400);
  });
  test("a confirmed hotel reprices option B by exactly the rate difference", async () => {
    await post("/api/hotels/search", { request: REQ, option_id: "B" });
    const before = (await post("/api/plan", { request: REQ })).json.plan.packages.find((p) => p.option_id === "B");
    const r = await post("/api/hotels/confirm", { request: REQ, option_id: "B", hotel_id: "W1", confirm: CONFIRM });
    assert.equal(r.status, 200);
    const after = r.json.plan.packages.find((p) => p.option_id === "B");
    assert.equal(after.hotel.hotel_id, "W1");
    assert.equal(after.hotel.source, "web");
    assert.equal(after.costs.lodging, 2158.2);                                   // 18 rooms x $109 x 1.10 tax
    assert.equal(Math.round((before.costs.lodging - after.costs.lodging) * 100) / 100, Math.round(18 * (129 - 109) * 1.1 * 100) / 100);
    assert.ok(after.notes.some((n) => n.includes("rate confirmed by staff")));
  });
  test("staff must tick the confirmation box and fill every field", async () => {
    await post("/api/hotels/search", { request: REQ, option_id: "B" });
    let r = await post("/api/hotels/confirm", { request: REQ, option_id: "B", hotel_id: "W1", confirm: { ...CONFIRM, confirmed_by_staff: false } });
    assert.equal(r.status, 400);
    assert.match(r.json.errors.join(" "), /I confirmed this rate/);
    r = await post("/api/hotels/confirm", { request: REQ, option_id: "B", hotel_id: "W1", confirm: { ...CONFIRM, bus_parking: null, nightly_rate: 5 } });
    assert.equal(r.status, 400);
    assert.equal(r.json.errors.length, 2);
    r = await post("/api/hotels/confirm", { request: REQ, option_id: "B", hotel_id: "W9", confirm: CONFIRM });
    assert.equal(r.status, 400);
  });
  test("adding a web hotel after approval makes the approval out of date (409)", async () => {
    const aid = await approve("B");
    await post("/api/hotels/search", { request: REQ, option_id: "B" });
    const custom = (await post("/api/hotels/confirm", { request: REQ, option_id: "B", hotel_id: "W1", confirm: CONFIRM })).json.custom;
    const r = await post("/api/final", { request: REQ, option_id: "B", approval_id: aid, custom });
    assert.deepEqual([r.status, r.json.code], [409, "approval_stale"]);
    const aid2 = await approve("B", custom);                                     // approving with it works
    assert.equal((await post("/api/final", { request: REQ, option_id: "B", approval_id: aid2, custom })).status, 200);
  });
  test("unconfirmed web hotels never reach a fact card or a total", async () => {
    const plain = (await post("/api/hotels/recommend", { request: REQ, option_id: "B" })).json;
    assert.ok(plain.cards.every((c) => c.hotel_id.startsWith("H")));
    const unconfirmed = { option_id: "B", hotel_id: "W1", web_hotel: { hotel_id: "W1", name: "Sneaky Inn", nightly_rate: 50,
      rooms_available: 40, miles_to_stadium: 1, bus_parking: true, meeting_room: true } };
    assert.equal((await post("/api/plan", { request: REQ, custom: unconfirmed })).status, 400);
    assert.equal((await post("/api/hotels/recommend", { request: REQ, option_id: "B", custom: unconfirmed })).status, 400);
  });
  test("'Which hotel?' uses the cards and passes the fact check", async () => {
    await post("/api/hotels/search", { request: REQ, option_id: "B" });
    const custom = (await post("/api/hotels/confirm", { request: REQ, option_id: "B", hotel_id: "W1", confirm: CONFIRM })).json.custom;
    const r = (await post("/api/hotels/recommend", { request: REQ, option_id: "B", custom })).json;
    assert.deepEqual(r.cards.map((c) => c.hotel_id).sort(), ["H6", "H7", "W1"]);
    assert.ok(r.cards.find((c) => c.hotel_id === "W1").labels.includes("lowest_cost"));
    assert.equal(r.recommendation.recommended_hotel_id, "W1");
    assert.deepEqual([r.recommendation.unverified_numbers, r.recommendation.unverified_claims], [[], []]);
  });
  test("the fact check flags numbers and hotels that aren't on the cards", () => {
    const cards = [{ hotel_id: "H6", nightly_rate: 129, trip_lodging_cost: 2554.2, miles_to_stadium: 6, rules_failed: [] }];
    const c = web.checkHotelText("H6 costs $2,554.20 at $129/night, 6 mi away. H9 saves $300 and is 2 miles out.", cards);
    assert.deepEqual(c.unverified_numbers, ["$300", "2 mi"]);
    assert.equal(c.unverified_claims.length, 1);
  });
});

describe("real-mode behaviour with a fake Aivana", () => {
  const json = (status, body) => new Response(JSON.stringify(body), { status });
  let sent;
  const useFake = (responses) => {
    sent = [];
    aivana._setTransport({ fetch: async (url, init) => { sent.push(JSON.parse(init.body)); return responses.shift(); }, sleep: async () => {} });
  };
  const query = { city: "Testville", stadium: "Test Stadium", checkin: "2027-10-15", checkout: "2027-10-16", nights: 1, rooms: 18 };
  const answer = { hotels: [{ name: "Real Inn", address: "1 Test St", nightly_rate_usd: 130, miles_to_stadium: 2, bus_parking: "yes", source_urls: ["https://realinn.example/"] }] };
  const verify = async (url) => ({ url, ok: true, reason: "", rate_found: true, miles_found: false });
  before(() => { process.env.AIVANA_MOCK = "0"; process.env.AIVANA_API_KEY = "test-key-not-real"; });
  after(() => {
    process.env.AIVANA_MOCK = "1"; delete process.env.AIVANA_API_KEY;
    aivana._setTransport({ fetch: (...a) => fetch(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  });
  beforeEach(() => aiTasks._clearCache());

  test("web search is switched on in the request; documented responses have no sources", async () => {
    useFake([json(200, { answer: "", structured: answer, usage: {} })]);
    const out = await aiTasks.searchHotels(query, { verify });
    assert.equal(sent[0].web_search, true);
    assert.ok(sent[0].response_format);
    assert.deepEqual(aivana.extractSources({ answer: "", structured: answer }), []);
    assert.deepEqual(out.hotels.map((h) => [h.hotel_id, h.nightly_rate_usd, h.miles_to_stadium]), [["W1", 130, null]]);
  });
  test("a saved real search is reused offline (from data/web_cache), with no call", async () => {
    const files = readdirSync(process.env.WEB_CACHE_DIR);
    assert.equal(files.length, 1);
    const saved = readFileSync(join(process.env.WEB_CACHE_DIR, files[0]), "utf8");
    assert.ok(!saved.includes("test-key-not-real"));
    useFake([]);                                                                // any call would crash
    const out = await aiTasks.searchHotels(query, { verify });
    assert.deepEqual([out.cached, out.hotels[0].name, sent.length], [true, "Real Inn", 0]);
  });
  test("if web search + JSON form output is refused, the JSON is read from plain text instead", async () => {
    useFake([json(422, { error: { message: "response_format not supported with web_search" } }),
      json(200, { answer: "Here you go:\n```json\n" + JSON.stringify(answer) + "\n```", usage: {} })]);
    const out = await aiTasks.searchHotels({ ...query, city: "Fallbackville" }, { verify });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].response_format, undefined);
    assert.equal(sent[1].web_search, true);
    assert.equal(out.hotels[0].name, "Real Inn");
  });
  test("a recommendation with a made-up hotel ID is rejected", async () => {
    const cards = [{ hotel_id: "H6", name: "Harbor Point Hotel", nightly_rate: 129, trip_lodging_cost: 2554.2, miles_to_stadium: 6,
      bus_parking: "yes", meeting_room: "yes", breakfast_included: "yes", rules_failed: [], source: "data pack", labels: ["lowest_cost", "closest"] }];
    const bad = { recommended_hotel_id: "W7", headline: "Use W7", reason: "Cheaper.", tradeoffs: [], confirm_with_hotel: [] };
    useFake([json(200, { structured: bad, usage: {} }), json(200, { structured: bad, usage: {} })]);
    await assert.rejects(aiTasks.recommendHotel(cards), (e) => e.code === "app_validation");
  });
  test("web search failing leaves the app working: a clear message, no crash", async () => {
    const g = DATA.schedule.games.find((x) => x.game_id === "G09");
    const keep = [g.search_city, g.search_stadium];
    try {
      g.search_city = null;                                                      // not set up: a clear 400, no call
      useFake([]);
      assert.equal((await post("/api/hotels/search", { request: REQ, option_id: "B" })).status, 400);
      g.search_city = "Failville"; g.search_stadium = "Fail Stadium";             // not in the saved cache
      useFake([json(402, { error: { code: "insufficient_credit", message: "empty" } })]);
      const r = await post("/api/hotels/search", { request: REQ, option_id: "B" });
      assert.deepEqual([r.status, r.json.status, r.json.message], [200, "unavailable", "No web results. You can still use the data-pack hotels."]);
      assert.equal((await post("/api/plan", { request: REQ })).status, 200);
    } finally { [g.search_city, g.search_stadium] = keep; }
  });
});
