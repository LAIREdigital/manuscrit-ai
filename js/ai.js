// Optional Claude features. Only runs when the author pastes their own API key.
// The key stays in this browser and is sent only to api.anthropic.com.

let clientPromise = null;
let clientKey = null;

async function getClient(apiKey) {
  if (!clientPromise || clientKey !== apiKey) {
    clientKey = apiKey;
    clientPromise = import("https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm").then(
      ({ default: Anthropic }) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    );
  }
  return clientPromise;
}

async function ask({ apiKey, model, system, content, schema, maxTokens = 2000 }) {
  const client = await getClient(apiKey);
  const response = await client.beta.messages.create({
    model,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined this request.");
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

const SORT_SCHEMA = {
  type: "object",
  properties: {
    bookId: { type: ["string", "null"] },
    chapterId: { type: ["string", "null"] },
    tags: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
  },
  required: ["bookId", "chapterId", "tags", "reason"],
  additionalProperties: false,
};

/** Plumi with Claude: pick the best book and chapter. Never rewrites the text. */
export async function sortWithClaude({ apiKey, model, text, books }) {
  const outline = books.map((b) => ({
    bookId: b.id,
    title: b.title,
    keywords: b.keywords,
    chapters: (b.chapters || []).map((c) => ({ chapterId: c.id, title: c.title, keywords: c.keywords })),
  }));
  const system =
    "You are Plumi, the organizing guide inside Manuscrit.AI, a tool that helps authors file their own " +
    "notes into the right book and chapter. You never rewrite or judge the author's words. Pick the single " +
    "best book and chapter from the outline using ids exactly as given. Use null when nothing fits. " +
    "Add up to 3 short lowercase topic tags. Give a one sentence reason addressed to the author.";
  const content = `Outline:\n${JSON.stringify(outline)}\n\nFragment:\n${text}`;
  const out = await ask({ apiKey, model, system, content, schema: SORT_SCHEMA });
  const book = books.find((b) => b.id === out.bookId) || null;
  const chapter = book ? (book.chapters || []).find((c) => c.id === out.chapterId) || null : null;
  return {
    bookId: book ? book.id : null,
    chapterId: chapter ? chapter.id : null,
    tags: (out.tags || []).slice(0, 3),
    reason: out.reason || "",
    by: "claude",
  };
}

const ASSIST_SCHEMA = {
  type: "object",
  properties: { suggestion: { type: "string" }, notes: { type: "string" } },
  required: ["suggestion", "notes"],
  additionalProperties: false,
};

/** Mode Assisté with Claude: light edit suggestion. The author decides. */
export async function assistWithClaude({ apiKey, model, text }) {
  const system =
    "You are Lumiere, the editing guide inside Manuscrit.AI. Suggest a lightly edited version of the " +
    "author's passage: fix grammar, punctuation and clarity, smooth obvious transitions. Keep the author's " +
    "voice, word choice, tense and meaning. Do not add new ideas or flourishes. In notes, list the changes " +
    "in one short sentence.";
  return ask({ apiKey, model, system, content: text, schema: ASSIST_SCHEMA });
}
