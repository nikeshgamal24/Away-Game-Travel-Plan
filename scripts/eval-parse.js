// Level 3: accuracy test for the Aivana request parser against known answers.
//
// Usage:
//   npm run eval            # uses Aivana if AIVANA_API_KEY is set (in .env or the shell), else the offline mock
// Writes eval_results.md with per-field accuracy. Each case is one short call (~300 tokens).

import { writeFileSync, readFileSync, existsSync } from "node:fs";
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

const FIELDS = ["game_id", "num_players", "num_coaches", "num_staff", "budget", "depart_after"];
const CASES = [
  ["Sunday at Lakeview State, 1 PM kickoff. 22 players, 4 coaches, 3 staff. We train until noon Saturday. Budget is $6,000.",
    { game_id: "G07", num_players: 22, num_coaches: 4, num_staff: 3, budget: 6000, depart_after: "2027-09-18T12:00" }],
  ["Riverbend match: 20 players, 4 coaches and 2 staff, budget $3,500, can't leave before 1pm on game day.",
    { game_id: "G08", num_players: 20, num_coaches: 4, num_staff: 2, budget: 3500, depart_after: "2027-10-05T13:00" }],
  ["Need a plan for Harbor City Tech. Taking 24 players, 4 coaches, 3 staff. $14k budget. Leave after 2 pm Thursday.",
    { game_id: "G09", num_players: 24, num_coaches: 4, num_staff: 3, budget: 14000, depart_after: "2027-10-14T14:00" }],
  ["Lakeview trip, 20 players, 3 coaches, 2 staff, budget $5,000.",
    { game_id: "G07", num_players: 20, num_coaches: 3, num_staff: 2, budget: 5000, depart_after: null }],
  ["Away at Riverbend University with eighteen players and four coaches, three staff. Spend no more than $3,000. Leave Monday after 3 pm.",
    { game_id: "G08", num_players: 18, num_coaches: 4, num_staff: 3, budget: 3000, depart_after: "2027-10-04T15:00" }],
  ["Harbor City match, 22 players, 4 coaches, 3 staff. No budget set yet.",
    { game_id: "G09", num_players: 22, num_coaches: 4, num_staff: 3, budget: null, depart_after: null }],
  ["Plan travel for 20 players, 4 coaches and 2 staff with $4,000. Leave after noon the day before.",
    { game_id: null, num_players: 20, num_coaches: 4, num_staff: 2, budget: 4000, depart_after: null }],
  ["Lakeview State away match. Budget $6,500. 24 players, 4 coaches, 3 staff. Departure no earlier than 10am Saturday.",
    { game_id: "G07", num_players: 24, num_coaches: 4, num_staff: 3, budget: 6500, depart_after: "2027-09-18T10:00" }],
];

function same(field, got, want) {
  if (want === null) return got === null || got === undefined || got === "";
  if (field === "budget") return got !== null && got !== undefined && Math.abs(Number(got) - want) < 0.5;
  return got === want;
}

const data = planner.loadData();
const mode = aivana.mockMode() ? "offline mock" : "Aivana API";
const perField = Object.fromEntries(FIELDS.map((f) => [f, 0]));
const rows = [];
let exact = 0;
for (const [text, want] of CASES) {
  let got;
  try {
    got = (await aiTasks.parseRequest(text, data)).request;
  } catch (e) {
    console.error("Aivana error:", e.message);
    process.exit(1);
  }
  const ok = Object.fromEntries(FIELDS.map((f) => [f, same(f, got[f], want[f])]));
  for (const f of FIELDS) perField[f] += ok[f] ? 1 : 0;
  if (FIELDS.every((f) => ok[f])) exact += 1;
  rows.push({ text, want, got, ok });
}
const n = CASES.length;
const lines = [`# Parser accuracy test (${mode})`, "", `Cases: ${n}. Fully correct: ${exact}/${n}.`, "",
  "| Field | Correct | Accuracy |", "|---|---|---|",
  ...FIELDS.map((f) => `| ${f} | ${perField[f]}/${n} | ${Math.round((perField[f] / n) * 100)}% |`), "", "## Misses", ""];
for (const { text, want, got, ok } of rows) {
  const misses = FIELDS.filter((f) => !ok[f]);
  if (misses.length) {
    lines.push(`- "${text}"`);
    for (const f of misses) lines.push(`  - ${f}: expected \`${want[f]}\`, got \`${got[f] ?? null}\``);
  }
}
if (exact === n) lines.push("- None");
writeFileSync(join(ROOT, "eval_results.md"), lines.join("\n") + "\n");
console.log(lines.slice(0, 4 + FIELDS.length + 2).join("\n"));
console.log(`\nTokens used: ${JSON.stringify(aivana.USAGE)}  ->  eval_results.md`);
