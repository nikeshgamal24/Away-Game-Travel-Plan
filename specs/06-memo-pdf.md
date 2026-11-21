# Feature 6: Download the trip memo as a PDF

**Status:** Done. `src/pdf.js` (no packages) + `POST /api/memo/pdf` + a Download PDF button. 110 tests pass; PDF checked with poppler and Ghostscript, and downloaded in the browser at laptop and phone width.

## The problem
After a trip is approved, Aivana writes the trip memo. Today the only download is a plain
**.txt** file. Athletics staff share memos by email and print them, so they expect a **PDF**
that looks like a real document.

## The idea
Step 4 (Trip plan) gets a new **Download PDF** button, next to "Download memo".

```
[Write memo with Aivana]  [Download PDF]  [Download .txt]  [Add to calendar (.ics)]
```

The PDF contains:
1. **A header:** "BGSU Men's Soccer, Away-Game Trip Memo", the game, the date, and the
   option that was approved.
2. **An approval box:** who approved it, when, any note, and the total cost against the budget.
3. **The memo text** that Aivana wrote, exactly as shown on screen.
4. **A cost table:** transport, lodging, meals, extras, the total and the budget gap. These
   numbers come from the **code**, not from Aivana.
5. **A footer on every page:** "Synthetic data. Costs are estimates." plus page numbers.

## Rules
- The button only works **after the memo passed the fact check**. If the fact check flagged
  anything, the button says "Download PDF (has unverified parts)" and the PDF prints a
  warning line at the top listing them. Nothing is hidden.
- The PDF is only for an **approved** trip. If the plan changed after approval (the approval
  is out of date), the download is refused, the same way the calendar file works today.
- The memo isn't saved on the server. The browser sends the memo text, and the server builds
  the PDF and sends it straight back.

## How the PDF is made
- The **server builds the PDF itself**, with a small PDF writer of about 150 lines. The app
  has **no outside packages** today, and this keeps it that way. It also works offline and in
  mock mode.
- It uses the standard built-in PDF fonts (Helvetica), so no font files are needed. Long lines
  wrap and long memos continue on new pages.
- File name: `bgsu-trip-memo-G09-D.pdf`.

## What Aivana does here
Nothing new. Aivana still only writes the memo. The code builds the PDF and fills in the
cost table and approval details.

## Not included (to keep it simple)
- Logos or images in the PDF
- Editing the memo before export. You can still re-run "Write memo".
- PDFs for the season plan or the option comparison. These can be added later the same way.

## How we will test it
1. The PDF writer makes a valid PDF: it starts with `%PDF-`, its table of byte positions is
   correct, and it has the right number of pages for a long memo.
2. The PDF contains the memo text, the approver, and the exact total from the code.
3. Special characters ($, &, quotes, "→", "✓") don't break the file.
4. An out-of-date approval is refused with a clear message.
5. In the browser: write the memo, click Download PDF, and the file opens. Check it in mock
   mode at laptop and phone width.

## Time
About 1–1.5 hours.

## For the developer (code details)
- `src/pdf.js` (new): `makePdf({title, lines, table, footer})` returns a Buffer. It wraps
  text with Helvetica character widths and uses WinAnsi encoding, mapping →, ✓, ✗ and ⚠ to
  plain-text stand-ins.
- `server.js`: `POST /api/memo/pdf` takes `{request, settings, custom, option_id,
  approval_id, text}`. It checks the approval like `/api/ics` and runs
  `planner.checkMemoText` for the warning line. It replies `application/pdf` with
  `Content-Disposition: attachment`.
- `static/app.js` + `index.html`: the Download PDF button next to the memo buttons, with the
  "has unverified parts" label.
- `test/pdf.test.js` (new) for tests 1–4.
