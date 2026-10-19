import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, allowedOrigin, cleanMessages, rateLimited, publicConfig } from "../chatbot/worker/src/index.js";
import { complete, AllProvidersFailed } from "../chatbot/worker/src/providers.js";
import { chunk, search } from "../chatbot/worker/src/knowledge.js";
import { readReply, systemPrompt, MEETING_TAG } from "../chatbot/worker/src/prompt.js";
import { formPayload } from "../chatbot/worker/src/hubspot.js";
import { htmlToText, locs } from "../chatbot/scripts/crawl.mjs";
import CLIENTS from "../chatbot/clients/index.js";

const client = {
  config: {
    botName: "Bot",
    company: "Acme",
    about: "Acme builds sites.",
    greeting: "Hi",
    theme: {},
    meetingUrl: "https://acme.test/meet",
    pricing: "never",
    hubspot: { portalId: "1", formGuid: "g", fields: { transcript: "message" } },
    origins: ["https://acme.test", "*.acme.dev"],
  },
  knowledge: "# Websites\nWe build HubSpot websites.\n\n# SEO\nWe do SEO and AEO audits.",
};
const clients = { acme: client };
const ok = (content) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });
const req = (path, body, origin = "https://acme.test") =>
  new Request(`https://w.test${path}?site=acme`, {
    method: body ? "POST" : "GET",
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": String(Math.random()) },
    body: body ? JSON.stringify(body) : undefined,
  });

test("providers rotate past failures and skip missing keys", async () => {
  const calls = [];
  const fetchImpl = async (url) => (calls.push(url), url.includes("groq") ? fail(429) : ok("hello"));
  const r = await complete({ GROQ_KEY: "g", OPENROUTER_KEY: "o" }, [], { fetchImpl });
  assert.equal(r.provider, "openrouter");
  assert.equal(calls.length, 2);
});

test("all providers failing throws AllProvidersFailed", async () => {
  await assert.rejects(complete({ GROQ_KEY: "g" }, [], { fetchImpl: async () => fail(500) }), AllProvidersFailed);
  await assert.rejects(complete({}, [], { fetchImpl: async () => ok("x") }), AllProvidersFailed);
});

test("search ranks the matching chunk first", () => {
  const top = search(chunk(client.knowledge), "do you do seo?");
  assert.equal(top[0].title, "SEO");
});

test("chunk caps long sections", () => {
  const parts = chunk("# Big\n" + "line of text\n".repeat(500), 1200);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.text.length <= 1300));
});

test("meeting tag is stripped and reported", () => {
  assert.deepEqual(readReply(`Sure.\n${MEETING_TAG}`), { reply: "Sure.", offerMeeting: true });
  assert.equal(readReply("Plain").offerMeeting, false);
});

test("prompt forbids pricing unless ranges are configured", () => {
  assert.match(systemPrompt(client, []), /Never quote prices/);
  const ranges = { config: { ...client.config, pricing: "ranges", pricingNote: "from $2k" } };
  assert.match(systemPrompt(ranges, []), /from \$2k/);
});

test("origin allowlist supports exact and wildcard", () => {
  assert.ok(allowedOrigin(client, "https://acme.test"));
  assert.ok(allowedOrigin(client, "https://www.acme.dev"));
  assert.ok(!allowedOrigin(client, "https://evil.test"));
  assert.ok(!allowedOrigin(client, "https://evilacme.dev"));
  assert.ok(!allowedOrigin(client, ""));
});

test("cleanMessages drops system turns and trims", () => {
  const m = cleanMessages([{ role: "system", content: "x" }, { role: "user", content: "a".repeat(5000) }, { role: "user", content: " " }]);
  assert.equal(m.length, 1);
  assert.equal(m[0].content.length, 1000);
});

test("rate limit trips after the window max", () => {
  const store = new Map();
  let tripped = false;
  for (let i = 0; i < 13; i++) tripped = rateLimited("ip", 1000 + i, store);
  assert.ok(tripped);
  assert.ok(!rateLimited("ip", 1000 + 61_000, store));
});

test("public config hides HubSpot and origins", () => {
  const p = publicConfig(client);
  assert.equal(p.hubspot, undefined);
  assert.equal(p.origins, undefined);
});

test("form payload maps fields and transcript", () => {
  const p = formPayload(client, { email: "a@b.co", firstname: "Ann" }, [{ role: "user", content: "hi" }], { pageUri: "u", hutk: "h" });
  assert.deepEqual(
    p.fields.map((f) => f.name),
    ["email", "firstname", "message"]
  );
  assert.equal(p.fields[2].value, "Visitor: hi");
  assert.equal(p.context.hutk, "h");
});

test("handle: unknown site, bad origin, config", async () => {
  assert.equal((await handle(new Request("https://w.test/config?site=nope"), {}, clients)).status, 404);
  assert.equal((await handle(new Request("https://w.test/config?site=__proto__"), {}, clients)).status, 404);
  assert.equal((await handle(req("/config", null, "https://evil.test"), {}, clients)).status, 403);
  const r = await handle(req("/config"), {}, clients);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://acme.test");
  assert.equal((await r.json()).botName, "Bot");
});

test("handle: chat answers, and falls back when providers fail", async () => {
  const good = await handle(req("/chat", { messages: [{ role: "user", content: "seo?" }] }), { GROQ_KEY: "k" }, clients, {
    fetch: async () => ok(`Yes we do SEO.\n${MEETING_TAG}`),
  });
  assert.deepEqual(await good.json(), { reply: "Yes we do SEO.", offerMeeting: true, provider: "groq" });
  const bad = await handle(req("/chat", { messages: [{ role: "user", content: "hi" }] }), { GROQ_KEY: "k" }, clients, { fetch: async () => fail(429) });
  assert.equal(bad.status, 503);
  assert.equal((await bad.json()).fallback, true);
});

test("handle: lead validates email and posts to HubSpot", async () => {
  assert.equal((await handle(req("/lead", { lead: { email: "nope" } }), {}, clients)).status, 400);
  let posted;
  const r = await handle(req("/lead", { lead: { email: "a@b.co" }, transcript: [] }), {}, clients, {
    fetch: async (url, init) => ((posted = { url, body: JSON.parse(init.body) }), { ok: true }),
  });
  assert.equal(r.status, 200);
  assert.match(posted.url, /submit\/1\/g$/);
  assert.equal(posted.body.fields[0].value, "a@b.co");
});

test("crawler strips chrome and reads sitemaps", () => {
  const { title, text } = htmlToText("<title>A &amp; B</title><nav>Menu</nav><main><h1>Hello there</h1><script>x()</script><p>Body text here</p></main>");
  assert.equal(title, "A & B");
  assert.equal(text, "Hello there\nBody text here");
  assert.deepEqual(locs("<url><loc>https://a.test/x</loc></url><loc> https://a.test/y?a=1&amp;b=2 </loc>"), ["https://a.test/x", "https://a.test/y?a=1&b=2"]);
});

test("every registered client has the required config", () => {
  for (const [id, c] of Object.entries(CLIENTS)) {
    for (const k of ["botName", "company", "about", "greeting", "meetingUrl", "hubspot", "origins"]) assert.ok(c.config[k] !== undefined, `${id}.${k}`);
    assert.ok(c.knowledge.length > 100, `${id} knowledge`);
  }
});

test("replies lose em and en dashes", () => {
  assert.equal(readReply("Yes \u2013 we do. Fast\u2014really. Non\u2011stop").reply, "Yes, we do. Fast, really. Non-stop");
});
