# 4-minute demo script

**Before you start:** run `npm start` with the real key in `.env`. Have a second terminal ready with `npm run mock` (offline mock) as a backup. Open the app in a fresh browser tab.

**0:00 – The problem (20 s)**

"Every away match, the BGSU men's soccer staff decide the bus, hotel and meals under a budget. The cheapest trip usually breaks the coaches' own rules, like no 6 AM departures. Our app: code does the math, staff set the rules, Aivana explains the tradeoff."

**0:15 – Season overview (15 s)**

Point at the table: "Maple Ridge is 38 miles away, so it's a day trip only under the example 50-mile policy value, which staff confirm with BGSU Travel Services. Lakeview needs an overnight, and here are the hotels that meet our needs. The season budget is entered by staff, and each trip's share follows its estimated cost. As a reference, the Benchmarks section has two synthetic sample seasons that average $8,030 per trip; staff can use one as the season budget."

**0:30 – Parse (30 s)**

1. Click **Read request with Aivana** on the sample text.
2. Say: "Structured output with a JSON Schema. The game must be one of the real schedule IDs, and anything not stated comes back empty, never guessed. The model gives 'day before'; our code turns that into a date. Staff review the fields here before anything is planned."

**1:00 – Compare (60 s)**

1. Point at **Team rules**: "Coaches set these: earliest departure 7 AM, max 1.5 hours on the bus on game day. Extras like water and electrolytes are a staff estimate."
2. Click **Compare options**.
3. Say: "Every number here is computed by our code from the data pack: 29 travelers on 1 bus, 18 rooms, tax, meals, extras."
4. Point at option C: "Stadium Suites is $149 a night, above the example $140 policy value, so it's flagged as a policy issue that needs approval."
5. Point out the pair:
   - A is **Best within budget**: $3,265.00, but it breaks 2 team rules (6 AM departure on match day, 4 hours on the bus).
   - B is **Best fit for team rules**: it keeps all 5, but it's $567.20 over the $6,000 budget.
5. Show the Aivana recommendation and the green check: "Every dollar amount it mentions is checked against our numbers."

**2:00 – Review chat (50 s)**

1. Ask: `Why is B over budget?`. Aivana answers from our numbers, and the fact check passes.
2. Type: `Leave 2 players home and put coaches two to a room`.
3. Say: "Multi-turn chat. Aivana returns *edits*, not answers: num_players add −2. Our code recomputes, and the change log on the right shows the effect on every option, with undo."
4. Point out that B is now $5,925.60, $74.40 under budget, keeps every rule, and the recommendation switches to B.

**2:50 – Review, approve, final plan (50 s)**

1. Select **B**. Show the hotel list: Budget Lodge is greyed out because it has only 20 rooms.
2. Change the pregame restaurant. The total updates instantly: "Staff decide; code reprices."
3. Show the timeline and the rooming list, which excludes injured players.
4. Pick a role and click **Approve and create trip plan**. Say: "Nothing becomes final until a staff member approves. If any rule were broken, they'd have to tick it as accepted."
5. Click **Write trip memo**. It streams in, starting with the approval line.
6. Optional: type `leave Saturday at 3 PM`. The approval is cancelled automatically and the final plan disappears until it's approved again.

**Optional, if time allows: night game (20 s)**

Type "What if it's the Harbor City game?". Option E, which stays a second night after the 7 PM game, appears automatically, because every same-night return gets home around 4–10 AM.

**Optional, if time allows: hotels from the web (30 s)**

1. In the Harbor City game, select option **B**, open **Change the hotel or restaurants**, and click **Find hotels on the web**.
2. Point at "Checked but not verified": "In our real run Aivana gave links that don't exist. Our code caught every one." Then say: "Aivana searches the web, but our code opens every link itself. A hotel stays only if its page names it, and a price stays only if it's on the page. Even then it's labeled 'web hint, not verified'."
3. Click **Use this hotel** on one, type the rate the hotel quoted, tick **I confirmed this rate with the hotel**, and click **Use this hotel**. Option B reprices instantly.
4. Click **Which hotel?**: "Aivana compares only code-built fact cards, and only confirmed hotels. The green check means every number matches. Advisory only; staff decide."

(Offline: the saved search in `data/web_cache/` is reused, so this works without internet.)

**3:40 – Rigor (20 s)**

Say: "Every amount, time, option and rule claim Aivana writes is fact-checked against our numbers. 133 tests on the math and error handling, retries on rate limits and empty-balance messages, and an accuracy test of the parser: X out of 8 requests fully correct. In 30 test trips, Y% of Aivana's answers passed the fact check, Aivana picked the app's best option Z of 30 times, and the fact checker caught all 120 planted mistakes." Use the numbers from `eval_results.md` and the demo line in `eval_trust.md` (from a real Aivana run, not mock).
