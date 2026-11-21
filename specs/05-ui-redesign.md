# Feature 5: Cleaner UI

**Status:** Done. 3 tabs, one wizard step at a time, compact cards, chat drawer, and an "Aivana is working…" indicator (top bar + in place) for every Aivana call. 102 tests pass; browser-checked at 1400px and 390px.

## The problem
Everything is on **one long page**: season overview, benchmarks, the trip form, all settings,
option cards, chat, review, approval and the final plan. The season overview alone is
taller than a laptop screen, before you even reach the trip form.

It also has **too much text**. Almost every section opens with a paragraph explaining how
the app works, and option cards list every rule check, even the ones that passed. The
important things (which option, how much, what's wrong) get lost.

## Goals
1. **One job per screen.** You see only what you need for the step you're on.
2. **Numbers first, words second.** Show the price, the budget status and what's broken.
   Hide the explanations until someone asks.
3. **No feature is removed.** Everything still works the same; it's just better organized.

## New layout: 3 tabs

```
┌────────────────────────────────────────────────────────────┐
│ BGSU Away-Game Planner        Season | Plan a trip | Settings│  ← brown top bar
└────────────────────────────────────────────────────────────┘
```

### Tab 1: Season
```
Season budget [$25,000]     Season plan: $21,708 · $3,292 left · 0 must-have broken

 Wed Sep 8   Maple Ridge    38 mi   A  Day trip         $2,423   [Plan]
 Sun Sep 19  Lakeview      210 mi   A  Day trip  ●chg   $3,265   [Plan]
 Tue Oct 5   Riverbend      95 mi   A  Day trip         $2,423   [Plan]
 Sat Oct 16  Harbor City   520 mi   E  2 nights         $13,597  [Plan]

 ▸ What changed (1)   ▸ Hotels   ▸ Benchmarks   ▸ How this is picked
 [Explain with Aivana]
```
- The 4 away games are shown as one clean **fixture list**, like a team schedule. This is
  the main thing on the screen.
- Warnings (over budget, a must-have broken) show as **one line** above the list.
- Hotels, benchmarks and the method text move into small **"▸" sections** that open on click.
- **Plan** opens that game in the "Plan a trip" tab.

### Tab 2: Plan a trip (a 4-step wizard)
Only **one step at a time** is shown. The step bar at the top lets you go back.

```
 ① Request  ─  ② Compare  ─  ③ Review & approve  ─  ④ Trip plan
```

**① Request:** the "describe the trip" box and the 6 form fields. Nothing else.
A "Settings used: Home by midnight · Max 1.5 hrs on game day…" line links to the
Settings tab instead of opening a long panel.

**② Compare:** short option cards side by side:
```
┌──────────────────────┐
│ E  2 nights, Harbor   │  ★ Aivana's pick
│ $13,597.40            │
│ $1,402 under budget   │
│ Leave Fri 1 PM        │
│ Home Sun 6:30 PM      │
│ ⚠ 1 important rule    │
│ ▸ Details             │  ← costs + all rule checks, hidden by default
│ [Review this plan]    │
└──────────────────────┘
```
- Cards show **only broken rules** (with their level tag). Passed checks move into **Details**.
- **Aivana's recommendation** is one short box above the cards: the pick plus one sentence,
  with **▸ Why** for the rest.
- **The chat** becomes a slide-out panel ("Ask Aivana or change something"). The example
  prompts become 3 small clickable chips, not a paragraph.

**③ Review & approve:** schedule, costs and checks in two columns, then the approval box.
The hotel and restaurant pickers open on click.

**④ Trip plan:** rooming list, memo, downloads and budget vs actual, as today, with fewer
headings.

### Tab 3: Settings
All settings in one tab, grouped: **Team rules · Rule priorities · BGSU policy · Costs ·
Extras · Assumptions**.
- Each group has **one short line** of help, at most about 10 words.
- Rule priorities sit next to the rule they belong to, as you asked for in Feature 1.
- A **"Reset to defaults"** button.

## Text diet: what changes

| Today | After |
|---|---|
| Header tagline "Code does the math. Staff set the rules…" | Removed (it's in the README and demo) |
| Season paragraph (4 lines) | Removed; the "▸ How this is picked" section holds it |
| Season method paragraph under the table | Moved into "▸ How this is picked" |
| Benchmark notes (4 bullets + "What this tells us") | Inside "▸ Benchmarks" |
| Settings group descriptions (1–3 lines each) | One short line each |
| Chat help (2 paragraphs) | 3 example chips |
| Approval help paragraph | One line: "Any later change cancels approval." |
| Rule lists on cards (all 5–9 checks) | Only broken rules; the rest in Details |
| Disclaimer under the options | Once, in the footer |
| Notes like "Breakfast before departure is not budgeted" | In Details, not on the card face |

**Rule for all new text:** if it doesn't help the user decide or act right now, it goes
behind a "▸" or it's removed.

## Look and feel
- **Colors:** BGSU **Falcon brown** (#4F2C1D) for the top bar and headings, **Falcon orange**
  (#FD5000) only for the main action button and Aivana's pick. The page background is a cool
  light grey (#F5F6F8) with white panels. Status colors: green = OK, amber = warning,
  red = must-have broken. They're used only for status, never for decoration.
- **Type:** **Barlow**, a clean sports and signage typeface, with tabular numbers so prices
  line up. Without internet it falls back to the system font, so the offline demo still works.
- **Spacing:** more white space, fewer boxes inside boxes, and no box around every section.
- **Phone:** everything works at phone width. The tabs stay at the top, and the cards stack.
- **Keyboard:** visible focus outlines, and every "▸" section works with Enter.

## Not included (to keep it simple)
- New features or changes to the math or Aivana. This is layout and text only.
- Dark mode
- A full mobile app layout. It just has to work well on a phone.

## How we will test it
1. All 102 tests still pass. The server and math don't change.
2. A browser check with screenshots, before and after, on desktop and phone:
   - every tab and every wizard step
   - no horizontal scrolling at phone width
   - no browser errors
3. The full flow works end to end in mock mode: season → Plan → request → compare → chat
   change → review → approve → memo → .ics download.
4. Text check: the first screen of each tab fits without scrolling on a laptop (1400 x 900).

## Time
About 2–3 hours.

## For the developer (code details)
- `static/index.html`: a new top bar with 3 tabs. Wrap Season, Plan (steps 1–4) and Settings
  in tab panels. Move `#settings-box` contents into the Settings tab. Keep the element IDs so
  most of `app.js` keeps working.
- `static/app.js`:
  - Tab switching (and remember the tab in `localStorage`).
  - The wizard shows one step at a time. `updateStepper` becomes clickable, replacing the
    `scrollIntoView` jumps.
  - Option cards: compact face plus a `<details>` with costs, all checks and notes.
  - Chat in a slide-out panel.
  - Season fixture list layout.
- `static/style.css`: rewritten around the new tokens and the Barlow font from Google Fonts,
  with a system fallback.
- No changes to `server.js`, `src/` or the tests.
