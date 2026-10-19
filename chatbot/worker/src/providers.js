// Free-tier LLM providers, tried in order. Keys are Worker secrets, never in the repo or the browser.
// Same providers and models as js/ai.js in the Manuscrit app.

export const PROVIDERS = [
  { id: "groq", secret: "GROQ_KEY", url: "https://api.groq.com/openai/v1/chat/completions", model: "openai/gpt-oss-120b" },
  { id: "cerebras", secret: "CEREBRAS_KEY", url: "https://api.cerebras.ai/v1/chat/completions", model: "gpt-oss-120b" },
  { id: "openrouter", secret: "OPENROUTER_KEY", url: "https://openrouter.ai/api/v1/chat/completions", model: "google/gemma-4-31b-it:free" },
];

export class AllProvidersFailed extends Error {
  constructor(errors) {
    super("All AI providers are busy or failed.");
    this.errors = errors;
  }
}

/**
 * One chat completion. Rotates through providers that have a key until one answers.
 * Throws AllProvidersFailed if none do, so the widget can fall back to the lead form.
 */
export async function complete(env, messages, { maxTokens = 700, fetchImpl = fetch } = {}) {
  const errors = [];
  for (const p of PROVIDERS) {
    const key = env[p.secret];
    if (!key) continue;
    try {
      const res = await fetchImpl(p.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: env[`${p.secret}_MODEL`] || p.model, max_tokens: maxTokens, temperature: 0.3, messages }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        errors.push(`${p.id}: ${res.status}`);
        continue;
      }
      const text = body?.choices?.[0]?.message?.content || "";
      if (!text.trim()) {
        errors.push(`${p.id}: empty`);
        continue;
      }
      return { text: text.trim(), provider: p.id };
    } catch (e) {
      errors.push(`${p.id}: ${e.message}`);
    }
  }
  throw new AllProvidersFailed(errors);
}
