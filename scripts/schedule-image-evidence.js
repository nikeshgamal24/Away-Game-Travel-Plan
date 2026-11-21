// Feature 8, step 0: one real Aivana call with the synthetic schedule PNG, saved as evidence.
// It answers the open question: do `attachments` and `response_format` work together?
//
// Usage:  npm run evidence:schedule-image        (needs AIVANA_API_KEY and AIVANA_MOCK unset)
//
// Writes docs/evidence/schedule-image-<date>.md: the request body WITHOUT the base64 image, Aivana's response, and
// the tokens Aivana reports. The API key travels in a header and is in neither. Synthetic image only, never a real one.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

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
const imp = await import("../src/scheduleImport.js");
const rules = await import("../static/scheduleRules.js");

if (aivana.mockMode()) { console.error("Needs a real Aivana key (AIVANA_API_KEY) and AIVANA_MOCK unset."); process.exit(1); }

const IMAGE = join(ROOT, "test", "fixtures", "schedule-synthetic.png");
const buf = readFileSync(IMAGE);
const { type, width } = imp.sniffImage(buf);
if (type !== "image/png" || !(width <= imp.MAX_WIDTH)) { console.error("The fixture must be a PNG at most 1600px wide."); process.exit(1); }
const data = buf.toString("base64");
const sha = createHash("sha256").update(buf).digest("hex");

let raw = null;
let result = null, error = null;
const t0 = Date.now();
console.log(`Sending ${IMAGE} (${buf.length} bytes, ${width}px wide) to Aivana once…`);
try {
  result = await aiTasks.readSchedule({ image: { mime_type: type, data } }, null, { onRaw: (r) => { raw = r; } });
} catch (e) { error = e; }
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const stripImage = (body) => body && ({ ...body, attachments: (body.attachments || []).map((a) =>
  ({ mime_type: a.mime_type, data: `<base64 omitted: ${buf.length} bytes, sha256 ${sha.slice(0, 16)}…>` })),
  response_format: body.response_format ? { type: body.response_format.type, schema: "<scheduleSchema(), see src/aiTasks.js>" } : undefined });
const block = (x) => (x === undefined || x === null ? "Not recorded (the call failed before a response)." : "```json\n" + JSON.stringify(x, null, 2) + "\n```");
const day = new Date().toISOString().slice(0, 10);
const usage = raw?.response?.usage || null;

// What the synthetic image shows, so the result can be judged at a glance.
const EXPECTED = [
  "Maple Ridge College: away, 2027-09-08, 19:00",
  "Northfield State: home (not saved)",
  "Lakeview State: away, Sep 19 with NO year printed → year must be null (invalid in preview)",
  "Riverbend University: away, 2027-10-05, kickoff TBA → null (invalid in preview)",
  "Harbor City Tech: away, 2027-10-16, 19:00",
];
let checks = [];
if (result) {
  checks = rules.checkRows(result.rows).map((c, i) => {
    const r = result.rows[i];
    return `| ${r.opponent ?? "?"} | ${r.home_away} | ${r.year ?? "null"}-${r.month ?? "?"}-${r.day ?? "?"} | ${r.kickoff ?? "null"} | ` +
      `${c.skipped ? "home, skipped" : Object.entries(c.problems).filter(([f]) => !["miles", "drive_hours"].includes(f))
        .map(([f, why]) => `${f}: ${why}`).join("; ") || "ok (staff still type miles and drive hours)"} |`;
  });
}

const lines = [
  `# Schedule image evidence (spec 08, step 0), ${day}`, "",
  `- Image: \`test/fixtures/schedule-synthetic.png\`, synthetic, fictional teams. ${buf.length} bytes, ${width}px wide.`,
  `- Mode: Aivana API, one call. Time: ${secs} s.`,
  `- Attachments + JSON form output: ${!raw ? "**no response recorded**" : raw.request.response_format
    ? "**worked together** (response_format was accepted with the image attached)"
    : "**refused together**; the JSON-in-text fallback was used"}.`,
  `- Tokens Aivana reported: ${usage ? `${usage.input_tokens ?? "?"} input, ${usage.output_tokens ?? "?"} output` : "not reported"}.`,
  `- Result: ${error ? `**error**: ${error.message}` : `${result.rows.length} game(s) read.`}`,
  "", "Saved here: the request body without the image bytes, and Aivana's response. The API key is sent in a header " +
  "and is in neither.", "",
  "## What the image shows", "", ...EXPECTED.map((x) => `- ${x}`), "",
  ...(result ? ["## What the preview would show", "", "| Opponent | Home/away | Date (y-m-d) | Kickoff | Preview check |",
    "|---|---|---|---|---|", ...checks, ""] : []),
  "## Request (image bytes removed)", "", block(stripImage(raw?.request)), "",
  "## Aivana's response", "", block(raw?.response ?? null), "",
];
mkdirSync(join(ROOT, "docs", "evidence"), { recursive: true });
const out = join(ROOT, "docs", "evidence", `schedule-image-${day}.md`);
writeFileSync(out, lines.join("\n"));
console.log(`Wrote ${out}`);
if (error) process.exit(1);
