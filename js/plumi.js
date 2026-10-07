// Plumi: rule-based sorting and search. Pure functions, no DOM, no network.
// Runs in the browser and in Node tests.

const STOPWORDS = new Set(`a an and are as at be but by for from has have he her his i if in into is it its
me my no not of on or our she so that the their them then there they this to was we were what when where
which who will with you your just about like really very also been can could would should do does did
than too more some any all one two out up down over only own same such how why get got going want need
le la les un une des et de du en est que qui pour dans sur avec`.split(/\s+/));

export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function tokenize(s) {
  return normalize(s)
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// Light stemming so "dragons" matches "dragon" and "writing" matches "write".
export function stem(w) {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  return w;
}

function stems(s) {
  return new Set(tokenize(s).map(stem));
}

function keywordStems(list) {
  const out = new Set();
  for (const k of list || []) for (const t of tokenize(k)) out.add(stem(t));
  return out;
}

function overlap(a, b) {
  const hits = [];
  for (const t of a) if (b.has(t)) hits.push(t);
  return hits;
}

// Explicit routing written by the author, e.g. "#garden" or "book: The Garden".
function explicitTarget(text, books) {
  const n = normalize(text);
  for (const book of books) {
    const title = normalize(book.title).trim();
    if (!title) continue;
    const slug = title.replace(/[^a-z0-9]+/g, "");
    const tagged = n.match(/#([a-z0-9]+)/g) || [];
    if (tagged.some((t) => t.slice(1) === slug)) return book;
    if (n.includes(`book: ${title}`) || n.includes(`livre: ${title}`)) return book;
  }
  return null;
}

/**
 * Suggest where a fragment belongs.
 * @returns {{bookId:string|null, chapterId:string|null, score:number, reason:string}}
 */
export function suggest(text, books, fragments = []) {
  const none = { bookId: null, chapterId: null, score: 0, reason: "No match yet. Add keywords to a book or chapter." };
  if (!books || books.length === 0) return { ...none, reason: "Create a book first." };

  const explicit = explicitTarget(text, books);
  const words = stems(text);
  let best = none;

  for (const book of books) {
    if (explicit && explicit.id !== book.id) continue;
    const bookTerms = new Set([...stems(book.title), ...keywordStems(book.keywords)]);
    const bookHits = overlap(words, bookTerms);

    // Learn from what the author already filed in this book.
    const filed = new Set();
    for (const f of fragments) {
      if (f.bookId === book.id) for (const t of stems(f.text)) filed.add(t);
    }
    const learnedHits = overlap(words, filed).filter((t) => !bookTerms.has(t));

    let score = bookHits.length * 2 + Math.min(learnedHits.length, 6) * 0.5;
    if (explicit) score += 100;

    let chapterId = null;
    let chapterHits = [];
    for (const ch of book.chapters || []) {
      const chTerms = new Set([...stems(ch.title), ...keywordStems(ch.keywords)]);
      const hits = overlap(words, chTerms);
      if (hits.length > chapterHits.length) {
        chapterHits = hits;
        chapterId = ch.id;
      }
    }
    score += chapterHits.length * 3;

    if (score > best.score) {
      const why = [];
      if (explicit) why.push("tagged by you");
      if (bookHits.length) why.push(`book words: ${bookHits.join(", ")}`);
      if (chapterHits.length) why.push(`chapter words: ${chapterHits.join(", ")}`);
      if (learnedHits.length) why.push(`similar to notes already in this book`);
      best = { bookId: book.id, chapterId, score, reason: why.join("; ") };
    }
  }
  return best;
}

/** Search all fragments. Every query term must appear. Newest first. */
export function search(query, fragments) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return fragments
    .filter((f) => {
      const hay = normalize(f.text + " " + (f.tags || []).join(" "));
      return terms.every((t) => hay.includes(t));
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Mode Assisté without AI: tidy spacing, capitalize sentences, end with a period. Never changes words. */
export function lightTidy(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return t;
  t = t.replace(/(^|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
  t = t.replace(/\bi\b/g, "I");
  if (!/[.!?"')\]]$/.test(t)) {
    const lastSentence = t.split(/[.!?]\s+/).pop();
    t += /^(what|why|how|who|when|where|which|should|could|would|can|do|does|did|is|are|was|will)\b/i.test(lastSentence) ? "?" : ".";
  }
  return t;
}
