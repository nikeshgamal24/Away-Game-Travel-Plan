// Feature 8: schedule import helpers on the server. File checks, and loading/saving the imported schedule.
// The row rules live in static/scheduleRules.js so the browser runs exactly the same checks.

import { readFileSync, writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./planner.js";
import { checkRows, rowIsValid } from "../static/scheduleRules.js";

export const PDF_MESSAGE = "PDFs aren't supported. Take a screenshot of the schedule and upload the image.";
export const TYPE_MESSAGE = "Upload a PNG or JPG screenshot.";
export const MAX_WIDTH = 1600;
export const MAX_READ_BODY = 3_000_000; // bytes of request body for /api/schedule/read (base64 adds a third)

/** Where the imported schedule lives. Tests point this elsewhere with SCHEDULE_IMPORTED_FILE. */
export const importedPath = () => process.env.SCHEDULE_IMPORTED_FILE || join(DATA_DIR, "schedule.imported.json");

/** True if the bytes are a PDF, whatever the file was called. */
export const isPdf = (buf) => buf.length >= 4 && buf.subarray(0, 4).toString("latin1") === "%PDF";

/** Real type and width from the file's own bytes: { type: "image/png" | "image/jpeg" | null, width: number | null }. */
export function sniffImage(buf) {
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 24 && PNG_SIG.every((b, i) => buf[i] === b) && buf.subarray(12, 16).toString("latin1") === "IHDR") {
    return { type: "image/png", width: buf.readUInt32BE(16) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    // Walk the JPEG segments to the first SOF (start of frame) marker, which holds the size.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) return { type: "image/jpeg", width: buf.readUInt16BE(i + 7) };
      if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan with no size found
      i += 2 + len;
    }
    return { type: "image/jpeg", width: null };
  }
  return { type: null, width: null };
}

/** The saved file's games pass the same rules as the preview (with every field present). */
function gamesLookValid(games) {
  if (!Array.isArray(games) || !games.length) return false;
  const rows = games.map((g) => {
    const [y, m, d] = String(g.date || "").split("-");
    return { ...g, home_away: g.neutral_site ? "neutral" : "away", year: y, month: m, day: d };
  });
  return games.every((g) => /^G\d{2}$/.test(g.game_id || "")) && checkRows(rows).every(rowIsValid);
}

/** Schedule to use: the imported one if present and valid, else the sample. Returns { schedule, source, warning }. */
export function loadSchedule(sample) {
  const p = importedPath();
  if (!existsSync(p)) return { schedule: sample, source: "sample", warning: "" };
  try {
    const s = JSON.parse(readFileSync(p, "utf8"));
    if (gamesLookValid(s.games)) return { schedule: { ...s, home: sample.home }, source: "imported", warning: "" };
  } catch { /* fall through */ }
  return { schedule: sample, source: "sample",
    warning: "The imported schedule file couldn't be read, so the sample schedule is in use. Import again or reset." };
}

/** Write the imported schedule (write to a temp file, then rename, so a crash never leaves half a file). */
export function saveImported(games, sample) {
  const p = importedPath();
  const schedule = {
    note: "Imported by staff in Settings (Feature 8). Miles and drive hours were typed by staff.",
    home: sample.home, imported_at: new Date().toISOString(), games,
  };
  writeFileSync(`${p}.tmp`, JSON.stringify(schedule, null, 1) + "\n");
  renameSync(`${p}.tmp`, p);
  return schedule;
}

export function deleteImported() {
  rmSync(importedPath(), { force: true });
}
