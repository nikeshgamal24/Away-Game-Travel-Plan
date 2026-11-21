// Trustworthiness eval (spec 04): scores what Aivana writes against the app's math.
//
// Usage:
//   npm run eval:trust                      # 30 trips + 10 season plans
//   npm run eval:trust -- --n 10 --seasons 3 --seed 7
// Uses Aivana if AIVANA_API_KEY is set (in .env or the shell), else the offline mock.
// Writes eval_trust.md. About 70 Aivana calls for the default size; the report shows the real token count.

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

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? Number(args[i + 1]) : def;
  if (!Number.isInteger(v) || v < 0) { console.error(`--${name} must be a whole number`); process.exit(1); }
  return v;
};
const n = arg("n", 30), seasons = arg("seasons", 10), seed = arg("seed", 42);

const aivana = await import("../src/aivana.js");
const aiTasks = await import("../src/aiTasks.js");
const planner = await import("../src/planner.js");
const trust = await import("../src/trustEval.js");

const mode = aivana.mockMode() ? "offline mock" : "Aivana API";
if (aivana.mockMode()) aivana._setTransport({ sleep: async () => {} }); // no typing delay offline
console.log(`Trust eval: ${n} trips + ${seasons} season plans, seed ${seed}, ${mode}`);

const result = await trust.runTrustEval({ data: planner.loadData(), ai: aiTasks, usage: aivana.USAGE, n, seasons, seed,
  onProgress: (msg) => process.stdout.write(`  ${msg}\n`) });
const out = join(ROOT, "eval_trust.md");
writeFileSync(out, trust.report(result, mode));
console.log(`\n${trust.demoLine(result.scores, result.scenarios.length)}\nWrote ${out}`);
