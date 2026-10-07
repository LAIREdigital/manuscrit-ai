# Manuscrit.AI (MVP)

The second brain for authors. Capture ideas the way they arrive (voice, typing, screenshots) and let
Plumi file each one into the right book and chapter. The author stays the author: nothing is rewritten
unless the author asks and approves.

Live: https://lairedigital.github.io/manuscrit-ai/

## What works today

- **Guidance built in:** a short welcome tour on first visit, small tips that can be dismissed, and a
  Help panel (the ? button) with a **system check** that tests storage, the mic, the screenshot reader and
  every AI key.
- **Capture:** dictate in the browser (Chrome, Edge, Safari), type, or add a screenshot and pull its text
  with on-device OCR. A pause of a few seconds, or saying "new note", starts a new idea.
- **Split preview:** long or multi-part captures open a preview. Edit, join or remove pieces and pick a
  place for each, then save. With an AI key, "Split smarter" splits by meaning and is checked to keep the
  author's exact words.
- **Plumi sorting:** every note gets a suggested book and chapter. The author confirms. Works on keywords
  with no AI, smarter with a key.
- **Shape chapters:** move notes up and down, tick several and merge them, and a **Read** tab shows a
  chapter or book as continuous prose with word counts.
- **Two modes:** Authentique keeps exact words. Assisté suggests edits the author approves, original kept.
- **Lumière research:** per book, summarize chapters, check continuity, find themes, find gaps, or ask a
  question. Answers come only from the author's notes.
- **Search, export** (Markdown for Scrivener, Word, PDF), **backup and restore**, with a weekly backup reminder.

## Free AI keys (optional)

Settings has a slot for each free provider and a picker for which one does each job:

| Provider | Default model | Good for |
| --- | --- | --- |
| Groq | `openai/gpt-oss-120b` | Sorting, splitting, Lumière research (fast) |
| Cerebras | `gpt-oss-120b` | Edit suggestions, backup for Groq |
| OpenRouter | `google/gemma-4-31b-it:free` | Any `:free` model, fallback |

If a job's provider has no key, the app uses the first provider that has one.
**Load keys from file** reads a JSON file saved by the app, `provider: key` lines, or a notes file that
contains keys. **Keys are never in this repo or on the site.** They are saved only in the browser that
loaded them and sent only to that provider. Keep the keys file private.

## Privacy

There is no server. Books and notes live in the browser's local storage on the device that wrote them.
Backups contain writing only, never keys.

## Run locally

```
python3 -m http.server 8080
# open http://localhost:8080
npm test   # sorting and search unit tests, Node 20+
```

No build step. Plain HTML, CSS and ES modules.

## Files

| Path | What it does |
| --- | --- |
| `index.html` | Page shell and dialogs |
| `css/styles.css` | Navy and gold editorial theme, phone layout |
| `js/app.js` | UI, views, events |
| `js/plumi.js` | Keyword sorting, search, light tidy (pure, tested) |
| `js/ai.js` | Free AI providers, key file import, sort, split, edit and research calls |
| `js/capture.js` | Dictation and OCR |
| `js/export.js` | Markdown, Word, PDF, backup |
| `js/store.js` | Local storage |

## Not in the MVP yet

Accounts and sync, native iOS app, the Écho character, citations and outside research, pricing tiers.
