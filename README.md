# BGSU Away-Game Travel Planner: Men's Soccer

**2026 BGSU Hackathon, Project B.** The app is for the staff of BGSU men's soccer who plan away-match travel on a budget. Every trip starts and ends at the BGSU campus in Bowling Green, OH.

Default travel party (synthetic, editable): 22 players, 4 coaches, 3 staff = 29 travelers on one bus. Match timing assumptions: about 2 hours of play plus 1 hour postgame.

Planning an away trip means deciding on buses, hotel rooms, meals and departure times, all within a budget. The hard part is the tradeoff. The cheapest plan (a game-day bus ride) usually breaks the coaching staff's own rules, such as no departures before 7 AM or no long bus rides on game day.

**Design principle: code does the math, staff set the rules, Aivana explains the tradeoff.**
- The app builds comparable packages from the data pack and computes every cost in code.
- It checks each package against team rules the staff set themselves.
- Staff can pick the hotel and restaurants from the data pack.
- **Aivana** reads the request, explains the tradeoff and writes the trip memo.

## How to run

Requirements: Node.js 18 or newer. There are **no dependencies**, so there is nothing to `npm install`.

```bash
cp .env.example .env                    # then paste your key into .env
npm start                               # open http://127.0.0.1:5000
npm run mock                            # same app with the offline mock (demo backup)
```

- **No key yet?** Leave `AIVANA_API_KEY` empty, or set `AIVANA_MOCK=1`. The app then runs end to end with an offline mock and shows a **MOCK MODE** badge. Use this as the demo backup if the network fails.
- **Tests:** `npm test` runs 133 tests on the math, validation, API routes, the approval gate, the memo PDF, web hotel search and link checks, and Aivana error handling (retries, empty balance, invalid answers, streaming).
- **AI accuracy test:** `npm run eval` scores the Aivana parser field by field against 8 requests with known answers and writes `eval_results.md`.
- **Trust eval:** `npm run eval:trust` runs 30 generated trips and 10 season plans through Aivana's recommendation, memo and season explanation, fact-checks every answer, checks how often Aivana picks the app's best option, and plants 120 mistakes to prove the fact checker catches them. Writes `eval_trust.md` (about 70 Aivana calls; `-- --n 10` for a smaller run). Mock mode always scores 100% and says so.

The API key is read from the environment only. `.env` is in `.gitignore`, and the browser never sees the key, because every Aivana call goes through the Node.js backend (`server.js`).

## How it works

```
Trip request (free text or form)
  → [Aivana] structured parse ─► staff review/edit fields   (human review)
  → [code]   build packages A/B/C(/D): buses, rooms, meals, tax, extras, totals, budget gap,
             facts (departure, hotel night, game-day bus hours, return), team-rule checks,
             "best within budget" & "best fit for team rules"
  → [Aivana] structured recommendation (option-ID enum) ─► [code] number check
  ↺ review loop: staff and [Aivana] talk it through. Questions are answered from the computed
     options, changes become edits, and [code] recalculates. Every change goes into a change
     log with its effect, and staff can undo it.
  → staff review one package and pick hotel / restaurants (code reprices)
  → APPROVAL GATE (staff): role + tick every broken rule / budget overrun as accepted
       · server fingerprints the exact approved version
       · any later change cancels the approval
  → [code]   final plan only for the approved version: rooming list, memo PDF, .ics export, budget vs actual
  → [Aivana] streamed trip memo ─► [code] number check
  ↺ [Aivana] what-if chat (multi-turn) → edits → [code] applies & recomputes
```

**Packages built by code**

- A: bus day trip.
- B: bus plus one night at the cheapest hotel with enough rooms.
- C: bus plus one night at the hotel closest to the stadium.
- D: flight (group fare) plus a night at the value hotel. Offered only when the trip is 400 miles or more and a fare exists. *Our fares are synthetic and not from the data pack; remove `flight_fares.json` if the official pack has none.*
- E: **night games.** Bus plus 2 nights, staying after the game and driving home the next morning. It's added automatically when a same-day return would break the "home by" rule. Code adds the second hotel night, driver overnight fees, the next-morning breakfast and a per-diem meal on the drive home.

**Team rules (set by staff in Settings; code checks every option)**

| Rule | Default (placeholder) |
|---|---|
| Earliest departure | 7:00 AM |
| Max hours on the bus on game day | 1.5 |
| Pregame meal: hours before kickoff | 3 |
| Arrive in the stadium city: hours before kickoff | 3 |
| Latest hotel check-in | 10:00 PM |
| Home by | midnight, counted on the day you travel home |

Staff can also require the hotel to have **bus parking** (required by default) or a **meeting room**. Hotels that don't qualify are greyed out with the reason, and bus parking fees are added to lodging.

**Travel-policy checks (example values, not BGSU's current policy)**

Each value is an editable setting labeled "Example policy value – confirm with BGSU Travel Services". The defaults were modeled on BGSU's published employee-travel guidance, but the app, Aivana's prompts and the memo never state them as BGSU's current policy. NCAA team travel may follow different rules.

| Check | Default | Source idea |
|---|---|---|
| Overnight only if the game is over N miles **and** a same-day trip breaks the departure / home-by rules | 50 miles | Overnight stays are reimbursed only over 50 miles when early or late attendance is needed |
| Per diem only for meals not provided as team meals | always checked | No per diem when group meals are provided |
| Same-day trip: no per-diem meal cash | always checked | No meal reimbursement for same-day travel |
| Hotel at or under a nightly limit (above needs prior approval) | $140/night | Other athletics departments require prior approval above per-diem lodging rates |
| Flights bought at least N days before travel (flight options only) | 30 days | BGSU travel tips: "Purchase tickets 30 or more days in advance of travel" |

After approval, step 4 also shows an **example expense-report checklist** (confirm with BGSU Travel Services): one report per trip, due within 90 days of travel (the app computes the date), first and last days counted as travel days, no per diem for team-provided meals, and no receipts needed under $25 for tolls, taxis and parking.

Where the example defaults came from: [BGSU Travel Expenses Quick Guide](https://www.bgsu.edu/finance-and-administration/controller/policies-and-forms/travel-expenses-quick-guide.html) · [BGSU Travel Reimbursement Tips](https://www.bgsu.edu/content/dam/BGSU/finance-and-administration/controller/documents/chromeriver/travel-reimbursment-tips.pdf)

Policy issues don't block an option. They have to be ticked as accepted at approval, just like broken team rules.

The app reports only plain facts and pass/fail against these rules. There is no opinion-based score.
- **Best within budget:** the option within budget that breaks the fewest rules, then the cheapest.
- **Best fit for team rules:** the option that breaks the fewest rules overall, then the cheapest.

**Staff choices**
- In step 3, staff pick the hotel and the restaurant for each meal from the data pack.
- Options that can't work are greyed out with the reason, such as "no bus parking (team rule)" or "seats 30, team is 31".
- What the team eats is the staff's decision. The app plans only where, when and how much.

**Extras** cover water, electrolytes, snacks and trainer supplies. These aren't in the data pack, so staff enter a per-traveler-per-day amount and a flat amount. They appear as a separate "staff estimate" cost line.

## Aivana features used

| Feature | Where | Why it helps |
|---|---|---|
| **Structured output (JSON Schema)** | Request parsing | Turns free text into fields. `game_id` is an `enum` of real schedule IDs. Unknown values must be `null`, never guessed. The model returns a *relative* day (`day_before`), and code turns it into a date. |
| **Structured output (JSON Schema)** | Recommendation | `recommended_option_id` is an `enum` of the built option IDs, and there are per-option upside and downside fields. It receives facts and rule results only. Code also rejects infeasible choices and retries once with feedback. |
| **Multi-turn chat + structured output** | What-if chat | Aivana returns edits, never results, and code applies them. History is trimmed to the last 8 messages. Supported requests: headcount ("leave 3 players home" → `num_players add -3`), people per room, seats per bus, meal allowance, supplies, hotel rate cap, budget, **departure day and time** ("leave Saturday at 3 PM" → `day_before` + `15`, code computes the date), **hotel** ("switch to Stadium Suites" → a hotel ID from the list, which becomes a staff choice) and **game** ("what if it's the Harbor City game?"). Unknown IDs are rejected. |
| **Web search + structured output** | Find hotels on the web (step 3) | `web_search: true`. Aivana finds up to 6 hotels near the stadium, each with source links. **Code** cleans them (rates outside $40–$1,000 emptied, duplicates and hotels without a link dropped), **opens every link itself** and keeps a hotel only if the page names it. A rate or distance is kept only if it appears on the page (`$139`, `139.00` and `USD 139` all count). Rates are shown as "web hint, not verified". Results are numbered W1…Wn, sorted by rate. |
| **Structured output (JSON Schema)** | "Which hotel?" (step 3) | `recommended_hotel_id` is an `enum` of usable hotels. Aivana sees only code-built fact cards (rate, lodging cost for this trip, miles, parking, rules failed, source, lowest-cost/closest labels) and must copy numbers exactly. The reason is fact-checked against the cards. Labeled "Advisory only. Staff decide." |
| **Streaming** | Trip memo | `/v1/generate:stream`, rendered word by word. It is written only from the computed plan facts. |

**Rule enforcement: the model never does math or supplies facts**

- All counting, costing, sorting and scheduling is in `src/planner.js` and covered by unit tests.
- Prompts send only the computed package summary, never the whole data pack, and forbid new numbers.
- **Fact check on all AI text** (recommendation, chat reply, memo):
  - Every **dollar amount** must match a computed figure or a staff setting.
  - Every **clock time** must appear in a computed schedule or a team rule.
  - Every **"option X"** must exist.
  - Claims like "option X keeps all rules" or "breaks 2 rules" must match the computed rule checks.
  - Anything that fails is flagged in the UI.

**Token management**

- Prompts are compact JSON.
- `effort: "low"` is used.
- `max_tokens` is capped per call (300–700).
- Chat history is limited to 8 turns.
- Identical requests reuse earlier answers: the same request text isn't parsed twice, and the recommendation is reused while the options are unchanged (e.g. after undo or reload).
- The header shows calls, tokens and reused answers; hover it for a per-call-type breakdown (parse, recommend, chat, memo).
- No PDFs are sent.
- Web hotel searches are cached in memory and saved to `data/web_cache/`, so a repeat search costs nothing.
- The header shows the running call count and token total.

## Season overview (per-game hotels and budgets)

Above step 1, code shows every away game with:
- **Overnight verdict:**
  - Within 50 miles (example policy value) → day trip only, no hotel.
  - Farther → an overnight is recommended only when a same-day trip breaks the departure or home-by rules. Otherwise the app says the day trip fits and an overnight would need justification.
- **Hotel recommendations:** the best-value and closest hotels that meet the team's needs, with rate, bus parking (and fee), meeting room, rate-limit flag and 1-night lodging cost. It also lists excluded hotels with the reason.
- **Per-game budget:** the season travel budget × (this trip's estimated cost ÷ sum of all trips' estimated costs), rounded to $100. **Plan this trip** fills the form with that budget.

**Season budget.** Staff enter the season travel budget (default $30,000, a placeholder). The app splits it across away trips by each trip's estimated cost, because a long trip with a hotel costs several times a short day trip. Trip prices come from the synthetic data pack.

**Benchmarks (synthetic).** `data/benchmarks.json` holds two made-up sample seasons, not real BGSU records, because the brief allows synthetic data only. The app uses them only to suggest a season budget, and all per-trip math is done in code.

| Sample season | Team travel | Trips | Per trip | Players | Per player per trip |
|---|---|---|---|---|---|
| A | $30,800 | 4 | $7,700.00 | 22 | $350.00 |
| B | $33,440 | 4 | $8,360.00 | 22 | $380.00 |
| 2-season average | | | $8,030.00 | | $365.00 |

- **Use as season budget** sets the season budget to the chosen per-player-per-trip rate × our players × our away trips.
- The benchmark file is optional: replace it with your own past figures, or delete it and staff simply enter the budget.

## Review loop and approval gate (human in the loop)

1. **Compare & adjust.** The review chat works as a conversation.
   - **Questions** ("why is B over budget?") are answered from the current computed options.
   - **Requests** ("leave 2 players home") become edits, and code recalculates.
   - Aivana gets the list of **changes so far**, so it knows what is already in effect.
   - The **Changes so far** panel shows each change (chat or staff pick) with its effect on every option, e.g. "B: $6,567.20 → $5,925.60 ($74.40 under)". **Undo last** reverts it.
2. **Review & approve.** Staff open one option, adjust the hotel and restaurants, then approve it.
   - Approving requires the approver's **role**, not a name.
   - Every broken team rule and any budget overrun must be **ticked as accepted**.
   - The server checks this.
3. **Final trip plan.** The rooming list, streamed memo (download as PDF or .txt), calendar export and budget-vs-actual are produced **only for the approved version**.
   - The server stores a fingerprint of the approved request, settings, staff picks and option.
   - It refuses with `403` before approval and `409` once anything has changed.
   - Any change after approval cancels it, and the UI says why.
   - The memo starts with the approval line.

## Usability

- **Settings:** collapsed by default, with a one-line summary of the current team rules. Clock-time rules use dropdowns (e.g. "7:00 AM", "Midnight") instead of decimal hours.
- **Planning assumptions:** game length, postgame time, usual departure times and local bus speed are shown under "Planning assumptions", so nothing is hidden in code.
- **Saving:** the current trip (form, settings, chat, chosen plan and staff choices) is saved in this browser and restored on reload. "Start new trip" clears it.
- **Unsupported requests:** when the chat can't do something, it says which changes it supports.

## Reliability

- **Bad input:**
  - Unknown game, non-numbers, negatives, departure after kickoff, out-of-range settings → clear messages, nothing sent to the model.
  - Free text that doesn't state a field → the field is highlighted for staff to fill in.
- **API errors:**
  - Retries `429/502/504` and network failures up to 3 times, honoring `Retry-After` or `retry_after_ms`.
  - Clear messages for `401` (bad key), `402` (empty balance), `403`, `413` and `422`, including Aivana's `request_id`.
  - If the recommendation fails, staff can still compare and select options.
- **Human review:**
  - Parsed fields are shown for confirmation before planning.
  - The recommendation is labeled advisory, and staff choose the package.
- **Disclaimer:** costs are estimates from the data pack, shown with every comparison and in the memo.

## Level checklist

| Level | Feature | Status |
|---|---|---|
| 1 Core | Free-text or form request → structured parse | ✅ |
| 1 Core | Code computes buses, rooms, meals and totals for 3 packages | ✅ |
| 1 Core | Aivana recommends and explains tradeoffs by option ID | ✅ |
| 1 Core | Editable seats per bus, room occupancy and meal allowance; estimate disclaimer | ✅ |
| 2 Standard | What-if chat that updates the request and recomputes | ✅ |
| 2 Standard | Streamed trip memo with itinerary | ✅ |
| 3 Advanced | Staff-set team rules checked for every option | ✅ |
| 3 Advanced | Staff picks hotel and restaurants from the data pack (human in the loop) | ✅ |
| 3 Advanced | Rooming list assignment (injured players excluded) | ✅ |
| 3 Advanced | Risk notes: over budget, no restaurant seats the team, over meal allowance, breakfast not budgeted | ✅ |
| 3 Advanced | Exported itinerary (.ics calendar + memo as PDF or .txt) | ✅ |
| 3 Advanced | Budget vs actual after the trip | ✅ |
| 3 Advanced | Night-game option E (stay after the game) | ✅ |
| 3 Advanced | Hotel needs (bus parking + fee, meeting room) and example travel-policy checks (values to confirm with BGSU Travel Services) | ✅ |
| 3 Advanced | Season overview: 50-mile rule, per-game hotel recommendations, per-game budget split | ✅ |
| 3 Advanced | Review loop: change log with effects + undo; chat answers questions from computed data | ✅ |
| 3 Advanced | Server-enforced approval gate before the final plan; approval cancelled by any change | ✅ |
| 3 Advanced | AI accuracy test (`npm run eval`) and fact check on AI text: amounts, times, option IDs, rule claims | ✅ |

## Project layout

```
server.js             Node.js HTTP server and routes (no AI logic, no math), built-in modules only
src/planner.js        all calculations, validation, rule and policy checks, rooming list, fact check
src/aiTasks.js        prompts, JSON Schemas, validators and offline mocks for each Aivana call
src/aivana.js         the only file that calls Aivana (auth, retries, streaming, token tally)
src/util.js           rounding, money formatting and date helpers
src/webHotels.js      web hotel results: cleaning, sorting, W-IDs, "Which hotel?" fact cards and fact check
src/webCheck.js       opens hotel source links safely (https only, no private addresses, HTML only, 1 MB cap)
src/pdf.js            dependency-free PDF writer for the trip memo
data/                 synthetic data pack (JSON)
data/web_cache/       saved real web hotel searches (names, links, pass/fail only); committed so the demo works offline
static/               front end (HTML, CSS, JS)
test/                 unit + API tests (node:test)
scripts/eval-parse.js parser accuracy test
scripts/eval-trust.js trustworthiness eval (logic in src/trustEval.js)
scripts/web-hotels-evidence.js  one real web hotel search, saved to docs/evidence/ and data/web_cache/
```

## Using the official data pack

The files in `data/` are our own synthetic stand-ins with the same kinds of fields the brief lists: roster, schedule, hotels, restaurants and bus rates. To use the organizers' pack, convert it to these shapes or adapt `loadData()` in `src/planner.js`.

| File | Fields |
|---|---|
| `schedule.json` | `game_id, opponent, city, stadium, date, kickoff, miles, drive_hours`, optional `search_city, search_stadium` (a real place for web hotel search) |
| `hotels.json` | `hotel_id, city, name, nightly_rate, miles_to_stadium, rooms_available, breakfast_included` |
| `restaurants.json` | `restaurant_id, city, name, meal_types, price_per_person, miles_to_stadium, group_max` |
| `bus_rates.json` | `vendor_id, name, per_mile, min_charge, driver_overnight_fee` |
| `roster.json` | players `player_id, position, year, depth_rank, status`, plus coaches and staff (IDs and roles only) |
| `flight_fares.json` | optional; our own synthetic fares |

## Known limits

- Schedule, hotels and costs are synthetic; web hotel search uses real cities as stand-ins.
- Costs are **estimates** from the data pack, not live prices or availability.
- Drive times come from the schedule data, and there is no live traffic or map service.
- **Package rules:**
  - Overnight packages use one night.
  - The value hotel is the cheapest one with enough rooms, and the closest hotel is the one nearest the stadium.
  - Mixed hotels and split buses are not modeled.
- **Meals:**
  - Meals use the cheapest restaurant that fits the whole group within the allowance.
  - If no restaurant fits, the plan uses a per-diem and flags it.
  - Breakfast on day trips is not budgeted, and this is flagged.
- **Team rule and extras defaults:** these are placeholders. Coaching staff should set their own.
- **Meal content and nutrition:** not covered. The app plans only where, when and cost.
- **Web hotels:**
  - The four games are fictional. For web search each one uses a **real BGSU road game from the 2025 season** of similar distance as a stand-in: Maple Ridge → Michigan (U-M Soccer Stadium, Ann Arbor), Riverbend → Cleveland State (Krenzler Field), Lakeview → DePaul (Wish Field, Chicago), Harbor City → Drake (Mediacom Stadium, Des Moines). Venues are from BGSU Athletics' 2025 match previews. Trip miles, drive times, costs and the data-pack hotels still come from the synthetic data pack.
  - A web hotel changes a total only after staff type in the rate, rooms, parking, meeting room and miles, and tick "I confirmed this rate with the hotel". It is stored in that trip's choices only, never in `data/hotels.json`, and adding it after approval cancels the approval.
  - Aivana's response has no sources field (per its docs), so the code opens each link itself. Many hotel sites block automated visitors; if every link fails, the app says "No hotel could be verified online. Use the data-pack hotels." Dropped hotels are listed under "Checked but not verified" with each link's reason.
  - In our real run for Des Moines (`docs/evidence/`), chain booking sites blocked the check (403/429), and every visitor-bureau link Aivana gave was made up (404 or the wrong hotel). The code caught all of them and kept one hotel verified on its own website.
  - Link checks resolve the address just before each request, but `fetch` resolves it again itself. That's fine for a local tool; a public server would need to connect to the checked address directly.
  - Aivana charges a separate web search fee that its docs don't list. Searches are cached to keep it to one per trip.
  - In mock mode, the sample results are marked SAMPLE and links are not opened.
  - The rest of the app works the same with no key, or if web search fails.
- **Flight option:** uses our own synthetic fares, because the official data pack has no flight prices.
- **Fact check:** pattern-based. It covers dollar amounts, clock times, option IDs and rule-count claims, but not every possible phrasing (e.g. hours or headcounts in words).
- **Post-season:** bowl trips are out of scope; BGSU reports them separately.
- **Saved trips:** kept in this browser only, not shared between devices. Approvals are stored in a local `approvals.json` file; there are no user accounts, so the "approved by" role is self-declared.
- **Option E:** uses the same hotel availability for both nights.
- **Mock mode:** uses simple pattern matching, so it understands fewer phrasings than Aivana.
- **Data:** all data is synthetic. Players, coaches and staff are IDs only, with no real names or records.
