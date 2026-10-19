# LAIRE site chatbot

A reusable website chatbot for LAIRE and client sites. One Cloudflare Worker serves every site. Same free
AI providers as Manuscrit (Groq, then Cerebras, then OpenRouter), but the keys live in the Worker, never in
the browser.

What it does:

- Answers questions only from the client's site content and FAQ. Off-topic asks get a polite no.
- Never quotes pricing (per-client switch `pricing: "ranges"` with a fixed `pricingNote` if a client wants it).
- Shows a lead form after 2 answers (`leadAfter`). Leads go to a HubSpot form through the Forms API with the
  `hubspotutk` cookie, so attribution and the portal's workflows work. The chat transcript rides along in the
  form's `message` field. Nothing else is stored.
- Shows a "Book a call" button when the visitor asks for a person, a quote, pricing or a project start.
- If every free provider is rate limited, says so and shows the lead form plus the booking link.

## Layout

| Path | What it does |
| --- | --- |
| `worker/src/index.js` | Routes `/config`, `/chat`, `/lead`, origin allowlist, rate limit |
| `worker/src/providers.js` | Free provider rotation |
| `worker/src/knowledge.js` | Keyword retrieval over the client's knowledge |
| `worker/src/prompt.js` | System prompt and reply cleanup |
| `worker/src/hubspot.js` | HubSpot Forms API lead submit |
| `clients/<id>.js` | One client: bot name, colors, greeting, meetings link, HubSpot form, allowed origins, FAQ |
| `clients/<id>.crawl.js` | Generated site content. Do not edit by hand |
| `scripts/crawl.mjs` | Builds the crawl file from the site's sitemap |
| `widget/widget.js` | The embeddable chat bubble (Shadow DOM, themed per client) |

## Add a client

1. Copy `clients/laire-demo.js` to `clients/<id>.js`. Fill in config, FAQ, HubSpot `portalId` and `formGuid`,
   `meetingUrl`, and every site origin that will embed it.
2. `node chatbot/scripts/crawl.mjs <id> https://www.client.com 60`
3. Register it in `clients/index.js`.
4. `npm test`, then deploy.
5. Paste on the site (HubSpot: Settings, Website, Pages, Site footer HTML):

```
<script src="https://lairedigital.github.io/manuscrit-ai/chatbot/widget/widget.js"
        data-site="<id>" data-api="https://laire-chat.<account>.workers.dev" async></script>
```

## Deploy

```
cd chatbot/worker
npx wrangler login
npx wrangler secret put GROQ_KEY
npx wrangler secret put CEREBRAS_KEY
npx wrangler secret put OPENROUTER_KEY
npx wrangler deploy
```

## Limits to know

- Free tiers rate limit and may log prompts. Fine for the pilot. Do not promise clients uptime on free keys.
- The origin check and per-isolate rate limit stop casual abuse, not a determined script. Add a Cloudflare
  rate limiting rule before a busy client goes live.
- Retrieval is keyword based. Put the must-know facts in the client's `always` block.
