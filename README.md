# Manuscrit.AI (MVP)

The second brain for authors. Capture ideas the way they arrive (voice, typing, screenshots) and let
Plumi file each one into the right book and chapter. The author stays the author: nothing is rewritten
unless the author asks and approves.

Live: https://lairedigital.github.io/manuscrit-ai/

## What works today

- **Capture:** dictate in the browser (Chrome, Edge, Safari), type, or drop a screenshot or photo and
  pull its text with OCR (Tesseract.js, runs on the device).
- **Plumi sorting:** every note gets a suggested book and chapter from the book and chapter keywords,
  explicit tags like `#booktitle`, and the notes already filed in each book. One click files it, or
  "File all" clears the Inbox.
- **Books and chapters:** create books, chapters and keywords. Capturing while a book or chapter is open
  files the note there directly.
- **Two modes:**
  - *Mode Authentique:* exact words only. No rewriting, ever.
  - *Mode Assisté:* ask Lumière for suggested edits. The author chooses. The original is always kept and
    can be restored.
- **Search** across every note, accent insensitive.
- **Export** a book as Markdown (imports into Scrivener), Word, or PDF (print). Full JSON backup and restore.
- **Optional Claude:** paste an Anthropic API key in Settings and Plumi sorts with Claude, adds topic
  tags, and Mode Assisté gives real edit suggestions. Without a key everything still works on keywords.

## Privacy

There is no server. Books and notes live in the browser's local storage on the device that wrote them.
The optional API key is stored on that device and sent only to `api.anthropic.com`. Use
**Settings > Download backup** to move work between devices.

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
| `js/ai.js` | Optional Claude sorting and edit suggestions |
| `js/capture.js` | Dictation and OCR |
| `js/export.js` | Markdown, Word, PDF, backup |
| `js/store.js` | Local storage |

## Not in the MVP yet

Accounts and sync, native iOS app, Écho character, Lumière research and citations, pricing tiers.
