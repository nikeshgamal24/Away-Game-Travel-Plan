// Opens a hotel's source link and checks that the page backs up what Aivana said.
// Safety: https only, no private/local addresses (re-checked on every redirect), HTML only, max 1 MB,
// 6-second limit. Returns only the link and pass/fail facts: page text is never stored or returned.
//
// Known limit: the host is resolved here before each request, but fetch resolves it again itself, so a
// hostile DNS server could still answer differently the second time. Fine for a local demo tool; a
// public server would need to connect to the checked address directly.

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;

/** True for loopback, private, link-local, carrier-grade NAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip) {
  ip = String(ip).toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && Number(v4[3]) === 0) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(ip) === 6) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);   // ::ffff:7f00:1 form
    if (mapped) {
      const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = parseInt(ip.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
  }
  return true; // not an IP at all: treat as unsafe
}

/** Refuse anything but a public https URL on the default port. Returns an error reason or "". */
async function unsafeReason(u, lookup) {
  if (u.protocol !== "https:") return "only https links are checked";
  if (u.username || u.password) return "links with a login are refused";
  if (u.port && u.port !== "443") return "only the standard https port is allowed";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return "local address refused";
  if (isIP(host)) return isPrivateAddress(host) ? "private address refused" : "";
  let addrs;
  try { addrs = await lookup(host, { all: true }); } catch { return "address not found"; }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return "private address refused";
  return "";
}

// ------------------------------------------------------------------ text matching
const plain = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** Visible text of an HTML page (rough, good enough for matching). */
export function pageText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#36;|&dollar;/gi, "$").replace(/&#44;/g, ",")
    .replace(/\s+/g, " ");
}

/** All numbers in a text, with "$139", "139.00", "USD 139" and "$1,139" read as plain numbers. */
export function numbersIn(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?:US\$|USD|\$)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)/gi)) {
    out.push(Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : "")));
  }
  return out;
}
/** Numbers written as a distance: "1.2 mi", "3 miles". */
export function milesIn(text) {
  return [...String(text).matchAll(/(\d+(?:\.\d+)?)\s?(?:mi|miles?)\b/gi)].map((m) => Number(m[1]));
}
const near = (a, b) => Math.abs(a - b) < 0.005;
export const nameOnPage = (name, text) => { const n = plain(name); return n.length >= 3 && ` ${plain(text)} `.includes(` ${n} `); };
export const rateOnPage = (rate, text) => rate !== null && rate !== undefined && numbersIn(text).some((x) => near(x, rate));
export const milesOnPage = (miles, text) => miles !== null && miles !== undefined && milesIn(text).some((x) => near(x, miles));

// ------------------------------------------------------------------ the check
async function readLimited(resp, maxBytes) {
  const len = Number(resp.headers.get("content-length") || 0);
  if (len > maxBytes) { try { await resp.body?.cancel(); } catch { /* ignore */ } return null; }
  if (!resp.body) return "";
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * Open `url` and check the page mentions `name` (and, if given, the rate and the miles).
 * Returns { url, ok, reason, rate_found, miles_found }. Never returns page text.
 * Options (for tests): fetchImpl, lookup, timeoutMs, maxBytes.
 */
export async function verifySource(url, { name, rate = null, miles = null } = {},
  { fetchImpl = (...a) => fetch(...a), lookup = dnsLookup, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  const result = (ok, reason, extra = {}) => ({ url, ok, reason, rate_found: false, miles_found: false, ...extra });
  let u;
  try { u = new URL(url); } catch { return result(false, "not a valid link"); }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const why = await unsafeReason(u, lookup);
      if (why) return result(false, hop ? `redirect: ${why}` : why);
      let resp;
      try {
        resp = await fetchImpl(u.href, { redirect: "manual", signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; away-game-planner link check)", Accept: "text/html" } });
      } catch (e) { return result(false, e.name === "AbortError" ? "timed out" : "could not open the page"); }
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location");
        try { await resp.body?.cancel(); } catch { /* ignore */ }
        if (!loc) return result(false, "redirect without a target");
        try { u = new URL(loc, u); } catch { return result(false, "bad redirect"); }
        continue;
      }
      if (resp.status !== 200) { try { await resp.body?.cancel(); } catch { /* ignore */ } return result(false, `page returned ${resp.status}`); }
      const type = (resp.headers.get("content-type") || "").toLowerCase();
      if (!type.includes("text/html")) { try { await resp.body?.cancel(); } catch { /* ignore */ } return result(false, "not a web page"); }
      const html = await readLimited(resp, maxBytes);
      if (html === null) return result(false, "page over 1 MB");
      const text = pageText(html);
      if (!nameOnPage(name, text)) return result(false, "page doesn't mention the hotel");
      return result(true, "", { rate_found: rateOnPage(rate, text), miles_found: milesOnPage(miles, text) });
    }
    return result(false, "too many redirects");
  } catch (e) {
    return result(false, e.name === "AbortError" ? "timed out" : "could not open the page");
  } finally {
    clearTimeout(timer);
  }
}
