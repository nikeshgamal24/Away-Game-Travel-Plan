// Trip memo layout, shared by the browser (memo box) and the server (PDF). Plain ES module with no imports.
// Aivana sometimes writes every line as "- Overview: item". tidyMemo turns that into a section heading followed by
// "- item" lines, so each section name appears once, as a heading.

export const SECTIONS = ["Overview", "Schedule", "Lodging", "Meals", "Costs", "Team rules", "Watch-outs",
  "Example policy", "Example travel-policy checks", "Drivers"];
const KEY = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
const SECTION_BY_KEY = new Map(SECTIONS.map((s) => [KEY(s), s]));
const sectionOf = (label) => SECTION_BY_KEY.get(KEY(label)) || null;

/** "- Overview: Travelers: 22 players" -> heading "Overview" + "- Travelers: 22 players". Other lines are kept. */
export function tidyMemo(text) {
  const out = [];
  let current = null;
  const blank = () => { if (out.length && out[out.length - 1] !== "") out.push(""); };
  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    const m = /^(?:[-*•]\s*)(.{2,40}?)\s*:\s*(.+)$/.exec(line);
    const sec = m && sectionOf(m[1]);
    if (sec) {
      if (sec !== current) { blank(); out.push(sec); current = sec; }
      out.push(`- ${m[2]}`);
      continue;
    }
    const heading = sectionOf(line.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/:$/, ""));
    if (heading) {
      if (heading === current) continue; // already started by a prefixed line
      out.push(raw.trimEnd()); current = heading; // a real heading line is kept exactly as written
      continue;
    }
    if (!line) { blank(); continue; }
    out.push(raw.trimEnd());
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Memo text -> HTML for the memo box: first line bold, section names as headings, dashes as bullet lists. */
export function memoHtml(text) {
  const lines = tidyMemo(text).split("\n");
  let html = "", list = false;
  const close = () => { if (list) { html += "</ul>"; list = false; } };
  lines.forEach((raw, i) => {
    const line = raw.trim().replace(/\*\*(.+?)\*\*/g, "$1");
    if (!line) { close(); return; }
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) { if (!list) { html += "<ul>"; list = true; } html += `<li>${esc(bullet[1])}</li>`; return; }
    close();
    const md = /^#{1,6}\s+(.*)$/.exec(line);
    // Same rule as the PDF: a section name, or a short label line (no sentence punctuation, no amount), is a heading.
    const looksLikeHeading = i > 0 && line.length <= 48 && !/[.!?,;]$/.test(line) && !/\$\d/.test(line);
    if (md || sectionOf(line.replace(/:$/, "")) || looksLikeHeading) html += `<h4>${esc((md ? md[1] : line).replace(/:$/, ""))}</h4>`;
    else if (i === 0) html += `<p class="memo-lead">${esc(line)}</p>`;
    else html += `<p>${esc(line)}</p>`;
  });
  close();
  return html;
}
