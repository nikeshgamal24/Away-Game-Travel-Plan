# Evidence: trustworthiness eval, real Aivana run

- **Date:** 2026-11-21
- **Command:** `npm run eval:trust -- --n 10 --seasons 5`, with seed 42, so the same scenarios can be re-run
- **Mode:** Aivana API, a real run, not mock
- **Size:** 10 trips (10 recommendations + 10 memos) + 5 season explanations = **25 Aivana calls**
- **Spec:** `specs/04-trust-eval.md`. The code is in `src/trustEval.js` and `scripts/eval-trust.js`.

## Summary
- **Fact check:** 25 of 25 Aivana answers passed, with every amount, time, option and rule count
  matching the app's math.
- **Agreement with the code:** Aivana picked the code's best option 8 of 10 times. The 2 differences
  are explained below.
- **Reliability:** 25 of 25 answers were valid on the first try, with no errors and no retries.
- **The fact checker:** it caught 40 of 40 planted mistakes and raised no false alarms on true text
  (10 of 10 passed).
- **Cost:** 25 calls, 12,196 input tokens and 6,674 output tokens, about 18,900 tokens in total.

## Review of the 2 differences (T06, T10)
In both scenarios, "game-day travel" was set to **must-have**:
- **Option A** is the only option under budget. It breaks that must-have rule plus one important rule.
- **Option B** is the code's "best fit for team rules" pick. It keeps every rule but is about $1,000 over budget.

The eval counts the code's best as "best within budget", which is **A**. Aivana picked **B**, the
code's other labeled option, and said why: A breaks a must-have rule. Aivana did not invent an
option or a number, and both answers passed the fact check.

This follows the rule we agreed for the season plan: going slightly over budget is acceptable to
keep a must-have rule. The single-trip ranking doesn't have that allowance yet.

---

# Trustworthiness eval (Aivana API)

Scenarios: 10 trips + 5 season plans. Seed: 42.

## Scores

| Score | Result | Rate |
|---|---|---|
| Fact check: all answers | 25/25 | 100% |
| Fact check: recommendations | 10/10 | 100% |
| Fact check: memos | 10/10 | 100% |
| Fact check: season explanations | 5/5 | 100% |
| Aivana agrees with the code's best option | 8/10 | 80% |
| Valid answer on the first try | 25/25 | 100% |
| Fact checker caught planted mistakes | 40/40 | 100% |
| True text passed the fact checker (no false alarms) | 10/10 | 100% |

## What each test checks, and why

| Test | Aim (what it checks) | Purpose (why we do it) |
|---|---|---|
| Fact check: recommendations | Every amount, time, option and rule count in Aivana's recommendation matches the app's computed numbers. | Staff act on the recommendation, so a made-up price or time could lead to a wrong booking. |
| Fact check: memos | Every fact in the trip memo matches the approved plan (the approval line is skipped, because it comes from the approval record). | The memo goes to coaches and players, so it has to be exactly right. |
| Fact check: season explanations | Every amount Aivana uses to explain the season plan is a real number from the season optimizer. | Season budgets are large sums, so a wrong saving or total could mislead the budget decision. |
| Aivana agrees with the code's best option | Aivana recommends the same option the code ranks best (best within budget, else best fit for team rules). | It shows that Aivana explains the code's decision instead of inventing its own. A disagreement is fine only if Aivana says why, so each one is listed below for review. |
| Valid answer on the first try | Aivana returns a usable answer with no error and no retry. | It measures reliability: how often staff get an answer straight away. |
| Fact checker caught planted mistakes | Wrong amounts, made-up times, fake options and wrong rule counts are put into true text, and the checker must flag each one. | A checker that passes everything would also score 100%. This proves the fact check scores above mean something. |
| True text passed the fact checker | Correct text built from the app's own numbers is not flagged. | It shows that the checker doesn't raise false alarms, which would make staff ignore its warnings. |
| Cost | The number of Aivana calls and tokens used. | It shows what running Aivana costs, so we can plan a budget for real use. |

## Cost

25 Aivana calls, 12196 input tokens, 6674 output tokens.

## Demo line

> In 10 test trips, 100% of Aivana's answers passed the fact check (recommendations 100%, memos 100%, season explanations 100%), Aivana picked the app's best option 8 of 10 times, and the fact checker caught 40 of 40 planted mistakes.

## Misses

- **T06 pick:** Aivana picked B, code's best is A. Option B is recommended as it breaks no team rules or BGSU policies. Option B keeps all team rules and BGSU policies, departing Sat 1:00 PM with 0.27 hours on the bus on game day and a night in a hotel before the game. It returns Sun 8:00 PM. This option is over budget by $987.40. Option A breaks a 
- **T10 pick:** Aivana picked B, code's best is A. B is the strongest overall choice if a modest budget exception is allowed. B is the best fit because it breaks no team rules or policy limits, unlike A, which breaks one must-have and one important rule, and C, which breaks one important policy rule. B also provides the preferred overnight stay, lea

## Scenarios

| ID | Game | Party | Budget | Leave after | Settings |
|---|---|---|---|---|---|
| T01 | G06 | 24+2+3 | $2,400.00 (normal) | 2027-09-07T14:00 | {"priority_depart_earliest":1} |
| T02 | G07 | 18+5+3 | $3,200.00 (normal) | 2027-09-19T06:00 | {"priority_depart_earliest":1} |
| T03 | G08 | 23+2+2 | $6,000.00 (large) | 2027-10-03T12:00 | {} |
| T04 | G09 | 18+2+1 | $13,400.00 (large) | 2027-10-14T08:00 | {} |
| T05 | G06 | 26+3+4 | $2,600.00 (normal) | 2027-09-07T08:00 | {"priority_depart_earliest":1} |
| T06 | G07 | 22+4+1 | $5,200.00 (normal) | 2027-09-18T08:00 | {"priority_gameday_travel":3} |
| T07 | G08 | 27+4+1 | $4,100.00 (normal) | 2027-10-04T12:00 | {} |
| T08 | G09 | 24+4+4 | $6,000.00 (tight) | 2027-10-15T12:00 | {"priority_home_by":3} |
| T09 | G06 | 16+2+1 | $2,100.00 (normal) | 2027-09-07T14:00 | {"hotel_max_rate":150} |
| T10 | G07 | 16+4+4 | $5,000.00 (normal) | 2027-09-17T14:00 | {"priority_gameday_travel":3} |
