import { load, save, loadSettings, saveSettings, loadKeys, saveKeys, importBackup, storageKb, uid } from "./store.js";
import { suggest, search, lightTidy, ruleSplit, wordCount } from "./plumi.js";
import { PROVIDERS, TASKS, DEFAULT_TASKS, RESEARCH, aiSort, aiSplit, aiAssist, aiResearch, testProvider, parseKeysFile } from "./ai.js";
import { speechSupported, startDictation, ocrImage } from "./capture.js";
import { exportMarkdown, exportWord, exportPdf, exportBackup, bookSections, sortKey, download } from "./export.js";

let state = load();
let settings = loadSettings(DEFAULT_TASKS);
let keys = loadKeys();
// Drop providers this app no longer supports (keys or job picks saved by an older version).
for (const id of Object.keys(keys)) if (!PROVIDERS[id]) delete keys[id];
for (const t of Object.keys(settings.tasks)) if (settings.tasks[t] && !PROVIDERS[settings.tasks[t]]) settings.tasks[t] = DEFAULT_TASKS[t];

// view: { kind: "inbox" | "all" | "book" | "search", bookId?, chapterId?, read?, lumiere? }
let view = { kind: "inbox" };
let query = "";
let draft = "";
let interim = "";
let stopDictation = null;
let draftSource = "text";
let splitPreview = null; // { source, pieces: [{ text, bookId, chapterId }] , busy }
let lumiere = { busy: false, answer: "", asked: "" };
const busy = new Set(); // fragment ids waiting on AI
const assists = new Map(); // fragment id -> { suggestion, notes }
const editing = new Set();
const selected = new Set(); // fragment ids ticked for merge

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DAY = 86400000;

function commit() {
  if (!save(state)) toast("Could not save. Browser storage may be full. Download a backup.");
  render();
}
const persistSettings = () => saveSettings(settings);

let toastTimer;
function toast(msg, ms = 3600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

const bookById = (id) => state.books.find((b) => b.id === id);
const chapterById = (book, id) => (book?.chapters || []).find((c) => c.id === id);

function placeLabel(bookId, chapterId) {
  const b = bookById(bookId);
  if (!b) return "Inbox";
  const c = chapterById(b, chapterId);
  return c ? `${b.title} / ${c.title}` : b.title;
}

/** Provider + key + model for a task, or null when that task runs without AI. */
function conn(task) {
  let provider = settings.tasks[task];
  if (!provider) return null;
  // Assigned provider has no key yet: use the first provider that does.
  if (!keys[provider]) provider = Object.keys(PROVIDERS).find((id) => keys[id]);
  if (!provider) return null;
  return { provider, key: keys[provider], model: settings.models[provider] || PROVIDERS[provider].model };
}
const providerName = (task) => PROVIDERS[conn(task)?.provider]?.name || "AI";

/* ---------- Sorting ---------- */

function keywordSuggestion(text, exceptId) {
  const filed = state.fragments.filter((f) => f.bookId && f.id !== exceptId);
  return { ...suggest(text, state.books, filed), by: "plumi" };
}

async function runPlumi(frag) {
  frag.suggestion = keywordSuggestion(frag.text, frag.id);
  const c = conn("sort");
  if (!c || !state.books.length) return;
  busy.add(frag.id);
  render();
  try {
    const s = await aiSort(c, frag.text, state.books);
    frag.suggestion = { ...s, score: s.bookId ? 1 : 0, by: "ai", via: PROVIDERS[c.provider].name };
    if (s.tags.length) frag.tags = Array.from(new Set([...(frag.tags || []), ...s.tags]));
  } catch (e) {
    toast(`${e.message} Used keywords instead.`);
  } finally {
    busy.delete(frag.id);
  }
}

function nextOrder(bookId, chapterId) {
  const same = state.fragments.filter((f) => f.bookId === bookId && (f.chapterId || null) === (chapterId || null));
  return same.length ? Math.max(...same.map(sortKey)) + 1 : Date.now();
}

function fileFragment(frag, bookId, chapterId) {
  frag.bookId = bookId || null;
  frag.chapterId = bookId ? chapterId || null : null;
  frag.suggestion = null;
  frag.order = frag.bookId ? nextOrder(frag.bookId, frag.chapterId) : undefined;
}

/* ---------- Capture ---------- */

function newFragment(text, source, place = {}) {
  const frag = {
    id: uid(),
    text,
    original: text,
    source,
    createdAt: Date.now(),
    bookId: null,
    chapterId: null,
    tags: [],
    suggestion: null,
  };
  if (place.bookId) fileFragment(frag, place.bookId, place.chapterId);
  state.fragments.push(frag);
  return frag;
}

function viewPlace() {
  return view.kind === "book" ? { bookId: view.bookId, chapterId: view.chapterId || null } : {};
}

async function saveDraft({ asOne = false } = {}) {
  const text = draft.trim();
  if (!text) return toast("Nothing to save yet. Type or dictate first.");
  const pieces = asOne ? [text] : ruleSplit(text);
  // Long or multi-part captures get a preview first, so the author decides how they split.
  if (!asOne && (pieces.length > 1 || (conn("split") && wordCount(text) > 120))) {
    openSplitPreview(text, pieces);
    return;
  }
  const frag = newFragment(text, draftSource, viewPlace());
  clearDraft();
  commit();
  if (!frag.bookId) {
    await runPlumi(frag);
    commit();
    toast(frag.suggestion?.bookId ? `Saved. Plumi suggests ${placeLabel(frag.suggestion.bookId, frag.suggestion.chapterId)}.` : "Saved to Inbox.");
  } else {
    toast(`Saved to ${placeLabel(frag.bookId, frag.chapterId)}.`);
  }
}

function clearDraft() {
  draft = "";
  interim = "";
  draftSource = "text";
}

function toggleMic() {
  if (stopDictation) {
    stopDictation();
    stopDictation = null;
    render();
    return;
  }
  if (!speechSupported()) return toast("Dictation needs Chrome, Edge or Safari. You can also use your keyboard's mic button.", 5000);
  const base = draft ? draft.trim() + "\n\n" : "";
  draftSource = "voice";
  stopDictation = startDictation({
    onText: (finalText, live) => {
      draft = base + finalText;
      interim = live;
      const ta = $("#draft");
      if (ta) ta.value = draft;
      const im = $("#interim");
      if (im) im.textContent = interim ? `Hearing: ${interim}` : "Listening...";
    },
    onEnd: () => {
      stopDictation = null;
      interim = "";
      render();
    },
    onError: (err) => {
      toast(err === "not-allowed" ? "Microphone is blocked. Allow it in the browser's site settings, then try again." : `Dictation error: ${err}`, 5000);
    },
  });
  render();
}

async function handleImage(file) {
  if (!file) return;
  toast("Reading text from the image...");
  try {
    const text = await ocrImage(file, (p) => {
      const im = $("#interim");
      if (im) im.textContent = `Reading image ${p}%`;
    });
    if (!text) return toast("No text found in that image.");
    draft = (draft ? draft.trim() + "\n\n" : "") + text;
    draftSource = "image";
    interim = "";
    render();
    toast("Text pulled from the image. Check it, then save.");
  } catch (e) {
    toast(e.message || "Could not read that image.");
  }
}

/* ---------- Split preview ---------- */

function openSplitPreview(text, pieces) {
  const place = viewPlace();
  splitPreview = {
    source: draftSource,
    whole: text,
    busy: false,
    pieces: pieces.map((t) => {
      const s = place.bookId ? place : keywordSuggestion(t);
      return { text: t, bookId: s.bookId || null, chapterId: s.chapterId || null };
    }),
  };
  render();
}

async function aiSplitPreview() {
  const c = conn("split");
  if (!c || !splitPreview) return;
  splitPreview.busy = true;
  render();
  try {
    splitPreview.pieces = await aiSplit(c, splitPreview.whole, state.books);
    toast(`${PROVIDERS[c.provider].name} split it into ${splitPreview.pieces.length} notes. Your words were kept.`);
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    if (splitPreview) splitPreview.busy = false;
    render();
  }
}

function saveSplit() {
  const sp = splitPreview;
  let filed = 0;
  for (const p of sp.pieces) {
    if (!p.text.trim()) continue;
    const f = newFragment(p.text.trim(), sp.source, {});
    if (p.bookId) {
      fileFragment(f, p.bookId, p.chapterId);
      filed++;
    } else {
      f.suggestion = keywordSuggestion(f.text, f.id);
    }
  }
  const n = sp.pieces.filter((p) => p.text.trim()).length;
  splitPreview = null;
  clearDraft();
  commit();
  toast(`Saved ${n} notes. ${filed} filed, ${n - filed} in the Inbox.`);
}

/* ---------- Mode Assiste ---------- */

async function polish(frag) {
  const c = conn("assist");
  if (!c) {
    assists.set(frag.id, { suggestion: lightTidy(frag.text), notes: "Spacing, capitals and ending tidied. Add a free AI key in Settings for real edit suggestions." });
    return render();
  }
  busy.add(frag.id);
  render();
  try {
    assists.set(frag.id, await aiAssist(c, frag.text));
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    busy.delete(frag.id);
    render();
  }
}

/* ---------- Reorder and merge ---------- */

function siblings(frag) {
  return state.fragments
    .filter((f) => f.bookId === frag.bookId && (f.chapterId || null) === (frag.chapterId || null))
    .sort((a, b) => sortKey(a) - sortKey(b));
}

function move(frag, dir) {
  const list = siblings(frag);
  const i = list.indexOf(frag);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  list.forEach((f, k) => (f.order = k));
  [list[i].order, list[j].order] = [list[j].order, list[i].order];
  commit();
}

function mergeSelected() {
  const items = state.fragments.filter((f) => selected.has(f.id));
  if (items.length < 2) return toast("Tick at least two notes to merge.");
  items.sort((a, b) => (a.bookId === b.bookId ? sortKey(a) - sortKey(b) : a.createdAt - b.createdAt));
  const first = items[0];
  first.text = items.map((f) => f.text).join("\n\n");
  first.original = items.map((f) => f.original || f.text).join("\n\n");
  first.tags = Array.from(new Set(items.flatMap((f) => f.tags || [])));
  first.mergedFrom = (first.mergedFrom || 1) + items.length - 1;
  const drop = new Set(items.slice(1).map((f) => f.id));
  state.fragments = state.fragments.filter((f) => !drop.has(f.id));
  selected.clear();
  commit();
  toast(`Merged ${items.length} notes into one.`);
}

/* ---------- Lumiere ---------- */

async function askLumiere(book, question) {
  const c = conn("research");
  if (!c) {
    toast("Lumière needs a free AI key. Open Settings to add one.", 5000);
    return;
  }
  const sections = bookSections(book, state.fragments).filter((s) => s.items.length);
  if (!sections.length) return toast("This book has no notes yet.");
  lumiere = { busy: true, answer: "", asked: question };
  render();
  try {
    lumiere.answer = await aiResearch(c, book, sections, question);
  } catch (e) {
    lumiere.answer = "";
    toast(e.message, 6000);
  } finally {
    lumiere.busy = false;
    render();
  }
}

/* ---------- Backup reminder ---------- */

function backupDue() {
  if (state.fragments.length < 3) return false;
  const now = Date.now();
  if (settings.backupSnooze && now < settings.backupSnooze) return false;
  return !settings.lastBackup || now - settings.lastBackup > 7 * DAY;
}

function doBackup() {
  exportBackup(state);
  settings.lastBackup = Date.now();
  persistSettings();
  render();
  toast("Backup downloaded. Keep it somewhere safe, like Google Drive.");
}

/* ---------- Tips ---------- */

const TIPS = {
  inbox: "Talk or type anything. Pause a few seconds, or say \"new note\", to split ideas. Plumi suggests where each note goes, you confirm.",
  book: "Give this book and its chapters a few keywords in Edit book. That is how Plumi learns where notes belong.",
  chapter: "Use Up and Down to order notes. Tick notes and press Merge to join them. Read shows the chapter as one flowing draft.",
  assiste: "Mode Assisté is on. Press Suggest edits on any note. You approve every change and the original is always kept.",
  ai: "Want smarter sorting and Lumière research? Add a free AI key in Settings. Everything works without one too.",
};

function tip(id) {
  if (settings.tips[id]) return "";
  return `<div class="tip"><span>${esc(TIPS[id])}</span><button class="tip-x" data-action="tip-ok" data-tip="${id}">Got it</button></div>`;
}

/* ---------- Rendering ---------- */

function counts() {
  const c = { inbox: 0, all: state.fragments.length, book: {}, chapter: {} };
  for (const f of state.fragments) {
    if (!f.bookId) c.inbox++;
    else {
      c.book[f.bookId] = (c.book[f.bookId] || 0) + 1;
      if (f.chapterId) c.chapter[f.chapterId] = (c.chapter[f.chapterId] || 0) + 1;
    }
  }
  return c;
}

function renderNav() {
  const c = counts();
  const on = (k, b, ch) =>
    view.kind === k && (b === undefined || view.bookId === b) && (ch === undefined || (view.chapterId || null) === ch) ? " on" : "";
  let html = `<input class="search" id="search" type="search" placeholder="Search everything" value="${esc(query)}" aria-label="Search">
    <h3>Capture</h3>
    <button class="nav-item${on("inbox")}" data-action="view" data-kind="inbox">Inbox <span class="count">${c.inbox}</span></button>
    <button class="nav-item${on("all")}" data-action="view" data-kind="all">All notes <span class="count">${c.all}</span></button>
    <h3>Books</h3>`;
  for (const b of state.books) {
    html += `<button class="nav-item book${on("book", b.id, null)}" data-action="view" data-kind="book" data-book="${b.id}">${esc(b.title)} <span class="count">${c.book[b.id] || 0}</span></button>`;
    for (const ch of b.chapters || []) {
      html += `<button class="nav-item chapter${on("book", b.id, ch.id)}" data-action="view" data-kind="book" data-book="${b.id}" data-chapter="${ch.id}">${esc(ch.title)} <span class="count">${c.chapter[ch.id] || 0}</span></button>`;
    }
  }
  const aiOn = Object.keys(TASKS).filter((t) => conn(t)).length;
  html += `<button class="ghost add-book" data-action="new-book">+ New book</button>
    <h3>Manuscrit</h3>
    <button class="nav-item" data-action="open-settings">Settings and AI keys <span class="count ${aiOn ? "ok" : ""}">${aiOn ? `AI ${aiOn}/4` : "No AI"}</span></button>
    <button class="nav-item" data-action="open-help">Help and system check</button>`;
  $("#nav").innerHTML = html;
}

function placeOptions(bookId, chapterId) {
  let opts = `<option value="|">Inbox</option>`;
  for (const b of state.books) {
    const sel = bookId === b.id && !chapterId ? " selected" : "";
    opts += `<option value="${b.id}|"${sel}>${esc(b.title)}</option>`;
    for (const ch of b.chapters || []) {
      const s2 = bookId === b.id && chapterId === ch.id ? " selected" : "";
      opts += `<option value="${b.id}|${ch.id}"${s2}>&nbsp;&nbsp;${esc(ch.title)}</option>`;
    }
  }
  return opts;
}

function fragCard(f, { reorder = false } = {}) {
  const date = new Date(f.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const isBusy = busy.has(f.id);
  let html = `<article class="frag${selected.has(f.id) ? " picked" : ""}" data-id="${f.id}">
    <label class="pick" title="Select to merge"><input type="checkbox" data-action="pick" data-id="${f.id}"${selected.has(f.id) ? " checked" : ""}><span class="sr">Select</span></label>`;
  if (editing.has(f.id)) {
    html += `<textarea class="frag-edit" data-edit="${f.id}" rows="4">${esc(f.text)}</textarea>
      <div class="frag-actions"><button data-action="save-edit" data-id="${f.id}">Save</button><button data-action="cancel-edit" data-id="${f.id}">Cancel</button></div>`;
  } else {
    html += `<p class="frag-text">${esc(f.text)}</p>`;
  }
  html += `<div class="frag-meta"><span class="badge">${esc(f.source)}</span><span>${date}</span><span>${wordCount(f.text)} words</span>`;
  if (view.kind !== "book" || !f.bookId) html += `<span>${esc(placeLabel(f.bookId, f.chapterId))}</span>`;
  for (const t of f.tags || []) html += `<span class="tag">${esc(t)}</span>`;
  if (f.mergedFrom) html += `<span>merged from ${f.mergedFrom}</span>`;
  if (f.original && f.original !== f.text) html += `<span title="${esc(f.original)}">edited, original kept</span>`;
  html += `</div>`;

  if (isBusy) html += `<div class="suggest"><span class="who">Plumi</span> is thinking...</div>`;
  else if (!f.bookId && f.suggestion) {
    const s = f.suggestion;
    if (s.bookId) {
      html += `<div class="suggest"><span class="who">Plumi suggests</span>
        <strong>${esc(placeLabel(s.bookId, s.chapterId))}</strong>
        <button class="gold" data-action="accept" data-id="${f.id}">File it</button>
        <span class="why">${esc(s.reason)}${s.by === "ai" ? ` (via ${esc(s.via || "AI")})` : " (keywords)"}</span></div>`;
    } else {
      html += `<div class="suggest"><span class="who">Plumi</span> is not sure yet. Pick a place below. <span class="why">${esc(s.reason)}</span></div>`;
    }
  }

  const a = assists.get(f.id);
  if (a) {
    html += `<div class="assist"><div class="small muted">Lumi&egrave;re suggests. Your original is kept either way.</div>
      <p>${esc(a.suggestion)}</p><div class="small muted">${esc(a.notes)}</div>
      <div class="frag-actions"><button data-action="assist-accept" data-id="${f.id}">Use this</button><button data-action="assist-dismiss" data-id="${f.id}">Keep mine</button></div></div>`;
  }

  html += `<div class="frag-actions"><select data-action="move" data-id="${f.id}" aria-label="Move to">${placeOptions(f.bookId, f.chapterId)}</select>`;
  if (reorder) html += `<button data-action="up" data-id="${f.id}" aria-label="Move up">Up</button><button data-action="down" data-id="${f.id}" aria-label="Move down">Down</button>`;
  if (!f.bookId) html += `<button data-action="resort" data-id="${f.id}"${isBusy ? " disabled" : ""}>Ask Plumi</button>`;
  if (state.mode === "assiste") html += `<button data-action="polish" data-id="${f.id}"${isBusy ? " disabled" : ""}>Suggest edits</button>`;
  html += `<button data-action="edit" data-id="${f.id}">Edit</button>`;
  if (f.original && f.original !== f.text) html += `<button data-action="restore" data-id="${f.id}">Restore original</button>`;
  html += `<button class="danger" data-action="delete" data-id="${f.id}">Delete</button></div></article>`;
  return html;
}

function captureCard() {
  const where = view.kind === "book" ? placeLabel(view.bookId, view.chapterId) : "the Inbox";
  const listening = Boolean(stopDictation);
  return `<section class="capture" aria-label="Capture">
    <textarea id="draft" placeholder="Speak or type a thought, a line, a scene...">${esc(draft)}</textarea>
    <div class="interim" id="interim">${listening ? (interim ? `Hearing: ${esc(interim)}` : "Listening... pause or say \"new note\" between ideas.") : ""}</div>
    <div class="capture-tools">
      <button class="mic${listening ? " on" : ""}" data-action="mic">${listening ? "Stop dictation" : "Dictate"}</button>
      <label class="button-like">Screenshot or photo <input type="file" accept="image/*" id="image-input" hidden></label>
      <span class="spacer"></span>
      <span class="small muted">Saves to ${esc(where)}</span>
      <button class="primary" data-action="save-draft">Save</button>
    </div>
  </section>`;
}

function splitCard() {
  const sp = splitPreview;
  const canAi = Boolean(conn("split"));
  let html = `<section class="split" aria-label="Split preview">
    <div class="view-head"><h2>Review ${sp.pieces.length} notes</h2><span class="spacer"></span>
      ${canAi ? `<button class="ghost" data-action="split-ai"${sp.busy ? " disabled" : ""}>${sp.busy ? "Splitting..." : `Split smarter with ${esc(providerName("split"))}`}</button>` : ""}
    </div>
    <p class="small muted">Split on your pauses and cue words. Edit, join or remove pieces, choose where each goes, then save.
      ${canAi ? "" : "Add a free AI key in Settings to split by meaning."}</p>`;
  sp.pieces.forEach((p, i) => {
    html += `<div class="piece"><textarea data-piece="${i}" rows="3">${esc(p.text)}</textarea>
      <div class="frag-actions"><select data-action="piece-place" data-piece="${i}" aria-label="Place">${placeOptions(p.bookId, p.chapterId)}</select>
      ${i < sp.pieces.length - 1 ? `<button data-action="piece-join" data-piece="${i}">Join with next</button>` : ""}
      <button class="danger" data-action="piece-remove" data-piece="${i}">Remove</button></div></div>`;
  });
  html += `<div class="frag-actions end"><button data-action="split-cancel">Back to editing</button>
    <button data-action="split-one">Save as one note</button>
    <button class="primary" data-action="split-save">Save ${sp.pieces.length} notes</button></div></section>`;
  return html;
}

function emptyState(title, body) {
  return `<div class="empty"><strong>${title}</strong>${body}</div>`;
}

function backupBanner() {
  if (!backupDue()) return "";
  const when = settings.lastBackup ? `Last backup ${new Date(settings.lastBackup).toLocaleDateString()}.` : "No backup yet.";
  return `<div class="banner">${when} Your writing lives only in this browser.
    <button class="gold" data-action="backup">Download backup</button><button class="ghost" data-action="backup-later">Later</button></div>`;
}

function mergeBar() {
  if (selected.size === 0) return "";
  return `<div class="mergebar">${selected.size} selected
    <button class="gold" data-action="merge"${selected.size < 2 ? " disabled" : ""}>Merge into one note</button>
    <button class="ghost" data-action="clear-picks">Clear</button></div>`;
}

function readingView(book, chapter) {
  const sections = bookSections(book, state.fragments).filter((s) => !chapter || s.title === chapter.title);
  const total = sections.reduce((n, s) => n + s.items.reduce((m, f) => m + wordCount(f.text), 0), 0);
  let html = `<p class="small muted">${total.toLocaleString()} words. Reading view shows your notes in order as one draft. Nothing here is changed.</p><article class="manuscript">`;
  for (const s of sections) {
    if (!s.items.length) continue;
    const w = s.items.reduce((m, f) => m + wordCount(f.text), 0);
    html += `<h2>${esc(s.title)} <small>${w.toLocaleString()} words</small></h2>`;
    for (const f of s.items) for (const para of f.text.split(/\n\s*\n/)) html += `<p>${esc(para)}</p>`;
  }
  if (!total) html += `<p class="muted">Nothing to read yet.</p>`;
  return html + `</article>`;
}

function lumiereView(book) {
  const ready = Boolean(conn("research"));
  let html = `<section class="lumiere"><p class="small muted">Lumi&egrave;re reads your notes for this book and answers about them.
    It does not write your book.${ready ? ` Using ${esc(providerName("research"))}.` : ""}</p>`;
  if (!ready) html += `<div class="tip"><span>Lumi&egrave;re needs a free AI key. Groq, Cerebras or OpenRouter all work.</span><button class="tip-x" data-action="open-settings">Open Settings</button></div>`;
  html += `<div class="row-buttons">`;
  for (const [id, r] of Object.entries(RESEARCH)) html += `<button data-action="lumiere" data-q="${id}"${lumiere.busy || !ready ? " disabled" : ""}>${r.label}</button>`;
  html += `</div><div class="ask-row"><input id="lumiere-q" placeholder="Ask about your book, e.g. Where do I mention the lake house?"${!ready ? " disabled" : ""}>
    <button class="primary" data-action="lumiere-ask"${lumiere.busy || !ready ? " disabled" : ""}>Ask</button></div>`;
  if (lumiere.busy) html += `<div class="answer muted">Lumi&egrave;re is reading your notes...</div>`;
  else if (lumiere.answer) {
    html += `<div class="answer"><div class="small muted">${esc(lumiere.asked)}</div>${lumiere.answer
      .split(/\n\s*\n/)
      .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
      .join("")}
      <div class="frag-actions"><button data-action="lumiere-save">Save as a research note</button><button data-action="lumiere-clear">Clear</button></div></div>`;
  }
  return html + `</section>`;
}

function renderMain() {
  let html = backupBanner();
  if (splitPreview) {
    $("#main").innerHTML = html + splitCard();
    return;
  }
  if (view.kind === "search") {
    const hits = search(query, state.fragments);
    html += `<div class="view-head"><h1>Search</h1><span class="muted">${hits.length} result${hits.length === 1 ? "" : "s"} for "${esc(query)}"</span></div>`;
    html += mergeBar() + (hits.length ? hits.map((f) => fragCard(f)).join("") : emptyState("Nothing found", "Try fewer words."));
  } else if (view.kind === "inbox") {
    const items = state.fragments.filter((f) => !f.bookId).sort((a, b) => b.createdAt - a.createdAt);
    const ready = items.filter((f) => f.suggestion?.bookId).length;
    html += `<div class="view-head"><h1>Inbox</h1><span class="spacer"></span>
      ${ready ? `<button class="gold" data-action="accept-all">${ready === 1 ? "File 1 suggestion" : `File all ${ready} suggestions`}</button>` : ""}</div>`;
    html += tip("inbox") + (state.mode === "assiste" ? tip("assiste") : "") + (!Object.keys(keys).length ? tip("ai") : "");
    html += captureCard() + mergeBar();
    html += items.length
      ? items.map((f) => fragCard(f)).join("")
      : emptyState("Your ideas land here", "Dictate, type or add a screenshot. Plumi suggests which book and chapter each one belongs to. You decide.");
  } else if (view.kind === "all") {
    const items = [...state.fragments].sort((a, b) => b.createdAt - a.createdAt);
    html += `<div class="view-head"><h1>All notes</h1><span class="muted">${items.reduce((n, f) => n + wordCount(f.text), 0).toLocaleString()} words</span></div>`;
    html += captureCard() + mergeBar();
    html += items.length ? items.map((f) => fragCard(f)).join("") : emptyState("No notes yet", "Start with a single sentence.");
  } else if (view.kind === "book") {
    const book = bookById(view.bookId);
    if (!book) {
      view = { kind: "inbox" };
      return renderMain();
    }
    const ch = chapterById(book, view.chapterId);
    const tab = view.read ? "read" : view.lumiere ? "lumiere" : "notes";
    html += `<div class="view-head"><h1>${esc(ch ? ch.title : book.title)}</h1>
      ${ch ? `<span class="muted">${esc(book.title)}</span>` : ""}<span class="spacer"></span>
      <button class="ghost" data-action="edit-book" data-book="${book.id}">Edit book</button>
      <details class="menu"><summary class="button-like">Export</summary><div>
        <button data-action="export" data-format="md" data-book="${book.id}">Markdown (Scrivener)</button>
        <button data-action="export" data-format="doc" data-book="${book.id}">Word</button>
        <button data-action="export" data-format="pdf" data-book="${book.id}">PDF</button></div></details></div>
      <div class="tabs" role="tablist">
        <button role="tab" class="${tab === "notes" ? "on" : ""}" data-action="tab" data-tab="notes">Notes</button>
        <button role="tab" class="${tab === "read" ? "on" : ""}" data-action="tab" data-tab="read">Read</button>
        ${ch ? "" : `<button role="tab" class="${tab === "lumiere" ? "on" : ""}" data-action="tab" data-tab="lumiere">Lumi&egrave;re</button>`}
      </div>`;
    if (tab === "read") html += readingView(book, ch);
    else if (tab === "lumiere") html += lumiereView(book);
    else {
      html += ch ? tip("chapter") : tip("book");
      if (book.keywords?.length && !ch) html += `<p class="small muted">Keywords: ${esc(book.keywords.join(", "))}</p>`;
      html += captureCard() + mergeBar();
      if (ch) {
        const items = state.fragments.filter((f) => f.bookId === book.id && f.chapterId === ch.id).sort((a, b) => sortKey(a) - sortKey(b));
        html += items.length ? items.map((f) => fragCard(f, { reorder: true })).join("") : emptyState("Empty chapter", "Capture here, or file notes from the Inbox.");
      } else {
        const sections = bookSections(book, state.fragments);
        const total = sections.reduce((n, s) => n + s.items.length, 0);
        if (!total) html += emptyState("A blank page", "Capture here, or file notes from the Inbox.");
        for (const s of sections) {
          if (!s.items.length) continue;
          html += `<h2 class="chapter-title">${esc(s.title)}</h2>` + s.items.map((f) => fragCard(f, { reorder: true })).join("");
        }
      }
    }
  }
  $("#main").innerHTML = html;
}

function render() {
  document.querySelectorAll(".mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.mode));
  const focusedSearch = document.activeElement?.id === "search";
  const caret = focusedSearch ? document.activeElement.selectionStart : null;
  renderNav();
  renderMain();
  if (focusedSearch) {
    const s = $("#search");
    s.focus();
    s.setSelectionRange(caret, caret);
  }
}

/* ---------- Book editor ---------- */

let editingBookId = null;

function openBookDialog(bookId) {
  editingBookId = bookId;
  const book = bookById(bookId);
  const f = $("#book-form");
  $("#book-dialog-title").textContent = book ? "Edit book" : "New book";
  $("#delete-book-btn").hidden = !book;
  f.title.value = book?.title || "";
  f.keywords.value = (book?.keywords || []).join(", ");
  f.chapters.value = (book?.chapters || []).map((c) => (c.keywords?.length ? `${c.title}: ${c.keywords.join(", ")}` : c.title)).join("\n");
  $("#book-dialog").showModal();
}

const splitList = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

$("#book-dialog").addEventListener("close", () => {
  if ($("#book-dialog").returnValue !== "save") return;
  const f = $("#book-form");
  const title = f.title.value.trim();
  if (!title) return;
  const existing = bookById(editingBookId);
  const oldChapters = existing?.chapters || [];
  const chapters = f.chapters.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(":");
      const ctitle = (i >= 0 ? line.slice(0, i) : line).trim();
      const kws = i >= 0 ? splitList(line.slice(i + 1)) : [];
      // Keep ids for chapters whose titles did not change, so filed notes stay put.
      const prev = oldChapters.find((c) => c.title.toLowerCase() === ctitle.toLowerCase());
      return { id: prev?.id || uid(), title: ctitle, keywords: kws };
    });
  if (existing) {
    existing.title = title;
    existing.keywords = splitList(f.keywords.value);
    const keep = new Set(chapters.map((c) => c.id));
    for (const fr of state.fragments) if (fr.bookId === existing.id && fr.chapterId && !keep.has(fr.chapterId)) fr.chapterId = null;
    existing.chapters = chapters;
  } else {
    const book = { id: uid(), title, keywords: splitList(f.keywords.value), chapters };
    state.books.push(book);
    view = { kind: "book", bookId: book.id };
  }
  for (const fr of state.fragments) if (!fr.bookId && fr.suggestion?.by !== "ai") fr.suggestion = keywordSuggestion(fr.text, fr.id);
  commit();
});

/* ---------- Settings ---------- */

function renderSettings() {
  let rows = "";
  for (const [id, p] of Object.entries(PROVIDERS)) {
    rows += `<div class="provider" data-provider="${id}">
      <div class="provider-head"><strong>${p.name}</strong>
        <a href="${p.signup}" target="_blank" rel="noopener">Get a free key</a>
        <span class="status" id="status-${id}">${keys[id] ? "Saved" : "No key"}</span></div>
      <p class="muted small">${p.note}</p>
      <div class="provider-fields">
        <input type="password" autocomplete="off" name="key-${id}" placeholder="Paste ${p.name} key" value="${esc(keys[id] || "")}" aria-label="${p.name} key">
        <input name="model-${id}" value="${esc(settings.models[id] || "")}" placeholder="${esc(p.model)}" aria-label="${p.name} model">
        <button type="button" data-action="test-provider" data-provider="${id}">Test</button>
      </div></div>`;
  }
  $("#provider-rows").innerHTML = rows;

  let tasks = "";
  for (const [id, t] of Object.entries(TASKS)) {
    let opts = `<option value="">${id === "research" || id === "assist" ? "Off" : "No AI (keywords and pauses)"}</option>`;
    for (const [pid, p] of Object.entries(PROVIDERS)) opts += `<option value="${pid}"${settings.tasks[id] === pid ? " selected" : ""}>${p.name}${keys[pid] ? "" : " (no key yet)"}</option>`;
    tasks += `<label>${t.name}<small>${t.help}</small><select name="task-${id}">${opts}</select></label>`;
  }
  $("#task-rows").innerHTML = tasks;
  $("#backup-status").textContent = `${state.fragments.length} notes in ${state.books.length} books, about ${storageKb()} KB. ${
    settings.lastBackup ? `Last backup ${new Date(settings.lastBackup).toLocaleString()}.` : "Never backed up."
  }`;
}

function readSettingsForm() {
  const f = $("#settings-form");
  const nextKeys = {};
  for (const id of Object.keys(PROVIDERS)) {
    const k = f[`key-${id}`].value.trim();
    if (k) nextKeys[id] = k;
    const m = f[`model-${id}`].value.trim();
    if (m) settings.models[id] = m;
    else delete settings.models[id];
  }
  for (const id of Object.keys(TASKS)) settings.tasks[id] = f[`task-${id}`].value;
  keys = nextKeys;
}

$("#settings-dialog").addEventListener("close", () => {
  if ($("#settings-dialog").returnValue !== "save") return;
  readSettingsForm();
  saveKeys(keys);
  persistSettings();
  const on = Object.keys(TASKS).filter((t) => conn(t)).length;
  toast(on ? `Saved. AI is on for ${on} of 4 jobs.` : "Saved. Running without AI.");
  render();
});

async function testOne(id) {
  const f = $("#settings-form");
  const key = f[`key-${id}`].value.trim();
  const model = f[`model-${id}`].value.trim() || PROVIDERS[id].model;
  const el = $(`#status-${id}`);
  if (!key) {
    el.textContent = "No key";
    el.className = "status";
    return false;
  }
  el.textContent = "Testing...";
  el.className = "status";
  try {
    const r = await testProvider(id, key, model);
    el.textContent = `Working (${(r.ms / 1000).toFixed(1)}s)`;
    el.className = "status ok";
    return true;
  } catch (e) {
    el.textContent = e.message.replace(/^[^:]+:\s*/, "");
    el.className = "status bad";
    return false;
  }
}

$("#keys-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const found = parseKeysFile(await file.text());
  const ids = Object.keys(found);
  if (!ids.length) return toast("No AI keys found in that file.");
  const f = $("#settings-form");
  for (const id of ids) f[`key-${id}`].value = found[id];
  toast(`Loaded ${ids.length} key${ids.length === 1 ? "" : "s"}: ${ids.map((i) => PROVIDERS[i].name).join(", ")}. Testing now, then press Save.`, 6000);
  for (const id of ids) testOne(id);
});

$("#restore-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    state = importBackup(await file.text());
    view = { kind: "inbox" };
    commit();
    $("#settings-dialog").close();
    toast("Backup restored.");
  } catch (err) {
    toast(err.message);
  }
  e.target.value = "";
});

/* ---------- System check ---------- */

async function runCheck() {
  const out = $("#check-results");
  const rows = [];
  const show = () => (out.innerHTML = rows.map((r) => `<li class="${r.s}"><strong>${esc(r.name)}</strong> ${esc(r.msg)}</li>`).join(""));
  const add = (name, s, msg) => {
    rows.push({ name, s, msg });
    show();
    return rows.length - 1;
  };
  const set = (i, s, msg) => {
    rows[i].s = s;
    rows[i].msg = msg;
    show();
  };

  try {
    localStorage.setItem("manuscrit.check", "1");
    localStorage.removeItem("manuscrit.check");
    add("Saving", "ok", `Works. Using about ${storageKb()} KB.`);
  } catch {
    add("Saving", "bad", "This browser is blocking storage. Private browsing can cause this.");
  }

  if (!speechSupported()) add("Dictation", "warn", "Not supported in this browser. Use Chrome, Edge or Safari, or your keyboard's mic.");
  else {
    let perm = "unknown";
    try {
      perm = (await navigator.permissions.query({ name: "microphone" })).state;
    } catch {
      /* Safari */
    }
    if (perm === "denied") add("Dictation", "bad", "Microphone is blocked for this site. Allow it in site settings.");
    else add("Dictation", "ok", perm === "granted" ? "Supported, microphone allowed." : "Supported. The browser will ask for the mic the first time.");
  }

  const ocr = add("Screenshot reader", "", "Checking...");
  try {
    const r = await fetch("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js", { method: "HEAD" });
    set(ocr, r.ok ? "ok" : "warn", r.ok ? "Reachable." : "Could not reach the reader. Check the connection.");
  } catch {
    set(ocr, "warn", "Could not reach the reader. Check the connection.");
  }

  const used = new Set(Object.values(settings.tasks).filter(Boolean));
  if (!Object.keys(keys).length) add("AI", "warn", "No keys saved. Everything works on keywords. Add free keys in Settings for more.");
  for (const id of Object.keys(keys)) {
    const i = add(PROVIDERS[id].name, "", "Testing key...");
    try {
      const r = await testProvider(id, keys[id], settings.models[id] || PROVIDERS[id].model);
      set(i, "ok", `Working (${(r.ms / 1000).toFixed(1)}s).${used.has(id) ? "" : " Not assigned to a job yet."}`);
    } catch (e) {
      set(i, "bad", e.message.replace(/^[^:]+:\s*/, ""));
    }
  }
  for (const [task, pid] of Object.entries(settings.tasks)) {
    if (pid && !keys[pid]) add(TASKS[task].name, "warn", `Set to ${PROVIDERS[pid].name} but there is no key. ${conn(task) ? `Using ${PROVIDERS[conn(task).provider].name} instead.` : "It will run without AI."}`);
  }
  add("Backup", backupDue() ? "warn" : "ok", settings.lastBackup ? `Last backup ${new Date(settings.lastBackup).toLocaleDateString()}.` : "Never backed up.");
}

/* ---------- Welcome tour ---------- */

const TOUR = [
  ["Welcome to Manuscrit", "A second brain for your books. Capture ideas the moment they come, and Plumi keeps them in the right place. You stay the author."],
  ["Capture any way", "Tap Dictate and just talk. Pause a few seconds or say \"new note\" between ideas and they become separate notes. You can type, or add a screenshot too."],
  ["Plumi files it, you decide", "Each new note gets a suggested book and chapter. Tap File it to accept. Teach Plumi with a few keywords on each book and chapter."],
  ["Your words, protected", "Authentique keeps your exact words. Assisté offers edits you approve. Lumière can summarize and check continuity across a book."],
  ["Keep a backup", "Your writing lives in this browser. Download a backup each week from Settings. The ? button has help and a system check."],
];
let tourStep = 0;

function showTour(step = 0) {
  tourStep = step;
  const [title, body] = TOUR[step];
  $("#tour-body").innerHTML = `<h2>${esc(title)}</h2><p>${esc(body)}</p>`;
  $("#tour-dots").innerHTML = TOUR.map((_, i) => `<span class="${i === step ? "on" : ""}"></span>`).join("");
  $("#tour-back").hidden = step === 0;
  $("#tour-next").textContent = step === TOUR.length - 1 ? "Start writing" : "Next";
  if (!$("#tour-dialog").open) $("#tour-dialog").showModal();
}

function endTour() {
  $("#tour-dialog").close();
  settings.toured = true;
  persistSettings();
}

/* ---------- Events ---------- */

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT" || (el.tagName === "INPUT" && el.type !== "checkbox")) return;
  const id = el.dataset.id;
  const frag = id ? state.fragments.find((f) => f.id === id) : null;
  const book = bookById(view.bookId);

  switch (el.dataset.action) {
    case "toggle-nav":
      $("#nav").classList.toggle("open");
      break;
    case "mode":
      state.mode = el.dataset.mode;
      assists.clear();
      commit();
      toast(state.mode === "authentique" ? "Mode Authentique: your exact words, never rewritten." : "Mode Assisté: press Suggest edits on a note. You approve every change.");
      break;
    case "view":
      view = { kind: el.dataset.kind, bookId: el.dataset.book, chapterId: el.dataset.chapter || null };
      query = "";
      selected.clear();
      lumiere = { busy: false, answer: "", asked: "" };
      $("#nav").classList.remove("open");
      render();
      break;
    case "tab":
      view = { ...view, read: el.dataset.tab === "read", lumiere: el.dataset.tab === "lumiere" };
      render();
      break;
    case "new-book":
      openBookDialog(null);
      break;
    case "edit-book":
      openBookDialog(el.dataset.book);
      break;
    case "delete-book": {
      const b = bookById(editingBookId);
      if (b && confirm(`Delete "${b.title}"? Its notes go back to the Inbox.`)) {
        for (const f of state.fragments) if (f.bookId === b.id) fileFragment(f, null, null);
        state.books = state.books.filter((x) => x.id !== b.id);
        view = { kind: "inbox" };
        $("#book-dialog").close();
        commit();
      }
      break;
    }
    case "open-settings":
      $("#nav").classList.remove("open");
      renderSettings();
      $("#settings-dialog").showModal();
      break;
    case "open-help":
      $("#nav").classList.remove("open");
      $("#check-results").innerHTML = "";
      $("#help-dialog").showModal();
      break;
    case "run-check":
      el.disabled = true;
      await runCheck();
      el.disabled = false;
      break;
    case "replay-tour":
      $("#help-dialog").close();
      showTour(0);
      break;
    case "tour-next":
      if (tourStep < TOUR.length - 1) showTour(tourStep + 1);
      else endTour();
      break;
    case "tour-back":
      showTour(Math.max(0, tourStep - 1));
      break;
    case "tour-skip":
      endTour();
      break;
    case "tip-ok":
      settings.tips[el.dataset.tip] = true;
      persistSettings();
      render();
      break;
    case "test-provider":
      testOne(el.dataset.provider);
      break;
    case "test-all":
      for (const pid of Object.keys(PROVIDERS)) testOne(pid);
      break;
    case "download-keys": {
      readSettingsForm();
      if (!Object.keys(keys).length) return toast("No keys to save yet.");
      download("manuscrit-keys.json", JSON.stringify({ keys }, null, 2), "application/json");
      toast("Keys file saved. Keep it private. Do not share or upload it.", 5000);
      break;
    }
    case "backup":
      doBackup();
      break;
    case "backup-later":
      settings.backupSnooze = Date.now() + DAY;
      persistSettings();
      render();
      break;
    case "reset":
      if (confirm("Erase every book and note in this browser? Download a backup first if unsure.")) {
        localStorage.removeItem("manuscrit.v1");
        state = load();
        view = { kind: "inbox" };
        $("#settings-dialog").close();
        commit();
      }
      break;
    case "mic":
      toggleMic();
      break;
    case "save-draft":
      if (stopDictation) {
        stopDictation();
        stopDictation = null;
      }
      await saveDraft();
      break;
    case "split-ai":
      await aiSplitPreview();
      break;
    case "split-save":
      saveSplit();
      break;
    case "split-one":
      splitPreview = null;
      await saveDraft({ asOne: true });
      break;
    case "split-cancel":
      splitPreview = null;
      render();
      break;
    case "piece-join": {
      const i = Number(el.dataset.piece);
      const p = splitPreview.pieces;
      p[i].text = `${p[i].text} ${p[i + 1].text}`;
      p.splice(i + 1, 1);
      render();
      break;
    }
    case "piece-remove":
      splitPreview.pieces.splice(Number(el.dataset.piece), 1);
      if (!splitPreview.pieces.length) splitPreview = null;
      render();
      break;
    case "accept":
      if (frag?.suggestion) {
        fileFragment(frag, frag.suggestion.bookId, frag.suggestion.chapterId);
        commit();
        toast(`Filed in ${placeLabel(frag.bookId, frag.chapterId)}.`);
      }
      break;
    case "accept-all": {
      let n = 0;
      for (const f of state.fragments) {
        if (!f.bookId && f.suggestion?.bookId) {
          fileFragment(f, f.suggestion.bookId, f.suggestion.chapterId);
          n++;
        }
      }
      commit();
      toast(`Filed ${n} note${n === 1 ? "" : "s"}.`);
      break;
    }
    case "resort":
      if (frag) {
        await runPlumi(frag);
        commit();
      }
      break;
    case "polish":
      if (frag) await polish(frag);
      break;
    case "assist-accept": {
      const a = assists.get(id);
      if (frag && a) {
        frag.original = frag.original || frag.text;
        frag.text = a.suggestion;
        assists.delete(id);
        commit();
      }
      break;
    }
    case "assist-dismiss":
      assists.delete(id);
      render();
      break;
    case "up":
    case "down":
      if (frag) move(frag, el.dataset.action === "up" ? -1 : 1);
      break;
    case "pick":
      if (el.checked) selected.add(id);
      else selected.delete(id);
      render();
      break;
    case "merge":
      mergeSelected();
      break;
    case "clear-picks":
      selected.clear();
      render();
      break;
    case "edit":
      editing.add(id);
      render();
      break;
    case "cancel-edit":
      editing.delete(id);
      render();
      break;
    case "save-edit": {
      const ta = document.querySelector(`[data-edit="${id}"]`);
      if (frag && ta) {
        frag.original = frag.original || frag.text;
        frag.text = ta.value.trim() || frag.text;
        editing.delete(id);
        commit();
      }
      break;
    }
    case "restore":
      if (frag?.original) {
        frag.text = frag.original;
        commit();
      }
      break;
    case "delete":
      if (frag && confirm("Delete this note?")) {
        state.fragments = state.fragments.filter((f) => f.id !== id);
        selected.delete(id);
        commit();
      }
      break;
    case "lumiere":
      if (book) await askLumiere(book, RESEARCH[el.dataset.q].ask);
      break;
    case "lumiere-ask": {
      const q = $("#lumiere-q").value.trim();
      if (!q) return toast("Type a question first.");
      if (book) await askLumiere(book, q);
      break;
    }
    case "lumiere-save":
      if (book && lumiere.answer) {
        const f = newFragment(lumiere.answer.trim(), "lumiere", { bookId: book.id });
        f.tags = ["research"];
        commit();
        toast("Saved to this book as a research note.");
      }
      break;
    case "lumiere-clear":
      lumiere = { busy: false, answer: "", asked: "" };
      render();
      break;
    case "export": {
      const b = bookById(el.dataset.book);
      const fmt = el.dataset.format;
      el.closest("details")?.removeAttribute("open");
      try {
        if (fmt === "md") exportMarkdown(b, state.fragments);
        else if (fmt === "doc") exportWord(b, state.fragments);
        else exportPdf(b, state.fragments);
      } catch (err) {
        toast(err.message);
      }
      break;
    }
  }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.action === "move") {
    const frag = state.fragments.find((f) => f.id === el.dataset.id);
    const [bookId, chapterId] = el.value.split("|");
    if (frag) {
      fileFragment(frag, bookId || null, chapterId || null);
      if (!frag.bookId) frag.suggestion = keywordSuggestion(frag.text, frag.id);
      commit();
      toast(`Moved to ${placeLabel(frag.bookId, frag.chapterId)}.`);
    }
  } else if (el.dataset.action === "piece-place") {
    const [bookId, chapterId] = el.value.split("|");
    const p = splitPreview.pieces[Number(el.dataset.piece)];
    p.bookId = bookId || null;
    p.chapterId = chapterId || null;
  } else if (el.id === "image-input") {
    handleImage(el.files[0]);
    el.value = "";
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "draft") {
    draft = el.value;
    if (!stopDictation && draftSource === "voice" && !draft) draftSource = "text";
  } else if (el.dataset.piece !== undefined && el.tagName === "TEXTAREA") {
    splitPreview.pieces[Number(el.dataset.piece)].text = el.value;
  } else if (el.id === "search") {
    query = el.value;
    if (query.trim()) view = { kind: "search" };
    else if (view.kind === "search") view = { kind: "inbox" };
    render();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.target.id === "draft" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    saveDraft();
  } else if (e.target.id === "lumiere-q" && e.key === "Enter") {
    e.preventDefault();
    $("[data-action=lumiere-ask]")?.click();
  }
});

render();
if (!settings.toured) showTour(0);
