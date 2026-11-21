# Feature 2: Season budget optimizer

**Status:** Done (built with the defaults: 10% allowance, per-game budget = season plan pick; 86 tests pass)

## The problem
The season has 4 away games. Right now the app plans **each game on its own**:
- It picks the best option for each game without looking at the season budget.
- Then it splits the season budget across the games, in proportion to cost.

So the app never asks: *"Can we spend less on one trip so another trip can be better?"*
If the 4 picks together cost more than the season budget, the app just says "short for the
season" and staff have to work out the fix by hand.

## The idea
The app picks **one option for every away game together**. The code makes this choice,
not Aivana. Aivana only explains the result in plain words.

### The rules the optimizer follows
Staff set one new setting: **"Allowed over budget to protect must-have rules"**, as a
percentage of the season budget. The default is **10%**.

1. **Never go over budget + allowance.** With $20,000 and 10%, the limit is $22,000.
2. Break the **fewest must-have** rules.
3. If plans tie on must-have rules, **stay under budget**.
4. Then break the **fewest important** rules, then the fewest **nice-to-have** rules.
5. If plans still tie, the **cheapest** wins.

So the plan **only goes over budget to save a must-have rule**, never to save an important or
nice-to-have rule. Setting the allowance to 0% makes the budget strict.

## How the code finds the best season plan
It **tries every combination** and keeps the best one.

This season has 1 option for Maple Ridge, 3 for Lakeview, 2 for Riverbend and 5 for Harbor
City, so 1 × 3 × 2 × 5 = **30 combinations**. Checking all of them takes much less than a
second. Because every combination is checked, the answer is exactly the best one, not a guess.

## Example (real numbers from our data)
Settings: "Home by" is **must-have**, and the season budget is **$25,000**.

**Today (each game on its own):**

| Game | Pick | Cost | Rules broken |
|---|---|---|---|
| Maple Ridge | A (day trip) | $2,423.00 | none |
| Lakeview | B (overnight) | $6,567.20 | none |
| Riverbend | A (day trip) | $2,423.00 | 1 important |
| Harbor City | E (2 nights) | $13,597.40 | 1 important |
| **Total** | | **$25,010.60** | **$10.60 over budget** ❌ |

**With the optimizer:**

| Game | Pick | Cost | Rules broken |
|---|---|---|---|
| Maple Ridge | A | $2,423.00 | none |
| Lakeview | **A (day trip)** ← changed | $3,265.00 | 2 important |
| Riverbend | A | $2,423.00 | 1 important |
| Harbor City | E | $13,597.40 | 1 important |
| **Total** | | **$21,708.40** | **$3,291.60 under budget** ✅ |

The optimizer keeps Harbor City safe (no must-have rule broken) and saves money on Lakeview
by taking the day trip instead.

**Aivana explains:** *"To stay under $25,000, take the day trip to Lakeview (option A,
saves $3,302.20). That keeps option E for Harbor City, so players still get home on time,
which is a must-have rule."*

### Example 2: going slightly over budget
Settings: "Home by" is **must-have**, and the season budget is **$20,000**.

No plan under $20,000 keeps every must-have rule. Keeping them all costs at least
$21,708.40 (A, A, A, E).

| Allowance | Picked plan | Result |
|---|---|---|
| **10%** (up to $22,000) | A, A, A, E: $21,708.40 | ⚠️ $1,708.40 over budget, but **0 must-have rules broken**. Needs approval. |
| **5%** (up to $21,000) | A, B, A, A: $18,352.20 (was $17,952.20 before Feature 3 added the second driver) | Under budget, but ⚠️ **breaks 1 must-have rule**. "Keeping every must-have rule needs $1,708.40 more." |
| **0%** (strict) | A, B, A, A: $18,352.20 (was $17,952.20 before Feature 3 added the second driver) | Same as 5% |

### Both plans side by side
When the two plans differ, the screen shows both, so staff see what the extra money buys:
- **Strict budget plan:** the best plan that stays under the budget
- **Protect must-haves plan:** the plan picked with the allowance

The optimizer suggests a plan. **Staff decide** which one to use.

## When nothing fits
If even the cheapest season costs more than budget + allowance, the app says so: *"No
season plan fits $15,000. The cheapest season costs $X, which is $Y over."* It then shows
that cheapest plan.

## What changes on screen
In the **Season overview** section:
- A summary line, for example: "Season plan: $21,708.40 of $25,000 · breaks 0 must-have,
  4 important rules".
- A new column, **Season plan pick**. It shows the option the optimizer picked for each game,
  marked **changed** when it differs from the single-trip pick.
- A short **What changed** list, for example: "Lakeview: B → A, saves $3,302.20, breaks 2
  more important rules".
- A warning ⚠️ when the picked plan is over budget (needs approval), or when it breaks a
  must-have rule (with how much more money would avoid it).
- The two plans side by side when they differ.
- A new setting: **Allowed over budget to protect must-have rules (%)**.
- **Per-game budget** becomes the cost of the optimizer's pick, so the money for each trip
  matches the season plan. Any leftover is shown as the **season reserve**.
- An **Explain with Aivana** button that shows Aivana's short explanation, checked by the
  fact checker.
- **Plan this trip** opens that game with the optimizer's budget, so the trip view lands on the
  same pick.

## What Aivana does (and does not do)
- **Code** picks the options, adds up the costs and counts the broken rules.
- **Aivana** only explains the result in 2–4 sentences: which trips changed, how much was
  saved, and which important rule was protected.
- **Fact checker** checks every dollar amount, option and time in Aivana's text against the
  season plan.
- Aivana can't change the season plan.

## Not included (to keep it simple)
- Letting staff lock a game to a specific option ("always fly to Harbor City")
- Very big seasons. Trying every combination is fine for up to about 10 games. A faster exact
  method can be added later if needed.
- Saving the season plan or approving it. Each trip is still approved one by one, as today.

## How we will test it
1. With a budget of $30,000 (enough for everything), the season plan is the same as the
   single-trip picks.
2. With "Home by" as must-have and a budget of $25,000, the plan matches the example above:
   A, A, A, E for $21,708.40.
3. With default levels and a budget of $22,000, the plan stays under budget and breaks
   the fewest rules.
4. Compare against checking every plan by hand in the test. The optimizer's answer is never
   worse.
5. With a budget too small for any plan, it says so and shows the cheapest season.
6. "Plan this trip" with the optimizer's budget picks the same option in the single-trip view.
7. With "Home by" as must-have and $20,000: at 10% it picks A, A, A, E ($1,708.40 over,
   with a warning). At 5% it picks A, B, A, A and shows the must-have warning.
8. The optimizer never goes over budget only to save an important or nice-to-have rule.
9. Aivana's season explanation (mock mode) passes the fact checker. An invented amount is
   caught.

## Time
About 2–3 hours.

## For the developer (code details)
- `src/planner.js`: add `optimizeSeason(data, s, party)`. It builds each game's options
  with `buildPackages` (same request as `seasonOverview`), tries every combination of
  feasible options, keeps those with total ≤ budget × (1 + allowance), and ranks by
  `[must, over budget? 1 : 0, important, nice, total cost]`. It also computes the strict plan
  (allowance 0) for the side-by-side view. New setting: `season_overbudget_pct` (0–50,
  default 10).
  `seasonOverview` adds `optimizer: { picks, total, reserve, fits, changes }`, and
  `allocated_budget` becomes the picked option's cost.
- `src/aiTasks.js`: add `explainSeason(overview)` with a mock version. Its facts are the
  picks, costs, savings and broken rules by level. Reuse `checkNumbers` and `checkClaims`,
  using the season numbers as the allowed list.
- `server.js`: `POST /api/season` returns the optimizer block. Add new `POST /api/season/explain`.
- `static/app.js`, `index.html`: add the summary line, the new column, the What changed list
  and the Explain button.
