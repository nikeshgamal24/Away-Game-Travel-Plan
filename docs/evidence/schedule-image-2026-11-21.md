# Schedule image evidence (spec 08, step 0), 2026-11-21

- Image: `test/fixtures/schedule-synthetic.png`, synthetic, fictional teams. 41311 bytes, 900px wide.
- Mode: Aivana API, one call. Time: 8.7 s.
- Attachments + JSON form output: **worked together** (response_format was accepted with the image attached).
- Tokens Aivana reported: 946 input, 0 output.
- Result: 5 game(s) read.
- Calls made for this step: 3. The first was refused before any answer (403: `max_tokens` 3000 is over this workspace's cap of 2048; now 2000). The second succeeded but a script bug stopped it being recorded. This is the third.
- Aivana returned `year: null` for the row with no year printed, and `"TBA"` for the TBA kickoff. It guessed nothing.

Saved here: the request body without the image bytes, and Aivana's response. The API key is sent in a header and is in neither.

## What the image shows

- Maple Ridge College: away, 2027-09-08, 19:00
- Northfield State: home (not saved)
- Lakeview State: away, Sep 19 with NO year printed → year must be null (invalid in preview)
- Riverbend University: away, 2027-10-05, kickoff TBA → null (invalid in preview)
- Harbor City Tech: away, 2027-10-16, 19:00

## What the preview would show

| Opponent | Home/away | Date (y-m-d) | Kickoff | Preview check |
|---|---|---|---|---|
| Maple Ridge College | away | 2027-9-8 | 19:00 | ok (staff still type miles and drive hours) |
| Northfield State | home | null-9-11 | 13:00 | home, skipped |
| Lakeview State | away | null-9-19 | 13:00 | year: Year not shown. Type the year. |
| Riverbend University | away | 2027-10-5 | null | kickoff: Kickoff missing. Type HH:MM. |
| Harbor City Tech | away | 2027-10-16 | 19:00 | ok (staff still type miles and drive hours) |

## Request (image bytes removed)

```json
{
  "system": "You copy a college soccer team's game schedule into JSON, for BGSU (Bowling Green State University) men's soccer travel staff. The schedule is pasted text or a screenshot. Copy only what is shown. Never guess or calculate a value: if a year, date, time, city or stadium is not shown, use null. If a value is hard to read, give your best reading and list the field in `unclear`. Use a year only when it is printed for that game or in the schedule's title. Convert times to 24-hour HH:MM (7 PM -> 19:00). Do not add games that are not shown. Ignore anything that is not a game (ads, standings, people's names or contact details).",
  "messages": [
    {
      "role": "user",
      "content": "Copy every game in the attached schedule screenshot into the JSON form."
    }
  ],
  "response_format": {
    "type": "json_schema",
    "schema": "<scheduleSchema(), see src/aiTasks.js>"
  },
  "max_tokens": 2000,
  "effort": "low",
  "attachments": [
    {
      "mime_type": "image/png",
      "data": "<base64 omitted: 41311 bytes, sha256 916c5995de26aa16…>"
    }
  ]
}
```

## Aivana's response

```json
{
  "id": "gen_63cf2b18e34e37c2d87e81a6",
  "request_id": "req_86323bb0d474e34a3a9daf03",
  "answer": "{\"games\":[{\"opponent\":\"Maple Ridge College\",\"home_away\":\"away\",\"city\":\"Maple Ridge\",\"stadium\":\"Maple Ridge Soccer Complex\",\"year\":2027,\"month\":9,\"day\":8,\"kickoff\":\"19:00\",\"as_printed\":\"Wed, Sep 8, 2027 at Maple Ridge College Maple Ridge Soccer Complex, Maple Ridge 7:00 PM\",\"unclear\":[]},{\"opponent\":\"Northfield State\",\"home_away\":\"home\",\"city\":null,\"stadium\":null,\"year\":null,\"month\":9,\"day\":11,\"kickoff\":\"13:00\",\"as_printed\":\"Sat, Sep 11 vs Northfield State Home 1:00 PM\",\"unclear\":[]},{\"opponent\":\"Lakeview State\",\"home_away\":\"away\",\"city\":\"Lakeview\",\"stadium\":\"Lakeview Soccer Park\",\"year\":null,\"month\":9,\"day\":19,\"kickoff\":\"13:00\",\"as_printed\":\"Sun, Sep 19 at Lakeview State Lakeview Soccer Park, Lakeview 1:00 PM\",\"unclear\":[]},{\"opponent\":\"Riverbend University\",\"home_away\":\"away\",\"city\":\"Riverbend\",\"stadium\":\"Riverbend Field\",\"year\":2027,\"month\":10,\"day\":5,\"kickoff\":\"TBA\",\"as_printed\":\"Tue, Oct 5, 2027 at Riverbend University Riverbend Field, Riverbend TBA\",\"unclear\":[]},{\"opponent\":\"Harbor City Tech\",\"home_away\":\"away\",\"city\":\"Harbor City\",\"stadium\":\"Harbor City Stadium\",\"year\":2027,\"month\":10,\"day\":16,\"kickoff\":\"19:00\",\"as_printed\":\"Sat, Oct 16, 2027 at Harbor City Tech Harbor City Stadium, Harbor City 7:00 PM\",\"unclear\":[]}],\"notes\":[]}",
  "intent": {
    "name": "extract_json",
    "confidence": 0,
    "signal": ""
  },
  "structured": {
    "games": [
      {
        "opponent": "Maple Ridge College",
        "home_away": "away",
        "city": "Maple Ridge",
        "stadium": "Maple Ridge Soccer Complex",
        "year": 2027,
        "month": 9,
        "day": 8,
        "kickoff": "19:00",
        "as_printed": "Wed, Sep 8, 2027 at Maple Ridge College Maple Ridge Soccer Complex, Maple Ridge 7:00 PM",
        "unclear": []
      },
      {
        "opponent": "Northfield State",
        "home_away": "home",
        "city": null,
        "stadium": null,
        "year": null,
        "month": 9,
        "day": 11,
        "kickoff": "13:00",
        "as_printed": "Sat, Sep 11 vs Northfield State Home 1:00 PM",
        "unclear": []
      },
      {
        "opponent": "Lakeview State",
        "home_away": "away",
        "city": "Lakeview",
        "stadium": "Lakeview Soccer Park",
        "year": null,
        "month": 9,
        "day": 19,
        "kickoff": "13:00",
        "as_printed": "Sun, Sep 19 at Lakeview State Lakeview Soccer Park, Lakeview 1:00 PM",
        "unclear": []
      },
      {
        "opponent": "Riverbend University",
        "home_away": "away",
        "city": "Riverbend",
        "stadium": "Riverbend Field",
        "year": 2027,
        "month": 10,
        "day": 5,
        "kickoff": "TBA",
        "as_printed": "Tue, Oct 5, 2027 at Riverbend University Riverbend Field, Riverbend TBA",
        "unclear": []
      },
      {
        "opponent": "Harbor City Tech",
        "home_away": "away",
        "city": "Harbor City",
        "stadium": "Harbor City Stadium",
        "year": 2027,
        "month": 10,
        "day": 16,
        "kickoff": "19:00",
        "as_printed": "Sat, Oct 16, 2027 at Harbor City Tech Harbor City Stadium, Harbor City 7:00 PM",
        "unclear": []
      }
    ],
    "notes": []
  },
  "structured_error": null,
  "models_used": [
    "aivana-mmi"
  ],
  "usage": {
    "input_tokens": 946,
    "output_tokens": 0,
    "cached_tokens": 0,
    "credits": 0.000946
  },
  "latency_ms": 8431,
  "finish_reason": "stop",
  "notices": [],
  "pending_action": null,
  "trace": null
}
```
