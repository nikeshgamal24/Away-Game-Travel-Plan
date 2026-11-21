// Tests for the dependency-free PDF writer and the trip-memo PDF. Run: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makePdf, memoPdf, memoBlocks, toWinAnsi, wrap, textWidth } from "../src/pdf.js";
import * as planner from "../src/planner.js";

/** Structural check: header, every xref offset points at its object, startxref points at the xref table. */
function assertValidPdf(buf) {
  const s = buf.toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  const startxref = Number(s.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(s.slice(startxref, startxref + 4), "xref");
  const [, count] = s.slice(startxref).match(/xref\n0 (\d+)\n/);
  const entries = [...s.slice(startxref).matchAll(/(\d{10}) 00000 n \n/g)].map((m) => Number(m[1]));
  assert.equal(entries.length, Number(count) - 1);
  entries.forEach((off, i) => assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1}`));
  for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {           // stream lengths are exact
    const start = m.index + m[0].length;
    assert.equal(s.slice(start + Number(m[1]), start + Number(m[1]) + 10), "\nendstream");
  }
  return s;
}
const pageCount = (s) => Number(s.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1]);

describe("PDF writer", () => {
  test("makes a valid one-page PDF", () => {
    const s = assertValidPdf(makePdf({ title: "T", blocks: [{ type: "text", text: "Hello" }], footer: "F" }));
    assert.equal(pageCount(s), 1);
    assert.ok(s.includes("(Hello) Tj"));
    assert.ok(s.includes("(Page 1 of 1) Tj"));
  });
  test("long text wraps and continues on new pages, each with a footer", () => {
    const para = "The team bus leaves campus at one in the afternoon and arrives at the hotel by ten thirty. ".repeat(8);
    const blocks = Array.from({ length: 40 }, () => ({ type: "text", text: para }));
    const s = assertValidPdf(makePdf({ title: "Long", blocks, footer: "Footer" }));
    const pages = pageCount(s);
    assert.ok(pages >= 5, `expected many pages, got ${pages}`);
    assert.ok(s.includes(`(Page ${pages} of ${pages}) Tj`));
    assert.equal((s.match(/\(Footer\) Tj/g) || []).length, pages);
  });
  test("wrapped lines fit the width", () => {
    const lines = wrap("a ".repeat(300) + "Supercalifragilisticexpialidocious".repeat(6), 10.5, 200);
    for (const l of lines) assert.ok(textWidth(l, 10.5) <= 200, l);
  });
  test("special characters don't break the file", () => {
    assert.equal(toWinAnsi("A → B ✓ ✗ ⚠ 日本"), "A -> B OK X ! ??");
    assert.equal(toWinAnsi("“Lakeview” – café • …").length, "“Lakeview” – café • …".length);
    const s = assertValidPdf(makePdf({ title: "Q (x) \\ y", blocks: [{ type: "text", text: "Cost $1,234.00 & (approx) \\ back → next ✓" }] }));
    assert.ok(s.includes("(Cost $1,234.00 & \\(approx\\) \\\\ back -> next OK) Tj"));
  });
  test("memo text becomes headings and bullets", () => {
    const b = memoBlocks("BGSU TRIP MEMO: Lakeview\nApproved by Head Coach on Sat 9:00 AM (approval ab12cd34)\n\nOverview\n- Option B: Bus\n**Costs**\n## Watch-outs\nCosts are estimates from the data pack.");
    assert.deepEqual(b.map((x) => x.type + (x.bullet ? "*" : "")),
      ["text", "text", "space", "heading", "text*", "heading", "heading", "text"]);
    assert.equal(b[0].bold, true);
  });
});

describe("trip memo PDF", () => {
  const data = planner.loadData();
  const req = { game_id: "G07", num_players: 22, num_coaches: 4, num_staff: 3, budget: 6000, depart_after: "2027-09-18T12:00" };
  const [cleanReq] = planner.validateRequest(req, data);
  const plan = planner.buildPackages(cleanReq, data, planner.mergeSettings(data.settings, {})[0], null);
  const pkg = plan.packages.find((p) => p.option_id === "B");
  const approval = { role: "Head Coach", approved_at: "2026-11-21T10:15", approval_id: "ab12cd34", note: "AD agreed" };

  test("has the approver, the code's total and the memo text", () => {
    const text = `BGSU TRIP MEMO\nOverview\n- Option ${pkg.option_id}\n- Total $${pkg.costs.total.toFixed(2)}`;
    const s = assertValidPdf(memoPdf({ plan, pkg, approval, text, check: planner.checkMemoText(text, plan) }));
    assert.ok(s.includes("Head Coach"));
    assert.ok(s.includes("Note: AD agreed"));
    const total = "$" + pkg.costs.total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    assert.ok(s.includes(`(${total}) Tj`), "cost table total");
    assert.ok(s.includes("(BGSU TRIP MEMO) Tj"));
    assert.ok(!s.includes("Fact check:"));
  });
  test("unverified parts are printed, not hidden", () => {
    const text = "BGSU TRIP MEMO\n- Total $99,999.00";
    const s = memoPdf({ plan, pkg, approval, text, check: planner.checkMemoText(text, plan) }).toString("latin1");
    assert.ok(s.includes("Fact check: some parts of this memo"));
    assert.ok(s.includes("99,999.00"));
  });
});
