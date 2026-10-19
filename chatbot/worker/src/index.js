// LAIRE site chatbot: one Cloudflare Worker serves every client site.
// Routes: GET /config, POST /chat, POST /lead. Client setup lives in chatbot/clients/.

import CLIENTS from "../../clients/index.js";
import { complete, AllProvidersFailed } from "./providers.js";
import { chunk, search } from "./knowledge.js";
import { systemPrompt, readReply } from "./prompt.js";
import { submitLead, EMAIL_RE } from "./hubspot.js";

const MAX_MSG = 1000;
const MAX_TURNS = 30;
const RATE = { windowMs: 60_000, max: 12 };

const chunkCache = new Map();
const hits = new Map();

function chunksFor(id, client) {
  if (!chunkCache.has(id)) chunkCache.set(id, chunk(client.knowledge));
  return chunkCache.get(id);
}

/** Per-isolate rate limit. A speed bump, not a guarantee: isolates are not shared. */
export function rateLimited(ip, now = Date.now(), store = hits) {
  const list = (store.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  list.push(now);
  store.set(ip, list);
  return list.length > RATE.max;
}

export function allowedOrigin(client, origin) {
  if (!origin) return false;
  return client.config.origins.some((o) => o === origin || (o.startsWith("*.") && origin.endsWith(o.slice(1))));
}

/** The parts of a client config the browser may see. */
export function publicConfig(client) {
  const c = client.config;
  return {
    botName: c.botName,
    company: c.company,
    greeting: c.greeting,
    suggestions: c.suggestions || [],
    theme: c.theme,
    meetingUrl: c.meetingUrl,
    leadAfter: c.leadAfter ?? 2,
    privacyUrl: c.privacyUrl,
  };
}

/** Keep only well-formed user/assistant turns, trimmed to size. */
export function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MSG) }));
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors } });
}

export async function handle(request, env, clients = CLIENTS, deps = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") || "";
  const site = url.searchParams.get("site") || "";
  const client = Object.hasOwn(clients, site) ? clients[site] : null;
  if (!client) return json({ error: "Unknown site." }, 404, {});
  if (!allowedOrigin(client, origin)) return json({ error: "Origin not allowed." }, 403, {});

  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (url.pathname === "/config" && request.method === "GET") return json(publicConfig(client), 200, cors);
  if (request.method !== "POST") return json({ error: "Not found." }, 404, cors);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (rateLimited(`${site}:${ip}`)) return json({ error: "Too many messages. Try again in a minute." }, 429, cors);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Bad request." }, 400, cors);

  if (url.pathname === "/chat") {
    const messages = cleanMessages(body.messages);
    const last = messages.at(-1);
    if (!last || last.role !== "user") return json({ error: "No question." }, 400, cors);
    const recent = messages.filter((m) => m.role === "user").slice(-3).map((m) => m.content).join(" ");
    const context = [...(client.always ? [{ text: client.always.trim() }] : []), ...search(chunksFor(site, client), recent)];
    try {
      const { text, provider } = await complete(env, [{ role: "system", content: systemPrompt(client, context) }, ...messages], {
        fetchImpl: deps.fetch,
      });
      return json({ ...readReply(text), provider }, 200, cors);
    } catch (e) {
      if (e instanceof AllProvidersFailed) {
        console.log("all providers failed", site, e.errors.join("; "));
        return json({ fallback: true, error: "The assistant is busy right now. Leave your details and the team will reach out." }, 503, cors);
      }
      throw e;
    }
  }

  if (url.pathname === "/lead") {
    const lead = body.lead || {};
    if (!EMAIL_RE.test(String(lead.email || ""))) return json({ error: "Please enter a valid email." }, 400, cors);
    if (body.website) return json({ ok: true }, 200, cors); // honeypot field, bots fill it
    try {
      await submitLead(client, lead, cleanMessages(body.transcript), { pageUri: body.pageUri, pageName: body.pageName, hutk: body.hutk }, deps.fetch);
      return json({ ok: true }, 200, cors);
    } catch (e) {
      console.log("lead failed", site, e.message);
      return json({ error: "Could not save your details. Please try again or use the contact page." }, 502, cors);
    }
  }

  return json({ error: "Not found." }, 404, cors);
}

export default {
  fetch: (request, env) => handle(request, env),
};
