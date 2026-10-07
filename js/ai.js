// Optional AI helpers. Free-tier providers called straight from the browser with the author's own keys.
// Keys live only in this browser. They are never part of the site or the repo.

export const PROVIDERS = {
  groq: {
    name: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "openai/gpt-oss-120b",
    signup: "https://console.groq.com/keys",
    match: /^gsk_[A-Za-z0-9]+$/,
    note: "Very fast. Good for sorting and splitting.",
  },
  cerebras: {
    name: "Cerebras",
    url: "https://api.cerebras.ai/v1/chat/completions",
    model: "gpt-oss-120b",
    signup: "https://cloud.cerebras.ai",
    match: /^csk-[A-Za-z0-9]+$/,
    note: "Very fast. Good backup for Groq.",
  },
  gemini: {
    name: "Google Gemini",
    model: "gemini-2.5-flash",
    signup: "https://aistudio.google.com/apikey",
    match: /^AIza[0-9A-Za-z_-]{35}$/,
    note: "Long memory. Best for Lumiere research across a whole book.",
  },
  openrouter: {
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "google/gemma-4-31b-it:free",
    signup: "https://openrouter.ai/keys",
    match: /^sk-or-[A-Za-z0-9-]+$/,
    note: "Many free models with one key. Models ending in :free cost nothing.",
  },
  mistral: {
    name: "Mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
    model: "mistral-small-latest",
    signup: "https://console.mistral.ai/api-keys",
    match: null,
    note: "Free tier with tight rate limits.",
  },
};

export const TASKS = {
  sort: { name: "Plumi sorting", help: "Picks the book and chapter for each note." },
  split: { name: "Dictation splitting", help: "Breaks a long dictation into separate notes." },
  assist: { name: "Edit suggestions", help: "Mode Assisté suggestions." },
  research: { name: "Lumière research", help: "Summaries, continuity and questions about a book." },
};

export const DEFAULT_TASKS = { sort: "groq", split: "groq", assist: "cerebras", research: "gemini" };

function friendlyError(provider, status, body) {
  const msg = (body && (body.error?.message || body.message)) || "";
  if (status === 401) return "Key was rejected. Check it was pasted in full.";
  if (status === 429) return "Free limit reached for now. Try again in a minute, or pick another provider.";
  if (status === 403 && provider === "gemini") return "This key is blocked for Gemini. Turn on the Generative Language API for it in Google Cloud, or make a key at aistudio.google.com.";
  if (status === 404) return `Model not found. ${msg}`.trim();
  return `${status} ${msg}`.trim();
}

/** One chat completion. Returns plain text. */
export async function complete({ provider, key, model, system, user, maxTokens = 4000 }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error("Unknown provider.");
  if (!key) throw new Error(`No ${p.name} key saved.`);
  model = model || p.model;

  let res;
  let body;
  try {
    if (provider === "gemini") {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens: maxTokens },
          }),
        }
      );
    } else {
      res = await fetch(p.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    }
    body = await res.json().catch(() => null);
  } catch {
    throw new Error(`Could not reach ${p.name}. Check the connection.`);
  }
  if (!res.ok) throw new Error(`${p.name}: ${friendlyError(provider, res.status, body)}`);

  const text =
    provider === "gemini"
      ? (body?.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join("")
      : body?.choices?.[0]?.message?.content || "";
  if (!text.trim()) throw new Error(`${p.name} returned an empty answer. Try again.`);
  return text;
}

/** Pull the first JSON object out of a model reply, ignoring code fences and chatter. */
export function parseJson(text) {
  const s = String(text || "").replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI answer was not in the expected format. Try again.");
  return JSON.parse(s.slice(start, end + 1));
}

/** Quick check that a key works. */
export async function testProvider(provider, key, model) {
  const t = Date.now();
  const text = await complete({ provider, key, model, system: "Answer with one word.", user: "Say ready.", maxTokens: 400 });
  return { ms: Date.now() - t, text: text.trim().slice(0, 40) };
}

/**
 * Read keys from a file the author keeps privately. Accepts the JSON this app downloads,
 * "provider: key" lines, or any text that contains recognizable keys.
 */
export function parseKeysFile(text) {
  const found = {};
  const raw = String(text || "");
  try {
    const j = JSON.parse(raw);
    const src = j.keys || j;
    for (const id of Object.keys(PROVIDERS)) if (typeof src[id] === "string" && src[id].trim()) found[id] = src[id].trim();
    if (Object.keys(found).length) return found;
  } catch {
    /* not JSON */
  }
  const clean = raw.replace(/\\_/g, "_");
  for (const id of Object.keys(PROVIDERS)) {
    const line = clean.match(new RegExp(`^\\s*[*-]?\\s*${id}\\s*[:=]\\s*(\\S+)`, "im"));
    if (line) found[id] = line[1];
  }
  const grab = (re) => (clean.match(re) || [])[0];
  found.groq ||= grab(/gsk_[A-Za-z0-9]{20,}/);
  found.cerebras ||= grab(/csk-[A-Za-z0-9]{20,}/);
  found.openrouter ||= grab(/sk-or-[A-Za-z0-9-]{20,}/);
  found.gemini ||= grab(/AIza[0-9A-Za-z_-]{35}/);
  if (!found.mistral) {
    const m = clean.match(/mistral[^\n]*\n\s*[*-]?\s*([A-Za-z0-9_]{20,})/i);
    if (m) found.mistral = m[1];
  }
  for (const k of Object.keys(found)) if (!found[k]) delete found[k];
  return found;
}

/* ---------- Tasks ---------- */

function outlineOf(books) {
  return books.map((b) => ({
    bookId: b.id,
    title: b.title,
    keywords: b.keywords,
    chapters: (b.chapters || []).map((c) => ({ chapterId: c.id, title: c.title, keywords: c.keywords })),
  }));
}

function resolvePlace(books, bookId, chapterId) {
  const book = books.find((b) => b.id === bookId) || null;
  const chapter = book ? (book.chapters || []).find((c) => c.id === chapterId) || null : null;
  return { bookId: book ? book.id : null, chapterId: chapter ? chapter.id : null };
}

/** Plumi: choose a book and chapter. Never rewrites. */
export async function aiSort(conn, text, books) {
  const system =
    "You are Plumi, the organizing guide in Manuscrit.AI. You file an author's note into the right book and " +
    "chapter. Never rewrite or judge their words. Reply with JSON only: " +
    '{"bookId": string or null, "chapterId": string or null, "tags": [up to 3 short lowercase topics], "reason": one short sentence to the author}. ' +
    "Use ids exactly as given. Use null when nothing fits.";
  const out = parseJson(await complete({ ...conn, system, user: `Outline:\n${JSON.stringify(outlineOf(books))}\n\nNote:\n${text}` }));
  return {
    ...resolvePlace(books, out.bookId, out.chapterId),
    tags: Array.isArray(out.tags) ? out.tags.slice(0, 3).map(String) : [],
    reason: String(out.reason || ""),
  };
}

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Split a long dictation into separate notes, keeping the author's exact words. */
export async function aiSplit(conn, text, books) {
  const system =
    "You split an author's long dictation into separate notes, one per distinct idea, scene or thought. " +
    "Copy the author's words exactly. Do not fix, add, reorder or summarize. You may drop spoken cue words " +
    'like "new note". For each note pick the best book and chapter from the outline, or null. ' +
    'Reply with JSON only: {"notes": [{"text": string, "bookId": string or null, "chapterId": string or null}]}';
  const out = parseJson(
    await complete({ ...conn, system, user: `Outline:\n${JSON.stringify(outlineOf(books))}\n\nDictation:\n${text}`, maxTokens: 8000 })
  );
  const notes = (out.notes || []).filter((n) => n && String(n.text || "").trim());
  // Guard the authorship promise: every piece must come from the original words.
  const whole = squash(text);
  const faithful = notes.every((n) => whole.includes(squash(n.text)));
  if (!notes.length || !faithful) throw new Error("The AI changed some words, so the simple split was kept.");
  return notes.map((n) => ({ text: String(n.text).trim(), ...resolvePlace(books, n.bookId, n.chapterId) }));
}

/** Lumiere edit suggestion for Mode Assiste. */
export async function aiAssist(conn, text) {
  const system =
    "You are Lumiere, the editing guide in Manuscrit.AI. Suggest a lightly edited version of the author's " +
    "passage: grammar, punctuation, clarity, obvious transitions. Keep their voice, word choice, tense and " +
    "meaning. Add nothing new. Reply with JSON only: " +
    '{"suggestion": the edited passage, "notes": one short sentence listing the changes}';
  const out = parseJson(await complete({ ...conn, system, user: text }));
  return { suggestion: String(out.suggestion || "").trim(), notes: String(out.notes || "") };
}

export const RESEARCH = {
  summary: { label: "Summarize each chapter", ask: "Summarize each chapter in two or three sentences, in order. Name the chapter before each summary." },
  continuity: { label: "Continuity check", ask: "Find contradictions or continuity problems: names, dates, ages, places, facts that do not agree across notes. Quote the conflicting lines briefly. If none, say so." },
  themes: { label: "Themes and threads", ask: "Name the main themes, motifs and recurring images, with a short example of where each appears." },
  gaps: { label: "What is missing", ask: "Point out gaps: chapters that are thin, threads that start but do not resolve, questions a reader would have. Be specific and kind." },
};

/** Lumiere research over a book's notes. Returns plain text. */
export async function aiResearch(conn, book, sections, question) {
  const system =
    "You are Lumiere, the research and insight guide in Manuscrit.AI. You read the author's own notes for one " +
    "book and answer about them. Ground every point in the notes. Do not invent plot or facts. Do not rewrite " +
    "their prose. Use short paragraphs or simple dashes, plain text, no markdown headings.";
  let corpus = `Book: ${book.title}\n`;
  for (const s of sections) {
    corpus += `\n## ${s.title}\n`;
    for (const f of s.items) corpus += `- ${f.text}\n`;
  }
  return complete({ ...conn, system, user: `${corpus}\n\nRequest: ${question}`, maxTokens: 6000 });
}
