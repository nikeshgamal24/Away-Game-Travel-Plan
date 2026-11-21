# Feature 1: Rule priorities

**Status:** Done (approved and built, 76 tests pass)

## The problem
The app checks each trip option against the team rules. Right now, **every broken rule counts the same.**

So these two problems count as equal:
- The bus leaves at 5:30 AM instead of 6:00 AM *(small problem)*
- Players get home at 3:00 AM *(big problem)*

That isn't fair. Some rules matter more than others.

## The idea
Staff give each rule a level:

| Level | What it means |
|---|---|
| 🔴 **Must-have** | Very important. Try hard never to break it. |
| 🟡 **Important** | Normal rule. *(Every rule starts here.)* |
| ⚪ **Nice-to-have** | Okay to break if it saves money. |

Staff set these levels on the Settings page, with one dropdown next to each rule.

## How the app picks the best option
The app compares options in this order:

1. Which one breaks the **fewest must-have** rules?
2. If they tie, which one breaks the **fewest important** rules?
3. If they still tie, which one breaks the **fewest nice-to-have** rules?
4. If they still tie, which one is **cheapest**?

### Example
- **Option B** costs $8,000 and breaks 1 rule: *home by 1 AM* (🔴 must-have)
- **Option C** costs $9,000 and breaks 1 rule: *leave after 6 AM* (⚪ nice-to-have)

**Today:** both break 1 rule, so the app picks **B** because it's cheaper.
**With this feature:** C breaks no must-have rules, so the app picks **C**.

## Nothing breaks
Every rule starts as **Important**. If staff don't change anything, the app gives exactly
the same results as today.

## Which rules get a level
- Earliest departure time
- Max travel hours on game day
- Pregame meal time
- Hotel check-in time
- Home-by time
- BGSU policy checks: per-diem on day trips, overnight only when needed, booking flights
  early enough, hotel price limit

## What changes on screen
- **Settings:** a level dropdown next to each rule
- **Option cards:** each broken rule shows its level, and must-have rules show in red
- **Summary line:** for example, "Breaks 1 must-have rule"
- **Aivana:** the explanation names the most important rule, for example "We picked C
  because B gets players home after 1 AM, which is a must-have rule."

## Not included (to keep it simple)
- Custom point weights
- Hiding an option completely when it breaks a must-have rule. It is only ranked lower.

## How we will test it
1. With no changes, the results are the same as today.
2. With *home-by* set to must-have, the app picks the option that gets players home on time,
   even when it costs more.
3. With a rule set to nice-to-have, the cheaper option wins when that's the only difference.
4. Bad level values are rejected.
5. Changing a level after approval marks the approval as out of date.

## Time
About 1 hour.

## For the developer (code details)
- `src/planner.js`: give each rule check an `id` and a `priority`. Add `priority_<id>`
  settings (3 = must, 2 = important, 1 = nice; the default is 2). Change `rank` at line ~638
  to `[must, important, nice, cost]`.
- `data/settings.json`: add the default levels.
- `src/aiTasks.js`: send each broken rule with its level, and tell Aivana to name the top one.
- `static/app.js`, `index.html`: add the dropdowns and level tags.
