# Feature 7: Find hotels on the web + Aivana's hotel pick

**Status:** Done. 133 tests pass. The flow was browser-checked on laptop and phone. Two real Aivana runs are in `docs/evidence/`.

**Real stand-ins instead of fictional cities.** Each synthetic game searches near a real BGSU road game from 2025 of
similar distance: Maple Ridge → Michigan (U-M Soccer Stadium), Riverbend → Cleveland State (Krenzler Field),
Lakeview → DePaul (Wish Field), Harbor City → Drake (Mediacom Stadium, Des Moines). Fields: `search_city`,
`search_stadium`, `search_reference` in `data/schedule.json`.

**What the real runs showed (Drake / Des Moines):**
- Web search and JSON form output **work together** in one call, so the fallback wasn't needed.
- Aivana's response has **no sources field**, as the docs say.
- Run 1: 6 real hotels came back, all with chain booking links. Four sites blocked us (403), one rate-limited us
  (429), and one link opened a page for a different hotel. Result: "No hotel could be verified online."
- Run 2 (prompt asks for readable pages, up to 3 links): 1 hotel verified (Surety Hotel, its own website). All
  6 visitor-bureau links Aivana gave were **made up** (404 or the wrong page), and the code caught every one.
- The run 2 result is saved in `data/web_cache/`, so the demo shows it offline with no call.
- Both runs used 1 call each; Aivana reported 182 input and 0 output tokens per call, plus a search fee not listed in the docs.

Added during the build:
- An "I confirmed this rate with the hotel" checkbox. The form can't be used without it.
- Numbers are normalized before matching: `$139`, `139.00` and `USD 139` all match 139.
- `data/web_cache/` is committed. It holds only names, addresses, links and pass/fail.
- "Checked but not verified (N)" lists dropped hotels with each link's reason (name, link and reason only).

## The problem
The app only knows the 2–3 hotels per city in the data pack. In real life staff search
online for more, compare them, and call the hotel for a group rate. Today none of that can
go into the plan.

## The idea
In **Step 3 (Review & approve)**, for an overnight option:

| Step | Who | What happens |
|---|---|---|
| 1. Search | **Aivana** (web search on) | Finds up to 6 hotels near the stadium, with the pages it got them from |
| 2. Check | **Code** | Opens every source link, throws out anything it can't confirm, sorts by price, and gives IDs W1, W2… |
| 3. Confirm | **Staff** | Pick a hotel, type in the rate they actually got, rooms, bus parking, meeting room and miles, then click **Use this hotel** |
| 4. Reprice | **Code** | The option is recalculated with that hotel, the same as any data-pack hotel |
| 5. Advise | **Aivana** | A "Which hotel?" box picks one of the usable hotels and says why, using only the code's numbers |

Nothing from the web changes a total until **staff confirm it**.

## What we found in Aivana's docs (important)
- Web search **exists**: one on/off switch, `web_search: true`.
- But Aivana **does not send back its sources**. The response has no "sources" or "citations"
  field, only the answer text.
- The docs don't say whether web search works together with the JSON form output we use.

So we **can't** check "every link is in Aivana's sources", because Aivana doesn't give us that
list. Instead:
- Aivana must give a **link for every hotel** in its answer.
- The **code opens each link itself** and keeps the hotel only if the page loads and mentions
  the hotel's name.
- Hotels with no working link are dropped.

This is a stronger check, because the code sees the page itself instead of trusting a list.

## 1. Search: `Find hotels on the web`
The **code** supplies everything Aivana needs: the city, check-in and check-out dates, and
rooms needed (from the travel party). Games can get optional `search_city` and
`search_stadium` fields. Harbor City (G09) is fictional, so it gets a **real city and venue
for searching** (values from you). The rest of the trip still uses the data pack.

Aivana returns at most 6 hotels:
`name, address, nightly_rate_usd (or empty), miles_to_stadium (or empty), bus_parking (yes / no / unknown), source_urls[]`

The code then:
- keeps only links that load and mention the hotel. Hotels left with none are dropped.
- checks that the **rate** and the **miles** Aivana gave also appear on one of those pages.
  If not, it **empties** them.
- empties any rate outside **$40–$1,000** a night.
- removes duplicates (same name, or same address).
- sorts by rate, with empty rates last, and gives IDs **W1…Wn**.
- saves the result, so searching again for the same trip costs nothing. The result is saved
  to a file (`data/web_cache/`), so a real search from your test run **stays available offline**
  for the demo.

In the results table, every rate is labeled **"web hint, not verified"**. Even a rate found on
the page is only a hint until staff confirm it.

**If every link fails the check** (many hotel sites block bots), the box says: *"No hotel could
be verified online. Use the data-pack hotels."*

### How the code opens links (safety)
- **Only `https` links.** Any address that leads to this computer or a private/local network
  is refused. This is checked again after **every redirect**: the code follows redirects
  itself, at most 3 of them.
- **Only web pages** (`text/html`). PDFs and other files are skipped.
- **At most 1 MB** is downloaded per page, with a 6-second time limit.
- **Nothing from the page is stored.** The code keeps only the link and pass or fail (plus
  whether the rate and miles were found). Page text is thrown away as soon as it's checked.

## 2. Confirm: `Use this hotel`
Staff fill in a small form for the chosen hotel. Every field is required, because **staff are
the source of truth**:
nightly rate, rooms available, bus parking (yes/no), meeting room (yes/no), miles to stadium.

- The hotel is saved **only in this trip's choices**, never in `data/hotels.json`.
- It's part of the approval, like any other change. **Adding or changing it after approval
  makes the approval out of date.**
- The option is repriced and its rule checks (rate limit, bus parking, rooms) run as usual.
  Its tag says *"Rate confirmed by staff (found on the web)"*.

## 3. "Which hotel?" (Aivana's advice)
The **code** builds one fact card per usable hotel: the data-pack hotels plus **only web hotels
that staff confirmed**. An unconfirmed web hotel is never in a fact card or in any total.
Each card has:
rate, lodging cost for this trip, miles, bus parking, rules it fails, where the info came from,
and the labels *lowest cost* and *closest*.

Aivana answers with: the recommended hotel (it **must** be one of the usable IDs), a headline, a
reason under 60 words, upsides and downsides per hotel, and a list of things to confirm with the
hotel.

- The prompt says: use only the cards, copy numbers exactly, and never calculate.
- The fact checker checks the reason with the hotel cards' numbers. The box shows ✓ or ⚠.
- The box is labeled **"Advisory only. Staff decide."**

## If something goes wrong
No API key, mock mode, web search fails, or no hotel survives the checks: the app shows *"No web
results. You can still use the data-pack hotels."* Everything else works exactly as it does now.

## Mock mode
There's a fixed mock search result for Harbor City and a mock "Which hotel?" answer. In mock
mode the code **skips opening the links**, and the box says so, so the offline demo still works.

## Not included (to keep it simple)
- Booking hotels, or reading live prices from booking sites
- Saving web hotels for other trips, or into the data pack
- Web search for buses or restaurants
- Web hotels in the season plan
- Full protection against DNS tricks: the address is checked just before each request, but
  `fetch` looks the name up again itself. That's fine for a local demo tool, but a public
  server would need a fixed-address connection.

## How we will test it
1. Search returns hotels sorted by rate, with IDs W1…Wn, and empty rates last.
2. A hotel whose only link is fake, or a page that doesn't mention it, is dropped.
3. A rate of $15 or $5,000 becomes empty. Duplicates are removed.
4. A confirmed web hotel reprices option B or C by exactly the rate difference.
5. Adding a web hotel after approval → the approval is out of date (409).
6. "Which hotel?" with a made-up hotel ID is rejected.
7. Searching twice for the same trip makes only one Aivana call.
8. No key or a search error → a clear message, and the rest of the app is unchanged.
9. All existing tests still pass (110 today).
10. One real Aivana search, saved to `docs/evidence/`. Only the request and Aivana's response
    are saved, plus pass or fail for each link. **No API key and no page text.** This answers the
    open question about web search plus JSON output.
11. Link safety: an `http` link, a link to a local/private address, a redirect to one, a PDF, and
    a page over 1 MB are all refused (tested with a fake fetch, no real internet).
12. A rate or miles value that isn't on the page is emptied. A rate is always shown as "web hint,
    not verified".
13. An unconfirmed web hotel never appears in a "Which hotel?" card or in any total.
14. Every link fails → the "No hotel could be verified online" message.
15. Offline after a real run: the saved search result is reused without a call.

## Cost
A search is one Aivana call. Aivana charges the tokens plus a search fee, and **the fee amount
isn't in the docs**. "Which hotel?" is one normal call. Both are cached.

## Time
About 3 hours.

## For the developer (code details)
- `src/aivana.js`:
  - `structured({…, webSearch})` adds `webSearchOptions()` → `{ web_search: true }` (from
    the Parameters doc).
  - `extractSources(data)` returns `[]` today, because the docs have no sources field.
  - Both are marked `// TODO confirm`.
  - If web search plus `response_format` is refused, fall back to asking for JSON in the text
    and parsing it.
- `src/webCheck.js` (new): `verifySource(url, {name, rate, miles})` returns
  `{url, ok, rate_found, miles_found}` and nothing else.
  - It uses `fetch` with `redirect: "manual"`, at most 3 hops, and a 6-second timeout.
  - Before each hop it resolves the host with `dns.lookup` and refuses loopback, private,
    link-local and unique-local addresses (IPv4 and IPv6).
  - It accepts `text/html` only and reads at most 1 MB.
  - It takes a fake `fetch`/`lookup` for tests.
- `data/web_cache/` stores the search results (hotel fields and link pass/fail only). It's
  read first, before any call.
- `server.js`: `POST /api/hotels/search`, `/api/hotels/confirm` and `/api/hotels/recommend`.
  `planFingerprint` already covers `custom`, which holds the web hotel.
- `src/planner.js`:
  - `validateCustom` accepts `custom.web_hotel`.
  - `hotelOptions` / `buildPackages` include it.
  - `checkHotelText` fact-checks the "Which hotel?" reason.
- `data/schedule.json`: add `search_city` / `search_stadium` to G09 (Harbor City).
- `static/app.js`: the search button, the results table with source links, the confirm form and
  the "Which hotel?" box, all in step 3 under "Change the hotel or restaurants".
- Tests in `test/webHotels.test.js`. Update the README (features, limits, test count) and
  DEMO.md (one demo step).
