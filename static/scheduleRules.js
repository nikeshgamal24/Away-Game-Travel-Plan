// Feature 8: rules for an imported schedule row. Shared by the browser (live preview) and the server (save).
// Plain ES module with no imports, so both sides load the same file.

export const FIELDS = ["home_away", "opponent", "city", "stadium", "year", "month", "day", "kickoff", "miles", "drive_hours"];
export const MAX_GAMES = 20;

export const REASONS = {
  year: "Year not shown. Type the year.",
  date: "Date unclear.",
  unclear: "Hard to read. Check this.",
  kickoff: "Kickoff missing. Type HH:MM.",
  required: "Required.",
  home_away: "Home or away? Pick one.",
  duplicate: "Duplicate game.",
  too_long: "Too long (80 characters max).",
  too_big: "Check this number.",
};

const TEXT_FIELDS = ["opponent", "city", "stadium"];
const blank = (v) => v === null || v === undefined || String(v).trim() === "";
const intOrNull = (v) => (blank(v) || !/^-?\d+$/.test(String(v).trim()) ? null : Number(String(v).trim()));
const numOrNull = (v) => (blank(v) || !Number.isFinite(Number(v)) ? null : Number(v));
const pad = (n) => String(n).padStart(2, "0");

/** YYYY-MM-DD if year, month and day make a real date, else null. Code builds dates, never Aivana. */
export function buildDate(row) {
  const y = intOrNull(row.year), m = intOrNull(row.month), d = intOrNull(row.day);
  if (y === null || m === null || d === null || y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** "HH:MM" (24-hour) or null. */
export function cleanKickoff(v) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(v ?? "").trim());
  return m ? `${pad(m[1])}:${m[2]}` : null;
}

/** Problems in one row, as { field: reason }. A home game is never saved, so only its home/away cell is checked. */
export function checkRow(row) {
  const out = {};
  const unclear = new Set(Array.isArray(row.unclear) ? row.unclear : []);
  const flag = (f, reason) => { if (!out[f]) out[f] = reason; };

  if (!["away", "home", "neutral"].includes(row.home_away)) flag("home_away", REASONS.home_away);
  else if (unclear.has("home_away")) flag("home_away", REASONS.unclear);
  if (row.home_away === "home") return out;

  for (const f of TEXT_FIELDS) {
    if (blank(row[f])) flag(f, REASONS.required);
    else if (String(row[f]).trim().length > 80) flag(f, REASONS.too_long);
    else if (unclear.has(f)) flag(f, REASONS.unclear);
  }

  if (intOrNull(row.year) === null) flag("year", REASONS.year);
  else if (unclear.has("year")) flag("year", REASONS.unclear);
  const dateOk = buildDate({ ...row, year: 2000 }) !== null; // month/day alone (2000 is a leap year, so Feb 29 passes here)
  if (!dateOk) { flag("month", REASONS.date); flag("day", REASONS.date); }
  else if (intOrNull(row.year) !== null && !buildDate(row)) flag("year", REASONS.date); // e.g. Feb 29 in a non-leap year, or year 1999
  for (const f of ["month", "day"]) if (unclear.has(f)) flag(f, REASONS.unclear);

  if (!cleanKickoff(row.kickoff)) flag("kickoff", REASONS.kickoff);
  else if (unclear.has("kickoff")) flag("kickoff", REASONS.unclear);

  for (const [f, max] of [["miles", 5000], ["drive_hours", 72]]) {
    const n = numOrNull(row[f]);
    if (n === null || n <= 0) flag(f, REASONS.required);
    else if (n > max) flag(f, REASONS.too_big);
    else if (unclear.has(f)) flag(f, REASONS.unclear);
  }
  return out;
}

/** Check every row, plus duplicates (same opponent and date). Returns [{ problems, skipped }] in row order. */
export function checkRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const res = list.map((r) => ({ problems: checkRow(r || {}), skipped: (r || {}).home_away === "home" }));
  const seen = new Map();
  list.forEach((r, i) => {
    if (!r || res[i].skipped) return;
    const date = buildDate(r);
    if (!date || blank(r.opponent)) return;
    const key = `${String(r.opponent).trim().toLowerCase()}|${date}`;
    if (seen.has(key)) {
      for (const j of [seen.get(key), i]) if (!res[j].problems.opponent) res[j].problems.opponent = REASONS.duplicate;
    } else seen.set(key, i);
  });
  return res;
}

export const rowIsValid = (check) => Object.keys(check.problems).length === 0;

/** Rows that will be saved -> schedule games with IDs G01…Gn in date order. Only call after every row is valid.
 * Drops home games, as_printed and unclear. */
export function toSavedGames(rows) {
  const games = rows.filter((r) => r.home_away !== "home").map((r) => ({
    opponent: String(r.opponent).trim(), city: String(r.city).trim(), stadium: String(r.stadium).trim(),
    date: buildDate(r), kickoff: cleanKickoff(r.kickoff),
    miles: Math.round(Number(r.miles) * 10) / 10, drive_hours: Math.round(Number(r.drive_hours) * 100) / 100,
    ...(r.home_away === "neutral" ? { neutral_site: true } : {}),
  }));
  games.sort((a, b) => (a.date + a.kickoff).localeCompare(b.date + b.kickoff));
  return games.map((g, i) => ({ game_id: `G${pad(i + 1)}`, ...g }));
}
