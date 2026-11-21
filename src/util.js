// Small helpers so money, rounding, dates and text come out exactly the same everywhere.
// Times are "naive" local trip times (no time zone), stored as milliseconds on a UTC clock.

import { createHash } from "node:crypto";

// ------------------------------------------------------------------ numbers

/** Round like Python's round(): correct for the stored binary value, ties go to the even digit. */
export function round(x, digits = 0) {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** digits;
  const m = x * f;
  if (Number.isInteger(m)) return m / f;
  // exact tie (e.g. 2.5, 0.125) -> half to even
  if (Number.isInteger(m * 2) && Math.abs(m * 2) < 2 ** 52) {
    const lo = Math.floor(m);
    return (lo % 2 === 0 ? lo : lo + 1) / f;
  }
  return Number(x.toFixed(digits));
}

/** $1,234.50 style without the $: two decimals and thousands commas. */
export function money(x) {
  const neg = x < 0;
  const [int, dec] = Math.abs(x).toFixed(2).split(".");
  return (neg ? "-" : "") + int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + dec;
}

/** Python's "{:g}": up to 6 significant digits, no trailing zeros. */
export function g(x) {
  if (x === null || x === undefined) return String(x);
  if (x === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(x)));
  const sig = Number(x.toPrecision(6));
  const e2 = Math.floor(Math.log10(Math.abs(sig)));
  if (e2 < -4 || e2 >= 6) {
    let [mant, e] = sig.toExponential(5).split("e");
    mant = mant.includes(".") ? mant.replace(/0+$/, "").replace(/\.$/, "") : mant;
    const n = Number(e);
    return `${mant}e${n < 0 ? "-" : "+"}${String(Math.abs(n)).padStart(2, "0")}`;
  }
  void exp;
  return String(sig);
}

/** Python int(x): numbers are truncated, strings must be whole numbers, true/false are 1/0. */
export function toInt(x) {
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "number" && Number.isFinite(x)) return Math.trunc(x);
  if (typeof x === "string" && /^\s*[+-]?\d+\s*$/.test(x)) return parseInt(x, 10);
  throw new TypeError("not an integer");
}

/** Python float(x) for numbers, numeric strings and booleans. Rejects anything else and non-finite values. */
export function toFloat(x) {
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(x)) return parseFloat(x);
  throw new TypeError("not a number");
}

export const isNum = (x) => typeof x === "number" && Number.isFinite(x);
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Compare arrays of keys like Python tuples (false < true, numbers, strings). */
export function cmpKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    const x = typeof a[i] === "boolean" ? +a[i] : a[i];
    const y = typeof b[i] === "boolean" ? +b[i] : b[i];
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
/** Stable sort by a key function returning an array (like Python's sorted(key=...)). */
export const sortBy = (xs, key) => [...xs].sort((a, b) => cmpKeys(key(a), key(b)));
/** First item with the smallest key (like Python's min(key=...)). */
export function minBy(xs, key) {
  let best = null, bk = null;
  for (const x of xs) {
    const k = key(x);
    if (best === null || cmpKeys(k, bk) < 0) { best = x; bk = k; }
  }
  return best;
}
export const unique = (xs) => [...new Set(xs)];

// ------------------------------------------------------------------ dates

const MS_H = 3600e3, MS_D = 86400e3;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

/** "2027-09-18" or "2027-09-18T12:00[:00]" -> ms. Throws on anything else. */
export function parseDT(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(s));
  if (!m) throw new RangeError("bad date");
  const [y, mo, d, h = 0, mi = 0, se = 0] = m.slice(1).map((v) => (v === undefined ? 0 : Number(v)));
  const t = Date.UTC(y, mo - 1, d, h, mi, se);
  const c = new Date(t);
  if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d || h > 23 || mi > 59 || se > 59) {
    throw new RangeError("bad date");
  }
  return t;
}
/** Add hours, rounded to the microsecond like Python's timedelta. */
export const addHours = (t, h) => t + Math.round(h * 3600e6) / 1000;
export const addDays = (t, d) => t + d * MS_D;
export const dayStart = (t) => Math.floor(t / MS_D) * MS_D;
export const hoursBetween = (a, b) => (a - b) / MS_H;
export const daysBetween = (a, b) => Math.round((dayStart(a) - dayStart(b)) / MS_D);
export const hourOf = (t) => new Date(t).getUTCHours();
export const clockHours = (t) => { const d = new Date(t); return d.getUTCHours() + d.getUTCMinutes() / 60; };
export const hm = (t) => { const d = new Date(t); return [d.getUTCHours(), d.getUTCMinutes()]; };

const p2 = (n) => String(n).padStart(2, "0");

/** strftime with the codes this app uses: %Y %m %d %H %M %I %p %a %A %b */
export function strftime(t, fmt) {
  const d = new Date(t);
  const H = d.getUTCHours();
  const map = {
    Y: String(d.getUTCFullYear()), m: p2(d.getUTCMonth() + 1), d: p2(d.getUTCDate()), H: p2(H),
    M: p2(d.getUTCMinutes()), I: p2(H % 12 || 12), p: H < 12 ? "AM" : "PM",
    a: DAYS[d.getUTCDay()].slice(0, 3), A: DAYS[d.getUTCDay()], b: MONTHS[d.getUTCMonth()].slice(0, 3),
  };
  return fmt.replace(/%([YmdHMIpaAb])/g, (_, c) => map[c]);
}
export const fmtT = (t) => strftime(t, "%Y-%m-%dT%H:%M");
export const fmtDate = (t) => strftime(t, "%Y-%m-%d");
/** "Sat 1:00 PM" */
export const fmtDayTime = (t) => strftime(t, "%a %I:%M %p").replaceAll(" 0", " ");

/** Today's local date as a trip-clock day (so a test can replace it). */
export let today = () => {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
};
export function setToday(fn) { today = fn; }

/** Local wall-clock "now" as YYYY-MM-DDTHH:MM. */
export function nowLocal() {
  const n = new Date();
  return `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}T${p2(n.getHours())}:${p2(n.getMinutes())}`;
}

// ------------------------------------------------------------------ json

/** JSON with sorted keys, for fingerprints and cache keys. */
export function stableStringify(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const clone = (v) => JSON.parse(JSON.stringify(v));
