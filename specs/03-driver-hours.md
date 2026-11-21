# Feature 3: Driver-hours check

**Status:** Done (approved and built, 95 tests pass)

## The problem
A bus driver can only drive so many hours safely. US federal rules for bus drivers allow
about **10 hours of driving** before a long rest.

The app doesn't check this today. For example, the **Harbor City day trip** has the driver go
9.5 hours there and 9.5 hours back on the same day, **19 hours of driving**. The app prices
it with one driver, as if that were fine.

## The idea
1. Staff set one limit: **"Max driving hours for one driver"**. The default is **10 hours**.
   Confirm the real number with the bus company.
2. For each bus option, the code works out the **longest driving stretch**, meaning the
   driving between two rests (hotel nights).
3. If that stretch is longer than the limit, the code:
   - **adds a second driver** to every bus, and
   - **adds the second driver's cost** to the transport cost.
4. If even **two drivers** can't cover it (more than 2 x the limit), the option is marked
   **not possible**.

The code does all of this. Aivana only explains it.

## How the driving stretch is counted

| Option | Driving stretches |
|---|---|
| Day trip | There + back, all in one day |
| Overnight (1 night) | Day 1: drive there. Game day: hotel to stadium + drive home |
| Stay after the game (2 nights) | Day 1: drive there. Game day: short local drives. Day 3: drive home |
| Flight | Not checked: the local buses only make short trips |

The longest stretch is the one compared with the limit.

## New settings (staff can edit)
- **Max driving hours for one driver:** default 10
- **Second driver cost per bus:** default $400. This is a placeholder, so staff enter the
  bus company's real price.

## Example (real numbers from our data)

| Game | Day trip driving | Result |
|---|---|---|
| Maple Ridge | 1.8 hrs | ✅ 1 driver |
| Riverbend | 4 hrs | ✅ 1 driver |
| Lakeview | 8 hrs | ✅ 1 driver |
| **Harbor City** | **19 hrs** | ⚠️ **2 drivers**, +$400 per bus |

The Harbor City overnight options drive at most 9.7 hours in one day (the game-day drive home
plus the short trip from the hotel to the stadium), under 10, so they keep 1 driver.

## Is this a "rule" with a level?
**No.** Driver hours are a safety and legal limit, so the app **never breaks** them. It adds a
driver instead, which costs money. That's why this check gets no must-have or important level
from Feature 1. It shows up as a cost and a note, not as a broken rule.

## What changes on screen
- **Option cards:** a new fact, "Longest driving stretch: 19 hrs (2 drivers per bus)"
- **Cost breakdown:** the transport line shows "includes second driver: $400.00"
- **Notes:** "Needs a second driver: 19 hrs of driving in one stretch, limit 10 hrs"
- **Season plan:** it uses the new costs automatically, so the Harbor City day trip now costs
  $400 more there too.

## What Aivana does
- **Code:** counts the hours, decides if a second driver is needed, and adds the cost
- **Aivana:** mentions it in the explanation and memo, for example "Option A needs a
  second driver for the 19-hour day."
- **Fact checker:** the $400 is a known number, so Aivana can quote it

## Not included (to keep it simple)
- The driver's total work day (on-duty time, including waiting during the game)
- A seat for the second driver (our buses have plenty of empty seats)
- A hotel room for the second driver on overnight trips

## How we will test it
1. Lakeview day trip (8 hrs): 1 driver, same cost as today.
2. Harbor City day trip (19 hrs): 2 drivers, transport goes up by $400 per bus, note shown.
3. Harbor City overnight (at most 9.7 hrs in one day): 1 driver.
4. A limit of 8 hrs: the Lakeview day trip (8 hrs) still fits, because the limit is "or less".
5. A limit of 5 hrs: the Harbor City day trip (19 hrs > 2 x 5) is **not possible**.
6. A flight option is not checked.
7. The fact check accepts the $400 in Aivana's text.

**Note:** some old test numbers will change on purpose. The Harbor City day trip now costs
$400 more, which also changes the cheapest season total. I'll update those tests and say
which ones changed.

## Time
About 45 minutes.

## For the developer (code details)
- `src/planner.js`:
  - Add settings `driver_max_hours` [1, 24, "rules"] and `second_driver_cost` [0, 5000, "costs"]
    to `EDITABLE_SETTINGS`, with defaults in `data/settings.json` (10 and 400).
  - Add `driverCheck(stretches, s, buses)` that returns `{ longest, drivers, extra_cost, ok }`.
  - Call it in `buildDayTrip` (`[2 x drive_hours]`) and `buildOvernight` for bus mode
    (`[drive_hours, toStadiumH + drive_hours]`, or `[drive_hours, 2 x toStadiumH, drive_hours]`
    when staying after the game).
  - Add the extra cost to `costs.transport` before `finish()`, store `pkg.drivers`, add the note,
    and set `feasible = false` when it's over 2 x the limit.
  - `moneyFacts` adds `second_driver_cost` and the extra cost.
- `src/aiTasks.js`: `packageSummary` and the memo facts get `drivers` and `longest_driving_hours`.
- `static/app.js`: the facts row, the cost-breakdown note and the settings labels.
