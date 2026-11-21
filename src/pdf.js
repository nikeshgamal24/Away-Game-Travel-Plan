// Tiny PDF writer (no dependencies). Letter pages, built-in Helvetica fonts, text wrapping, simple boxes and tables.
// Enough for a one-to-three page trip memo; not a general PDF library.

const W = 612, H = 792, M = 54;                  // US Letter, 0.75" margins
const BROWN = [0.31, 0.173, 0.114], ORANGE = [0.992, 0.314, 0], GREY = [0.96, 0.965, 0.973];
const INK = [0.118, 0.106, 0.098], MUTED = [0.373, 0.4, 0.44], RED = [0.706, 0.137, 0.094], GREEN = [0.114, 0.451, 0.278];

// Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126, from the standard AFM files.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

// Characters outside Latin-1 that WinAnsi has (0x80-0x9F), plus plain stand-ins for symbols it lacks.
const WINANSI = { "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
  "–": 0x96, "—": 0x97 };
const STANDIN = { "→": "->", "←": "<-", "✓": "OK", "✔": "OK", "✗": "X", "✘": "X", "⚠": "!",
  "️": "", "★": "*", "▸": ">", "−": "-", " ": " ", " ": " ", " ": " " };

/** Text -> WinAnsi-safe string (each char code < 256). Unknown characters become '?'. */
export function toWinAnsi(text) {
  let out = "";
  for (const ch of String(text ?? "").normalize("NFC")) {
    if (ch in STANDIN) out += STANDIN[ch];
    else if (ch in WINANSI) out += String.fromCharCode(WINANSI[ch]);
    else if (ch === "\t") out += "    ";
    else { const c = ch.codePointAt(0); out += c < 32 ? "" : c < 256 ? ch : "?"; }
  }
  return out;
}

const charW = (c, bold) => { const n = c.charCodeAt(0); const t = bold ? HELV_B : HELV; return n >= 32 && n <= 126 ? t[n - 32] : 556; };
export const textWidth = (s, size, bold = false) => [...s].reduce((a, c) => a + charW(c, bold), 0) * size / 1000;

/** Greedy word wrap; words longer than a line are split. Input must already be WinAnsi. */
export function wrap(text, size, maxW, bold = false) {
  const lines = [];
  let cur = "";
  for (let word of text.split(/ +/)) {
    while (textWidth(word, size, bold) > maxW) {      // hard-split a very long word
      let i = 1; while (i < word.length && textWidth(word.slice(0, i + 1), size, bold) <= maxW) i++;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(word.slice(0, i)); word = word.slice(i);
    }
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next, size, bold) <= maxW) cur = next; else { lines.push(cur); cur = word; }
  }
  lines.push(cur);
  return lines;
}

const pdfStr = (s) => "(" + s.replace(/[\\()]/g, (c) => "\\" + c) + ")";
const rgb = (c, op) => `${c.map((x) => +x.toFixed(3)).join(" ")} ${op}`;
const n = (x) => +x.toFixed(2);

/**
 * Build a PDF.
 * doc = { title, header: { title, lines: [..] }, blocks: [...], footer }
 * blocks: { type: "heading", text } | { type: "text", text, bold?, color?, indent? } | { type: "space", h }
 *       | { type: "box", lines: [{ text, bold?, color? }], color? } | { type: "table", rows: [[left, right, { bold? }]] }
 * Returns a Buffer.
 */
export function makePdf(doc) {
  const pages = [];
  let ops, y;
  const newPage = () => { ops = []; pages.push(ops); y = H - M; };
  const text = (x, yy, s, size, bold, color = INK) =>
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb(color, "rg")} ${n(x)} ${n(yy)} Td ${pdfStr(s)} Tj ET`);
  const rect = (x, yy, w, h, color) => ops.push(`${rgb(color, "rg")} ${n(x)} ${n(yy)} ${n(w)} ${n(h)} re f`);
  const room = (h) => { if (y - h < M + 24) newPage(); };
  const bodyW = W - 2 * M;

  newPage();
  // Header band on page 1
  if (doc.header) {
    const hl = (doc.header.lines || []).map(toWinAnsi);
    const bandH = 46 + hl.length * 15;
    rect(0, H - bandH, W, bandH, BROWN);
    rect(0, H - bandH - 4, W, 4, ORANGE);
    text(M, H - 34, toWinAnsi(doc.header.title), 18, true, [1, 1, 1]);
    hl.forEach((l, i) => text(M, H - 54 - i * 15, l, 11, false, [0.93, 0.88, 0.85]));
    y = H - bandH - 28;
  }

  for (const b of doc.blocks || []) {
    if (b.type === "space") { y -= b.h ?? 8; continue; }
    if (b.type === "heading") {
      room(30); y -= 8;
      text(M, y, toWinAnsi(b.text), 13, true, BROWN); y -= 18;
      continue;
    }
    if (b.type === "text") {
      const size = b.size ?? 10.5, lead = size * 1.42, indent = b.indent ?? 0;
      const bullet = b.bullet ? toWinAnsi(b.bullet) : "";
      const lines = wrap(toWinAnsi(b.text), size, bodyW - indent - (bullet ? 12 : 0), b.bold);
      lines.forEach((l, i) => {
        room(lead);
        if (bullet && i === 0) text(M + indent, y, bullet, size, false, MUTED);
        text(M + indent + (bullet ? 12 : 0), y, l, size, b.bold, b.color ?? INK);
        y -= lead;
      });
      continue;
    }
    if (b.type === "box") {
      const pad = 12, size = 10.5, lead = 15;
      const lines = b.lines.flatMap((l) => wrap(toWinAnsi(l.text), size, bodyW - 2 * pad - 4, l.bold)
        .map((t) => ({ ...l, text: t })));
      const h = lines.length * lead + 2 * pad - 4;
      room(h + 6);
      rect(M, y - h + 10, bodyW, h, b.fill ?? GREY);
      rect(M, y - h + 10, 4, h, b.color ?? GREEN);
      let yy = y - pad + 2;
      for (const l of lines) { text(M + pad + 4, yy, l.text, size, l.bold, l.color ?? INK); yy -= lead; }
      y -= h + 12;
      continue;
    }
    if (b.type === "table") {
      const size = 10.5, rowH = 19;
      for (const [left, right, opt = {}] of b.rows) {
        room(rowH);
        if (opt.bold) rect(M, y + 13, bodyW, 1.2, BROWN);
        const L = toWinAnsi(left), R = toWinAnsi(right);
        text(M, y, L, size, opt.bold, opt.color ?? INK);
        text(W - M - textWidth(R, size, opt.bold), y, R, size, opt.bold, opt.color ?? INK);
        if (!opt.bold) rect(M, y - 6, bodyW, 0.5, [0.886, 0.894, 0.91]);
        y -= rowH;
      }
      continue;
    }
    throw new Error(`Unknown PDF block type: ${b.type}`);
  }

  // Footer on every page, now that the page count is known
  const foot = toWinAnsi(doc.footer || "");
  pages.forEach((p, i) => {
    ops = p;
    const pg = `Page ${i + 1} of ${pages.length}`;
    rect(M, M - 4, bodyW, 0.5, [0.81, 0.83, 0.85]);
    text(M, M - 18, foot, 8.5, false, MUTED);
    text(W - M - textWidth(pg, 8.5), M - 18, pg, 8.5, false, MUTED);
  });

  // Assemble objects: 1 catalog, 2 pages, 3-4 fonts, 5 info, then page + content pairs.
  const objs = [];
  const kids = pages.map((_, i) => `${6 + i * 2} 0 R`).join(" ");
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objs[5] = `<< /Title ${pdfStr(toWinAnsi(doc.title || ""))} /Producer (BGSU Away-Game Planner) >>`;
  pages.forEach((p, i) => {
    const content = p.join("\n");
    objs[6 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + i * 2} 0 R >>`;
    objs[7 + i * 2] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  });

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` +
    offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ------------------------------------------------------------------ the trip memo
import { tidyMemo } from "../static/memoFormat.js";
const usd = (x) => (x < 0 ? "-$" : "$") + Math.abs(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Aivana's plain-text memo -> PDF blocks. Dashed lines become bullets; short label lines become headings. */
export function memoBlocks(text) {
  const blocks = [];
  const lines = tidyMemo(text).split("\n"); // "- Overview: x" lines become an "Overview" heading + "- x"
  lines.forEach((raw, i) => {
    let line = raw.trim().replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
    if (!line) { blocks.push({ type: "space", h: 5 }); return; }
    const md = line.match(/^#{1,6}\s+(.*)$/);
    if (md) { blocks.push({ type: "heading", text: md[1] }); return; }
    const bul = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bul) { blocks.push({ type: "text", text: bul[1], bullet: "•", indent: 4 }); return; }
    if (i === 0) { blocks.push({ type: "text", text: line, bold: true, size: 12 }); return; }
    if (line.length <= 48 && !/[.!?,;]$/.test(line) && !/\$\d/.test(line)) {
      blocks.push({ type: "heading", text: line.replace(/:$/, "") }); return;
    }
    blocks.push({ type: "text", text: line });
  });
  return blocks;
}

/**
 * The downloadable trip memo. Every number outside the memo text comes from the code (plan, package, approval).
 * check = planner.checkMemoText(text, plan): unverified parts are printed at the top, never hidden.
 */
export function memoPdf({ plan, pkg, approval, text, check }) {
  const g = plan.game;
  const kick = new Date(`${g.date}T${g.kickoff}`).toLocaleString("en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString("en-US",
    { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); };
  const gap = pkg.budget_gap;
  const gapLine = Math.abs(gap) < 0.005 ? "on budget" : gap > 0 ? `${usd(gap)} under budget` : `${usd(-gap)} over budget`;
  const bad = [...(check?.unverified_numbers || []).map((x) => `${x} is not in the app's numbers`), ...(check?.unverified_claims || [])];

  const blocks = [
    { type: "box", color: [0.114, 0.451, 0.278], lines: [
      { text: `Approved by ${approval.role}, ${when(approval.approved_at)} (approval ${approval.approval_id})`, bold: true },
      ...(approval.note ? [{ text: `Note: ${approval.note}` }] : []),
      { text: `Total ${usd(pkg.costs.total)} against a ${usd(plan.budget)} budget: ${gapLine}.`,
        color: gap < 0 ? [0.706, 0.137, 0.094] : undefined },
    ] },
  ];
  if (bad.length) {
    blocks.push({ type: "box", color: [0.706, 0.137, 0.094], fill: [0.992, 0.925, 0.918], lines: [
      { text: "Fact check: some parts of this memo do not match the app's math. Use the cost table below.", bold: true,
        color: [0.706, 0.137, 0.094] },
      ...bad.map((x) => ({ text: `- ${x}` })),
    ] });
  }
  blocks.push({ type: "heading", text: "Memo" }, ...memoBlocks(text), { type: "space", h: 6 },
    { type: "heading", text: "Cost estimate (calculated by the app)" },
    { type: "table", rows: [
      ["Transport", usd(pkg.costs.transport)], ["Lodging", usd(pkg.costs.lodging)], ["Meals", usd(pkg.costs.meals)],
      ["Extras", usd(pkg.costs.extras)], ["Total", usd(pkg.costs.total), { bold: true }],
      [`Budget ${usd(plan.budget)}`, gapLine, { color: gap < 0 ? [0.706, 0.137, 0.094] : [0.114, 0.451, 0.278] }],
    ] });

  return makePdf({
    title: `Trip memo: ${g.opponent}, option ${pkg.option_id}`,
    header: { title: "BGSU Men's Soccer: Away-Game Trip Memo",
      lines: [`${g.opponent}, ${g.city} • ${kick}`, `Option ${pkg.option_id}: ${pkg.name}`] },
    blocks,
    footer: "Synthetic data. Costs are estimates. Aivana wrote the memo text; the app calculated every cost.",
  });
}
