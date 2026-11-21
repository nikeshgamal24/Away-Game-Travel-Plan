# Feature 8: Import the schedule from text or a screenshot

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

Nothing reaches the schedule until staff save it.

## 1. The schema (shared by text and image)
Aivana returns `{ games: [...], notes: [] }`, with at most 20 games. Each game has:
`opponent, home_away (away/home/neutral/unclear), city, stadium, year (int or null), month (1–12 or null),
day (1–31 or null), kickoff (HH:MM 24h, "TBA", or null), as_printed (the row's text exactly as shown), unclear[]`
(the names of fields Aivana wasn't sure about).

- The prompt says to copy only what is shown, **never guess a year**, and use null plus `unclear` when a value is
  hard to read.
- **Code**, not Aivana, builds `date` from year, month and day, and checks that the date is real.
- Home games are shown greyed out and are not saved. The planner is for away games only.
- `miles` and `drive_hours` are never on a schedule, so staff type them in the preview (both are required).

## 2. Text input
Up to 5,000 characters, then one Aivana call. The personal-details check runs first, the same as `/api/parse`.
Identical text reuses the cached answer.

## 3. Image input
- **Accepted:** PNG or JPG, **max 5 MB** for the original file.
- **PDF:** refused before anything else, with exactly:
  *"PDFs aren't supported. Take a screenshot of the schedule and upload the image."*
  The check runs in the browser (file type and name) **and** on the server (the file starts with `%PDF`), so a
  renamed PDF is caught too. **A PDF is never sent to Aivana.**
- Any other type (HEIC, GIF, WebP…) gets: *"Upload a PNG or JPG screenshot."*
- **Downscale in code:** the browser draws the image on a canvas at **max 1600px wide** (aspect kept, never
  upscaled) and re-encodes it in the same format. No packages are added.
- **Server checks again:** it reads the real type from the file's first bytes (magic bytes) and the width from the
  PNG/JPG header. It refuses PDF, any non-PNG/JPG file, width over 1600, or over 5 MB after decoding.
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

## 5. Save
- `POST /api/schedule/save` validates every row again. If any row is invalid it returns 400 and lists the rows.
- It writes the away games to `data/schedule.json` with new IDs `G01…Gn` in date order, and keeps `home` and `note`.
- Saving replaces the schedule, so the box warns: *"This replaces the current schedule. Saved trip plans for removed
  games will no longer open."* Staff must tick a confirm box.
- Approvals for games whose date or kickoff changed become out of date (the existing `planFingerprint` covers this).

## If something goes wrong
- No key or mock mode: a fixed mock result (the current 4 games, with one row missing its year so the invalid
  state can be demoed offline).
- Aivana error, or no games found: *"No games could be read. Try a clearer screenshot or paste the text."*
- **TODO confirm:** if Aivana refuses `attachments` together with `response_format` (400/422), retry once without
  `response_format`, asking for JSON in the text, and validate it the same way. That is still one successful call
  per upload.

## Not included
- PDFs, Word or CSV files (Aivana accepts them, we don't)
- Several images at once, or photos of paper (allowed, but not tuned for)
- Working out miles or drive times
- Merging with the current schedule (it's replace only)

## How we will test it
1. A PDF (by type, by name, and a renamed `.png` starting with `%PDF`) → the exact PDF message, and **no Aivana call**
   (the fake transport records zero calls).
2. HEIC/GIF → "Upload a PNG or JPG screenshot." A file over 5 MB → refused.
3. An image over 1600px wide reaching the server → refused. A 1600px one → accepted.
4. The request to Aivana has exactly one `attachments` item, `mime_type` `image/png` or `image/jpeg`, plus
   `response_format` with the schedule schema.
5. A game with `year: null` → invalid with "Year not shown". Feb 30 → "Date unclear". A field in `unclear` → invalid.
6. Text and image answers go through the same validator (same fixture → same preview rows).
7. Save with any invalid row → 400. A valid save → IDs G01…Gn in date order, and home games are dropped.
8. Changing a game's kickoff after approval → that approval is out of date (409).
9. The same image twice → one Aivana call (cache by hash). The image bytes aren't in any file on disk.
10. Mock mode: the import works offline and shows the one invalid row.
11. Browser check (laptop and phone): upload, downscale, fix the red cells, save.
12. One real Aivana run with a screenshot, saved to `docs/evidence/` (request without the base64, the response, and
    tokens). This answers the TODO about attachments plus `response_format`.
13. All existing tests still pass.

## Cost
One call per import. An image is at most 1,534 input tokens (about $0.0015), plus the output for 20 games. Text is
cheaper. Both are cached.

## Time
About 3–4 hours.

## For the developer (code details)
- `src/aivana.js`: `structured({…, attachments})` adds a top-level `attachments` to the body. The
  `response_format` fallback reuses the web-search fallback branch (widen its condition to `attachments`).
  `// TODO confirm`.
- `src/aiTasks.js`: `scheduleSchema()`, `SCHEDULE_SYSTEM`, `mockSchedule()`, and `readSchedule({text} | {image})`
  using `cacheGet`/`cachePut` (key = text, or sha256 of the image).
- `src/scheduleImport.js` (new): `sniffImage(buf)` → `{type, width}` from magic bytes and the PNG IHDR / JPEG SOF
  header, and `isPdf(buf)`; `validateRows(rows)` → rows with per-cell `{ok, reason}`, shared by server and browser
  (served as a static module, or the rules copied in `app.js`).
- `server.js`: `POST /api/schedule/read` and `POST /api/schedule/save`. `MAX_BODY` is 1 MB today; give
  `/api/schedule/read` its own limit of 7 MB (5 MB base64 ≈ 6.7 MB). Reload `DATA.schedule` after save.
- `static/index.html` / `app.js` / `style.css`: the Import box in Settings (textarea + file input
  `accept="image/png,image/jpeg"`), the canvas downscale, the editable preview table with red cells, the confirm
  box and Save.
- Tests in `test/scheduleImport.test.js` with small PNG/JPG/PDF byte fixtures and the fake Aivana transport.
  Update the README (features, limits, test count) and DEMO.md (one step).
