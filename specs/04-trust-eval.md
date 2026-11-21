# Feature 4: Trustworthiness eval

**Status:** Done. 102 tests pass. A real Aivana run (25 calls) is saved in `docs/evidence/trust-eval-2026-11-21-aivana-25-calls.md`.

## The problem
We say "Aivana's explanations are fact-checked", but we only show it one trip at a time.
Judges will ask: **"How often is the AI actually right?"** Right now we have no measured
answer for the explanations and memos.

We already have a small accuracy test for one Aivana feature: `npm run eval` checks how well
it **reads requests** (8 test requests). This feature does the same for what Aivana
**writes**.

## The idea
One command, `npm run eval:trust`:
1. The **code** makes **30 different trip scenarios**: different games, team sizes,
   budgets, departure times and rule levels.
2. For each scenario it asks Aivana for a **recommendation** and a **trip memo**, the same
   way the app does.
3. It also asks for **10 season plan explanations** (Feature 2) with different season budgets.
4. The **fact checker** checks every answer against the code's numbers.
5. It writes a short report, `eval_trust.md`, with the scores.

The result is a line you can say in the demo, for example:
> *"In 30 test trips, 97% of Aivana's explanations matched the app's math exactly, and
> Aivana picked the app's best option 29 out of 30 times."*

## What we measure

| Score | Meaning |
|---|---|
| **Fact check pass rate** | Share of Aivana's answers with **zero** unverified amounts, times, options or rule claims. Shown for recommendations, memos and season explanations. |
| **Agrees with the code** | How often Aivana's recommended option is the code's best option ("best within budget", or "best fit for team rules" when nothing fits the budget). |
| **Valid answers** | How often Aivana gives a usable answer on the first try, with no errors and no retry. |
| **Cost** | Number of calls and tokens used, from the usage counter the app already has. |

## We also test the fact checker itself
A checker that lets everything pass would score 100% too, so the eval also **plants
mistakes** in correct text: a wrong amount, a time that doesn't exist, an option that
doesn't exist, a wrong "breaks N rules". Then it checks that the fact checker **catches
every one**.

This part is code only, so it costs no tokens. Example line for the report:
*"The fact checker caught 120 of 120 planted mistakes."*

## How the 30 scenarios are made
- The **code** makes them, not Aivana, using a fixed seed. So every run uses the **same 30
  trips** and the results are comparable.
- They mix:
  - all 4 games
  - 15–28 players
  - tight, normal and large budgets
  - different departure times
  - some with "Home by" or other rules set to must-have
  - some with 3 per room
- Each scenario is checked by the code first (a valid request with at least one possible
  option) before Aivana is asked.

## The report (`eval_trust.md`)
- **Mode:** Aivana API, or offline mock. Mock always scores 100%, so the report says clearly
  that mock results are not a real measure.
- **The scores:** the four scores above, with simple percentages.
- **Every miss is listed:** the scenario, what Aivana wrote, and what the checker flagged,
  so we can read and fix each one.
- **The demo line:** one sentence ready to say.

## Cost
About **70 Aivana calls** (30 recommendations + 30 memos + 10 season explanations). That's
roughly **120,000 tokens**, a rough estimate based on our current prompt sizes. The report
shows the real number. You can run fewer with `npm run eval:trust -- --n 10`.

## What Aivana does here
- **Aivana:** answers exactly as it does in the app (recommend, memo, season explanation).
  Nothing is changed for the test.
- **Code:** makes the scenarios, runs the fact checker, counts the scores, writes the report.
- Nothing in the app changes. This is a test tool only.

## Not included (to keep it simple)
- Showing the report inside the app. It's a file, and we quote it in the demo and README.
- Grading the writing quality of the memo (tone, clarity). We only check facts.
- The what-if chat. It changes settings, and checking that is a different kind of test.

## How we will test it
1. In mock mode, the eval runs offline and writes `eval_trust.md`, labeled "offline mock".
2. The same seed gives the same 30 scenarios every run.
3. Every planted mistake is caught. If one isn't, the report shows it, and that's a real bug
   to fix.
4. Using `--n 5` runs only 5 scenarios.
5. A unit test checks the scoring with a fake Aivana that gives one wrong amount and one
   different pick. The report must show exactly 1 fact-check miss and 1 disagreement.

## Time
About 1 hour, plus one real run with Aivana (a few minutes, plus the token cost).

## For the developer (code details)
- `scripts/eval-trust.js`: new script, built like `scripts/eval-parse.js` (loads `.env`,
  uses mock mode when there's no key). It includes a seeded scenario generator, calls
  `aiTasks.recommend`, `aiTasks.memoStream` with a test approval record, and
  `aiTasks.explainSeason`, then scores the results and writes `eval_trust.md`.
- Move the memo check from `POST /api/check` in `server.js`, which skips the approval line,
  into `planner.checkMemoText(text, plan)` so the app and the eval use the same check.
- Put the planted-mistakes generator and the scoring in small functions that tests can use.
- `package.json`: add the script `"eval:trust": "node scripts/eval-trust.js"`.
- `.gitignore`: add `eval_trust.md`, like `eval_results.md`.
- README and DEMO: add one line on how to run it, and a spot for the demo sentence.
