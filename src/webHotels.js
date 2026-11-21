// Feature 7: web hotel search results and hotel fact cards. Plain code: no AI here.
// Aivana finds candidates; this file cleans them, checks their links, sorts them and numbers them W1..Wn.
// Nothing here changes a trip total: a web hotel only counts after staff confirm it (planner.cleanWebHotel).

import * as planner from "./planner.js";
import { verifySource, milesIn } from "./webCheck.js";
import { money, round } from "./util.js";

export const RATE_MIN = 40, RATE_MAX = 1000, MAX_HOTELS = 6, MAX_LINKS = 3;
export const NONE_VERIFIED = "No hotel could be verified online. Use the data-pack hotels.";
export const NO_RESULTS = "No web results. You can still use the data-pack hotels.";

const addDaysISO = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const plainName = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** What to search for, all from the code: real search city and venue, dates and rooms for this option. */
export function searchQuery(plan, pkg, { allowFictional = false } = {}) {
  const g = plan.game;
  if (!pkg || !pkg.nights || !pkg.facts?.hotel_checkin) return [null, "This option has no hotel night."];
  const city = g.search_city || (allowFictional ? g.city : null);
  if (!city) return [null, `Web search isn't set up for ${g.opponent}: add search_city and search_stadium to data/schedule.json.`];
  const checkin = pkg.facts.hotel_checkin.slice(0, 10);
  return [{ city, stadium: g.search_stadium || g.stadium, reference: g.search_reference || "", checkin, checkout: addDaysISO(checkin, pkg.nights),
    nights: pkg.nights, rooms: plan.counts.rooms }, ""];
}

/** Step 1: Aivana's raw list -> clean candidates (rates in range, https links, no duplicates, no hotel without a link). */
export function cleanCandidates(raw, sources = []) {
  const allowed = new Set(sources.map((x) => x.url));
  const seen = new Set();
  const out = [];
  for (const h of Array.isArray(raw?.hotels) ? raw.hotels : []) {
    const name = String(h?.name || "").trim().slice(0, 120);
    if (!name) continue;
    const address = String(h?.address || "").trim().slice(0, 200);
    const keys = [plainName(name), plainName(address)].filter((k) => k.length > 3);
    if (keys.some((k) => seen.has(k))) continue;                        // same name or same address
    const urls = [...new Set((Array.isArray(h?.source_urls) ? h.source_urls : []).map(String))]
      .filter((u) => /^https:\/\/[^\s]+$/.test(u))
      .filter((u) => !allowed.size || allowed.has(u))                   // if Aivana ever lists sources, links must be in them
      .slice(0, MAX_LINKS);
    if (!urls.length) continue;                                         // no source, no hotel
    keys.forEach((k) => seen.add(k));
    const rate = Number(h?.nightly_rate_usd);
    const miles = Number(h?.miles_to_stadium);
    out.push({ name, address,
      nightly_rate_usd: h?.nightly_rate_usd !== null && Number.isFinite(rate) && rate >= RATE_MIN && rate <= RATE_MAX ? round(rate, 2) : null,
      miles_to_stadium: h?.miles_to_stadium !== null && Number.isFinite(miles) && miles >= 0 && miles <= 100 ? round(miles, 2) : null,
      bus_parking: ["yes", "no"].includes(h?.bus_parking) ? h.bus_parking : "unknown",
      source_urls: urls });
    if (out.length >= MAX_HOTELS) break;
  }
  return out;
}

/** Step 2: open every link. Keep a hotel only if a page loads and names it; keep its rate/miles only if a page shows them.
 * Returns { kept, rejected }; rejected hotels keep only their name and each link's pass/fail reason. */
export async function checkCandidates(cands, verify = verifySource) {
  const kept = [], rejected = [];
  await Promise.all(cands.map(async (h, i) => {
    const checks = await Promise.all(h.source_urls.map((u) =>
      verify(u, { name: h.name, rate: h.nightly_rate_usd, miles: h.miles_to_stadium })
        .catch(() => ({ url: u, ok: false, reason: "could not open the page", rate_found: false, miles_found: false }))));
    const sources = checks.map((c) => ({ url: c.url, ok: c.ok, reason: c.reason || "" }));   // link + pass/fail only
    const good = checks.filter((c) => c.ok);
    if (!good.length) { rejected[i] = { name: h.name, sources }; return; }
    kept[i] = { ...h,
      nightly_rate_usd: good.some((c) => c.rate_found) ? h.nightly_rate_usd : null,
      miles_to_stadium: good.some((c) => c.miles_found) ? h.miles_to_stadium : null, sources };
  }));
  return { kept: kept.filter(Boolean), rejected: rejected.filter(Boolean) };
}

/** Step 3: sort by rate (empty rates last), then name; number W1..Wn. */
export function numberHotels(hotels) {
  return [...hotels]
    .sort((a, b) => (a.nightly_rate_usd ?? Infinity) - (b.nightly_rate_usd ?? Infinity) || a.name.localeCompare(b.name))
    .map((h, i) => ({ hotel_id: `W${i + 1}`, ...h }));
}

/** The whole pipeline. `mock` skips opening links (offline demo) and says so. */
export async function processSearch(raw, { sources = [], verify = verifySource, mock = false } = {}) {
  const cands = cleanCandidates(raw, sources);
  if (!cands.length) return { hotels: [], rejected: [], links_checked: !mock, status: "no_results", message: NO_RESULTS };
  const { kept, rejected } = mock
    ? { kept: cands.map((h) => ({ ...h, sources: h.source_urls.map((url) => ({ url, ok: null, reason: "not checked (mock mode)" })) })), rejected: [] }
    : await checkCandidates(cands, verify);
  if (!kept.length) return { hotels: [], rejected, links_checked: true, status: "none_verified", message: NONE_VERIFIED };
  const hotels = numberHotels(kept).map(({ source_urls: _, ...h }) => h);
  return { hotels, rejected, links_checked: !mock, status: "ok", message: "" };
}

// ------------------------------------------------------------------ "Which hotel?" fact cards
/** One card per usable hotel for this option: data-pack hotels plus only a web hotel staff confirmed. */
export function hotelCards(plan, pkg, data, s) {
  const extra = plan.custom?.web_hotel ? [plan.custom.web_hotel] : [];
  const hotels = planner.hotelOptions(data, plan.game.city, plan.counts, pkg.nights, s, extra).filter((h) => h.usable);
  const lim = s.policy_lodging_rate_limit;
  const cards = hotels.map((h) => ({
    hotel_id: h.hotel_id, name: h.name, nightly_rate: h.nightly_rate, trip_lodging_cost: h.lodging_cost,
    miles_to_stadium: h.miles_to_stadium, bus_parking: h.bus_parking ? "yes" : "no", meeting_room: h.meeting_room ? "yes" : "no",
    breakfast_included: h.breakfast_included ? "yes" : "no",
    rules_failed: h.nightly_rate > lim ? [`Hotel rate limit: $${money(lim)}/night (above needs prior approval)`] : [],
    source: h.source === "web" ? "web, rate confirmed by staff with the hotel" : "data pack",
    in_this_option_now: pkg.hotel?.hotel_id === h.hotel_id, labels: [] }));
  if (cards.length) {
    const low = Math.min(...cards.map((c) => c.trip_lodging_cost));
    const near = Math.min(...cards.map((c) => c.miles_to_stadium));
    for (const c of cards) {
      if (c.trip_lodging_cost === low) c.labels.push("lowest_cost");
      if (c.miles_to_stadium === near) c.labels.push("closest");
    }
  }
  return cards;
}

/** Fact-check Aivana's hotel advice against the cards: every $ amount, distance and hotel ID must be on a card. */
export function checkHotelText(text, cards) {
  text = String(text || "");
  const dollars = new Set();
  const miles = new Set(cards.map((c) => c.miles_to_stadium));
  for (const c of cards) {
    dollars.add(c.nightly_rate); dollars.add(c.trip_lodging_cost);
    for (const r of c.rules_failed) for (const m of r.matchAll(/\$([\d,]+(?:\.\d+)?)/g)) dollars.add(Number(m[1].replace(/,/g, "")));
  }
  const has = (set, x) => [...set].some((v) => Math.abs(v - x) < 0.005);
  const numbers = [], claims = [];
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)) {
    const x = Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : ""));
    if (!has(dollars, x)) numbers.push(m[0].trim());
  }
  for (const x of milesIn(text)) if (!has(miles, x)) numbers.push(`${x} mi`);
  const ids = new Set(cards.map((c) => c.hotel_id));
  for (const m of text.matchAll(/\b([HW]\d{1,2})\b/g)) if (!ids.has(m[1])) claims.push(`mentions hotel ${m[1]}, which is not one of the usable hotels`);
  return { unverified_numbers: [...new Set(numbers)], unverified_claims: [...new Set(claims)] };
}
