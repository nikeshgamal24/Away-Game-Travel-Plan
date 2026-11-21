// One real web hotel search (spec 07), saved as evidence and as the offline demo cache.
//
// Usage:  npm run evidence:web-hotels            (needs AIVANA_API_KEY and search_city for G09)
//
// Writes:
//   docs/evidence/web-hotels-<date>.md  the request body and Aivana's response (no API key: it travels in a header),
//                                       plus pass/fail for each link. No page text is ever saved.
//   data/web_cache/<key>.json           hotel fields + link pass/fail, reused offline by the app.
// One Aivana call with web search (tokens plus a search fee the docs don't list).

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([^#=\s]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const aivana = await import("../src/aivana.js");
const aiTasks = await import("../src/aiTasks.js");
const planner = await import("../src/planner.js");
const web = await import("../src/webHotels.js");

if (aivana.mockMode()) { console.error("Needs a real Aivana key (AIVANA_API_KEY) and AIVANA_MOCK unset."); process.exit(1); }
const data = planner.loadData();
const gameId = process.argv[2] || "G09";
const req = { game_id: gameId, num_players: 22, num_coaches: 4, num_staff: 3, budget: 15000 };
const game = planner.getGame(data, gameId);
if (!game) { console.error(`No game ${gameId}.`); process.exit(1); }
req.depart_after = `${new Date(new Date(`${game.date}T12:00`).getTime() - 864e5).toISOString().slice(0, 10)}T12:00`;
const [clean] = planner.validateRequest(req, data);
const s = planner.mergeSettings(data.settings, {})[0];
const plan = planner.buildPackages(clean, data, s, null);
const pkg = plan.packages.find((p) => p.option_id === "B");
const [query, why] = web.searchQuery(plan, pkg);
if (!query) { console.error(why); process.exit(1); }

let raw = null;
console.log(`Searching the web for hotels near ${query.stadium}, ${query.city} (${query.checkin} to ${query.checkout}, ${query.rooms} rooms)…`);
const t0 = Date.now();
const out = await aiTasks.searchHotels(query, { onRaw: (r) => { raw = r; } });
if (out.cached) console.log("Note: served from data/web_cache (an earlier real search). Delete that file to search again.");

const day = new Date().toISOString().slice(0, 10);
const block = (x) => "```json\n" + JSON.stringify(x, null, 2) + "\n```";
const lines = [
  `# Web hotel search evidence (spec 07), ${day}`, "",
  `- Game: ${game.game_id} ${game.opponent} (fictional). Searched as: **${query.stadium}, ${query.city}** (stand-in).`,
  `- Mode: Aivana API${out.cached ? " (served from the saved cache; no new call)" : ""}. Time: ${((Date.now() - t0) / 1000).toFixed(1)} s.`,
  `- Result: **${out.status}**${out.message ? ` (${out.message})` : ""}. ${out.hotels.length} hotel(s) kept.`,
  `- Web search + JSON form output: ${raw ? (raw.request.response_format ? "**worked together** (response_format was accepted)" : "**refused together**; the JSON-in-text fallback was used") : "not tested in this run (cached)"}.`,
  `- Sources field in Aivana's response: ${raw ? (raw.sources.length ? `${raw.sources.length} found` : "none (as the docs say)") : "n/a"}.`,
  "", "Saved here: the request body and Aivana's response only. The API key is sent in a header and is not in either. " +
  "No page text is saved: for each link only pass/fail and the reason.", "",
  "## Links checked by the code", "",
  "| Hotel | Link | Result |", "|---|---|---|",
  ...out.hotels.flatMap((h) => h.sources.map((x) => `| ${h.hotel_id} ${h.name} | ${x.url} | ${x.ok ? "pass" : `fail: ${x.reason}`} |`)),
  ...(out.rejected || []).flatMap((h) => h.sources.map((x) => `| (dropped) ${h.name} | ${x.url} | fail: ${x.reason} |`)), "",
  "## Kept hotels (after the code's checks)", "", block(out.hotels), "",
];
if (raw) {
  const { system, ...rest } = raw.request;
  lines.push("## Request body sent to Aivana", "", block({ system: system.slice(0, 2000), ...rest }), "",
    "## Aivana's response", "", block(raw.response), "");
}
mkdirSync(join(ROOT, "docs", "evidence"), { recursive: true });
const file = join(ROOT, "docs", "evidence", `web-hotels-${day}.md`);
writeFileSync(file, lines.join("\n"));
console.log(`${out.status}: ${out.hotels.length} hotel(s) kept. Evidence: ${file}`);
console.log(`Usage: ${JSON.stringify(aivana.USAGE.by_kind.hotel_search || {})}`);
