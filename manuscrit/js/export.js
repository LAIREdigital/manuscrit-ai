// Export a book as Markdown (Scrivener imports it), Word, or PDF (print). Plus a full JSON backup.

export function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "manuscript";

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Notes keep the order the author sets, falling back to when they were written. */
export const sortKey = (f) => (typeof f.order === "number" ? f.order : f.createdAt);

/** Group a book's fragments by chapter, oldest first, unsorted notes last. */
export function bookSections(book, fragments) {
  const mine = fragments.filter((f) => f.bookId === book.id).sort((a, b) => sortKey(a) - sortKey(b));
  const sections = (book.chapters || []).map((ch) => ({
    title: ch.title,
    items: mine.filter((f) => f.chapterId === ch.id),
  }));
  const loose = mine.filter((f) => !f.chapterId || !(book.chapters || []).some((c) => c.id === f.chapterId));
  if (loose.length) sections.push({ title: "Unplaced notes", items: loose });
  return sections;
}

export function toMarkdown(book, fragments) {
  let md = `# ${book.title}\n\n`;
  for (const s of bookSections(book, fragments)) {
    md += `## ${s.title}\n\n`;
    for (const f of s.items) md += `${f.text}\n\n`;
  }
  return md;
}

function toHtml(book, fragments) {
  let body = `<h1>${esc(book.title)}</h1>`;
  for (const s of bookSections(book, fragments)) {
    body += `<h2>${esc(s.title)}</h2>`;
    for (const f of s.items) body += `<p>${esc(f.text).replace(/\n/g, "<br>")}</p>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(book.title)}</title>
<style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.6;max-width:40em;margin:2em auto;color:#111}
h1{font-size:24pt;text-align:center;margin-bottom:1.5em}h2{font-size:16pt;margin-top:2em;page-break-before:auto}
p{text-indent:1.5em;margin:0 0 .6em}</style></head><body>${body}</body></html>`;
}

export function exportMarkdown(book, fragments) {
  download(`${slug(book.title)}.md`, toMarkdown(book, fragments), "text/markdown");
}

export function exportWord(book, fragments) {
  download(`${slug(book.title)}.doc`, toHtml(book, fragments), "application/msword");
}

export function exportPdf(book, fragments) {
  const w = window.open("", "_blank");
  if (!w) throw new Error("Allow pop-ups to print or save as PDF.");
  w.document.write(toHtml(book, fragments));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export function exportBackup(state) {
  const stamp = new Date().toISOString().slice(0, 10);
  download(`manuscrit-backup-${stamp}.json`, JSON.stringify(state, null, 2), "application/json");
}
