// Tiny keyword retrieval over a client's knowledge text. No embeddings, no paid services.

const STOP = new Set(
  "a an and are as at be but by can do does for from how i if in is it me my of on or our so that the this to us we what when where which who why will with you your".split(" ")
);

export function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Split knowledge into chunks on markdown headings, then cap each chunk's length. */
export function chunk(text, maxChars = 1200) {
  const out = [];
  const sections = String(text || "").split(/\n(?=#{1,3} )/);
  for (const s of sections) {
    const title = (s.match(/^#{1,3} (.+)/) || [])[1] || "";
    let body = s.trim();
    while (body.length > maxChars) {
      const cut = body.lastIndexOf("\n", maxChars) > maxChars / 2 ? body.lastIndexOf("\n", maxChars) : maxChars;
      out.push({ title, text: body.slice(0, cut).trim() });
      body = (title ? `# ${title} (cont.)\n` : "") + body.slice(cut).trim();
    }
    if (body) out.push({ title, text: body });
  }
  return out;
}

/** Top chunks for a query. Title hits count double. */
export function search(chunks, query, limit = 4) {
  const q = new Set(tokens(query));
  if (!q.size) return chunks.slice(0, limit);
  return chunks
    .map((c) => {
      let score = 0;
      for (const w of tokens(c.text)) if (q.has(w)) score += 1;
      for (const w of tokens(c.title)) if (q.has(w)) score += 2;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c);
}
