# Feature 8: Import the schedule from text or a screenshot

**Status:** Step 0 and Stage A done. Stage B (image upload, PDF refusal) is next. 160 tests pass.

Found while building:
- **Step 0 (live check):** `attachments` + `response_format` **work together**. Aivana read all 5 rows of the synthetic
  image, gave `year: null` where no year was printed and `"TBA"` for the TBA kickoff, and guessed nothing. It reported
  946 input tokens. Evidence: `docs/evidence/schedule-image-2026-11-21.md`.
- This workspace caps `max_tokens` at **2048**, so the import asks for 2000.
- The approval fingerprint now includes the game's date, kickoff, place and distance. The old fingerprint only had
  the game ID, so a moved kickoff wouldn't have made an approval out of date. Approvals saved before this change
  now show as out of date once.
- Flight fares are matched by game ID **and** opponent, so an imported game that gets ID G09 never picks up Harbor
  City Tech's fare.
- Miles and drive hours were added to the schema later (they can be shown on a schedule). The step 0 run used the
  schema without them.
- If Aivana's answer has personal details, the message says what was found and that nothing was kept, instead of
  the "before sending this to Aivana" wording (the image was already sent).

## The problem
Staff get the road schedule as a web page, an email or a screenshot. Today someone types every game into
`data/schedule.json` by hand. That's slow, and a wrong date or kickoff breaks every plan for that game.

## The idea
A new **Import schedule** box in **Settings**:

| Step | Who | What happens |
|---|---|---|
| 1. Give it | **Staff** | Paste the schedule text, **or** upload a PNG/JPG screenshot |
| 2. Read | **Aivana** | One call returns the games in a fixed JSON form (the same schema for text and image) |
| 3. Check | **Code** | Builds dates, checks every field, and marks anything missing or unclear as **invalid** |
| 4. Fix | **Staff** | Edit the preview table. Invalid cells are red with the reason |
| 5. Save | **Staff** | **Save schedule** works only when no cell is invalid |

Nothing reaches the schedule until staff save it. The sample schedule (`data/schedule.json`) is never changed.

## Build order
0. **First, before any UI: one live check.** Make one real Aivana call with a small **synthetic** schedule PNG
   (fictional teams from the sample schedule, rendered from an HTML table). It confirms whether `attachments` works
   together with `response_format`. Save the evidence to `docs/evidence/` (see test 12). **Synthetic images only.
   A real schedule, screenshot or photo is never used, in tests or in evidence.**
1. **Stage A:** text input, validator, preview, save and reset. Checkpoint when A passes its tests.
   **If Stage A takes more than 1.5 hours, stop after A and report** before starting B.
2. **Stage B:** image input and PDF refusal. Checkpoint again.

## 1. The schema (shared by text and image)
Aivana returns `{ games: [...], notes: [] }`, with at most 20 games. Each game has:
`opponent, home_away (away/home/neutral/unclear), city, stadium, year (int or null), month (1–12 or null),
day (1–31 or null), kickoff (HH:MM 24h, "TBA", or null), miles (number or null), drive_hours (number or null),
as_printed (the row's text exactly as shown), unclear[]`
(the names of fields Aivana wasn't sure about).

- The prompt says to copy only what is shown, **never guess a year**, and use null plus `unclear` when a value is
  hard to read.
- **Code**, not Aivana, builds `date` from year, month and day, and checks that the date is real.
- `as_printed` is **shown in the preview only**, so staff can compare. It is **never saved**.
- Home games are shown greyed out and are not saved. The planner is for away games only.
- `miles` and `drive_hours` are copied **only if the text or image shows them for that game** (e.g. "56 mi",
  "1.2 hrs"); otherwise null. **Never estimated.** Code checks both are > 0. For pasted text, the code also keeps a
  value only if that number appears in the text with its unit, and says so in a note when it empties one. Empty values
  stay red "Required." for staff to type (both are required to save).

### Personal-details check on the answer
The code runs `personalDetails()` on **every string Aivana returns** (every field, `as_printed`, `notes`), for text
**and** image imports. With an image, the input can't be checked first, so this is the only check.
- If anything is found, the whole result is refused with `PERSONAL_MESSAGE`. Nothing is shown, cached or saved.
- Text imports also keep the existing check on the input **before** the call, the same as `/api/parse`.

## 2. Text input (Stage A)
Up to 5,000 characters, then one Aivana call. Identical text reuses the cached answer (only if it passed the
personal-details check).

## 3. Image input (Stage B)
- **Accepted:** PNG or JPG, **max 5 MB** for the file the staff member picks.
- **PDF:** refused before anything else, with exactly:
  *"PDFs aren't supported. Take a screenshot of the schedule and upload the image."*
  The check runs in the browser (file type and name) **and** on the server (the file starts with `%PDF`), so a
  renamed PDF is caught too. **A PDF is never sent to Aivana.**
- Any other type (HEIC, GIF, WebP…) gets: *"Upload a PNG or JPG screenshot."*
- **Downscale in code:** the browser draws the image on a canvas at **max 1600px wide** (aspect kept, never
  upscaled) and re-encodes it in the same format. No packages are added.
- **Size after shrinking:** `/api/schedule/read` accepts at most **3 MB** of request body, so the shrunk image must
  be about **2.2 MB** or less (base64 adds a third). If it's still bigger, the browser says: *"This image is too
  large even after shrinking. Crop it to the schedule and try again."*
- **Server checks again:** it reads the real type from the file's first bytes (magic bytes) and the width from the
  PNG/JPG header. It refuses PDF, any non-PNG/JPG file, width over 1600, and any body over 3 MB (413).
- **One Aivana call:** the image goes in `attachments: [{ mime_type, data }]`, with the same system prompt, the same
  schema and `response_format`. There's no second "read the text first" call.
- The image is **not stored** (not on disk, not in the cache file). Only a hash of it is used as the cache key.

## 4. Preview: what counts as invalid
Every invalid cell is red, with the reason shown under it:

| Case | Reason shown |
|---|---|
| Year missing | "Year not shown. Type the year." |
| Month/day missing, or date not real (Feb 30) | "Date unclear." |
| Field listed in `unclear` | "Hard to read. Check this." |
| Kickoff null or "TBA" | "Kickoff missing. Type HH:MM." |
| Opponent, city or stadium empty | "Required." |
| `home_away` is unclear | "Home or away? Pick one." |
| Miles / drive hours empty or ≤ 0 | "Required." |
| Same opponent and date twice | "Duplicate game." |

Editing a cell re-runs the check for that row in the browser, and the server checks everything again on save. A
value staff typed is never marked unclear again.

## 5. Save and reset (Stage A)
- `POST /api/schedule/save` validates every row again. If any row is invalid it returns 400 and lists the rows.
- It writes the away games to **`data/schedule.imported.json`** (added to `.gitignore`), with new IDs `G01…Gn` in
  date order. It copies `home` and `note` from the sample. `as_printed` and `unclear` are dropped.
- **Loading:** the app uses `data/schedule.imported.json` if it exists, otherwise the sample `data/schedule.json`.
  The Settings box says which one is in use.
- Saving replaces the schedule in use, so the box warns: *"This replaces the current schedule. Saved trip plans for
  removed games will no longer open."* Staff must tick a confirm box.
- **Reset to sample schedule** button: `POST /api/schedule/reset` deletes `data/schedule.imported.json` and reloads
  the sample. It asks to confirm first, and is shown only when an imported schedule is in use.
- Approvals for games whose date or kickoff changed become out of date (the existing `planFingerprint` covers this).

## If something goes wrong
- No key or mock mode: a fixed mock result (the sample's 4 games, with one row missing its year so the invalid
  state can be demoed offline).
- Aivana error, or no games found: *"No games could be read. Try a clearer screenshot or paste the text."*
- `data/schedule.imported.json` is broken or unreadable at startup: use the sample and show a warning in Settings.
- **TODO confirm (step 0 answers this):** if Aivana refuses `attachments` together with `response_format` (400/422),
  retry once without `response_format`, asking for JSON in the text, and validate it the same way.

## Not included
- PDFs, Word or CSV files (Aivana accepts them, we don't)
- Several images at once, or photos of paper (allowed, but not tuned for)
- Working out miles or drive times
- Merging with the current schedule (it's replace only)
- Editing the sample `data/schedule.json`

## How we will test it
**Step 0**
12. One live Aivana call with the synthetic PNG (`test/fixtures/schedule-synthetic.png`), saved to
    `docs/evidence/schedule-image-<date>.md`: the request **without the base64**, the response, and the tokens
    Aivana reports. No API key. This answers the TODO about `attachments` plus `response_format`.

**Stage A**
5. A game with `year: null` → invalid with "Year not shown". Feb 30 → "Date unclear". A field in `unclear` → invalid.
7. Save with any invalid row → 400. A valid save → `data/schedule.imported.json` with IDs G01…Gn in date order, home
   games dropped, no `as_printed`. `data/schedule.json` is unchanged.
8. Changing a game's kickoff after approval → that approval is out of date (409).
10. Mock mode: the import works offline and shows the one invalid row.
14. An Aivana answer with a phone number or email in any field (including `as_printed` or `notes`) → refused with
    `PERSONAL_MESSAGE`, and nothing is cached.
15. Startup loads the imported file if present, else the sample. A broken imported file → the sample plus a warning.
16. Reset deletes the imported file and the sample is back in use. Reset with no imported file → no error.
13. All existing tests still pass.

**Stage B**
1. A PDF (by type, by name, and a renamed `.png` starting with `%PDF`) → the exact PDF message, and **no Aivana call**
   (the fake transport records zero calls).
2. HEIC/GIF → "Upload a PNG or JPG screenshot." A file over 5 MB → refused in the browser.
3. An image over 1600px wide reaching the server → refused. A 1600px one → accepted. A body over 3 MB → 413.
4. The request to Aivana has exactly one `attachments` item, `mime_type` `image/png` or `image/jpeg`, plus
   `response_format` with the schedule schema.
6. Text and image answers go through the same validator and personal-details check (same fixture → same preview rows).
9. The same image twice → one Aivana call (cache by hash). The image bytes aren't in any file on disk.
11. Browser check (laptop and phone): upload, downscale, fix the red cells, save, reset.

All images in tests and evidence are synthetic.

## Cost
One call per import, cached. No token estimate until it's measured: step 0 records the real tokens Aivana reports
for one image, and this section is updated with that number.

## Time
About 3–4 hours. Stage A has a 1.5-hour stop point (see Build order).

## For the developer (code details)
- `src/aivana.js` (Stage B, but step 0 needs it first): `structured({…, attachments})` adds a top-level
  `attachments` to the body. The `response_format` fallback reuses the web-search fallback branch (widen its
  condition to `attachments`). `// TODO confirm` until step 0 is done.
- `scripts/schedule-image-evidence.js` (step 0): sends `test/fixtures/schedule-synthetic.png` once and writes the
  evidence file without the base64 or the key.
- `src/aiTasks.js`: `scheduleSchema()`, `SCHEDULE_SYSTEM`, `mockSchedule()`, and `readSchedule({text} | {image})`
  using `cacheGet`/`cachePut` (key = text, or sha256 of the image). It runs `personalDetails()` over every string in
  the answer before caching.
- `src/scheduleImport.js` (new): `validateRows(rows)` → rows with per-cell `{ok, reason}`, shared by server and
  browser (served as a static module, or the rules copied in `app.js`), and `toSavedGames(rows)` (drops
  `as_printed`/`unclear`, assigns IDs). Stage B adds `sniffImage(buf)` → `{type, width}` from magic bytes and the
  PNG IHDR / JPEG SOF header, and `isPdf(buf)`.
- `src/planner.js`: `loadData` reads `schedule.imported.json` when present, else `schedule.json`, and reports which
  one it used.
- `server.js`: `POST /api/schedule/read`, `/api/schedule/save` and `/api/schedule/reset`. `MAX_BODY` stays 1 MB for
  everything else. `/api/schedule/read` gets its own **3 MB** limit. Reload `DATA.schedule` after save and reset.
- `.gitignore`: add `data/schedule.imported.json`.
- `static/index.html` / `app.js` / `style.css`: the Import box in Settings (textarea; Stage B adds the file input
  `accept="image/png,image/jpeg"` and the canvas downscale), the editable preview table with red cells and an
  `as_printed` column, the confirm box, Save, and Reset to sample schedule.
- Tests in `test/scheduleImport.test.js` with small synthetic PNG/JPG/PDF byte fixtures and the fake Aivana
  transport. Update the README (features, limits, test count) and DEMO.md (one step).
