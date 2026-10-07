import { load, save, loadSettings, saveSettings, importBackup, uid } from "./store.js";
import { suggest, search, lightTidy } from "./plumi.js";
import { sortWithClaude, assistWithClaude } from "./ai.js";
import { speechSupported, startDictation, ocrImage } from "./capture.js";
import { exportMarkdown, exportWord, exportPdf, exportBackup, bookSections } from "./export.js";

let state = load();
let settings = loadSettings();
// view: { kind: "inbox" | "all" | "book" | "search", bookId?, chapterId? }
let view = { kind: "inbox" };
let query = "";
let draft = "";
let interim = "";
let stopDictation = null;
let draftSource = "text";
const busy = new Set(); // fragment ids waiting on Claude
const assists = new Map(); // fragment id -> { suggestion, notes }
const editing = new Set(); // fragment ids in edit mode

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function commit() {
  if (!save(state)) toast("Could not save. Browser storage may be full. Download a backup.");
  render();
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

const bookById = (id) => state.books.find((b) => b.id === id);
const chapterById = (book, id) => (book?.chapters || []).find((c) => c.id === id);
const hasKey = () => Boolean(settings.apiKey);

function placeLabel(bookId, chapterId) {
  const b = bookById(bookId);
  if (!b) return "Inbox";
  const c = chapterById(b, chapterId);
  return c ? `${b.title} / ${c.title}` : b.title;
}

/* ---------- Sorting ---------- */

async function runPlumi(frag) {
  const filed = state.fragments.filter((f) => f.bookId && f.id !== frag.id);
  frag.suggestion = { ...suggest(frag.text, state.books, filed), by: "plumi" };
  if (!hasKey()) return;
  busy.add(frag.id);
  render();
  try {
    const s = await sortWithClaude({ apiKey: settings.apiKey, model: settings.model, text: frag.text, books: state.books });
    frag.suggestion = { ...s, score: s.bookId ? 1 : 0 };
    if (s.tags.length) frag.tags = Array.from(new Set([...(frag.tags || []), ...s.tags]));
  } catch (e) {
    toast(`Claude sorting failed, used keywords instead. ${e.message || ""}`.trim());
  } finally {
    busy.delete(frag.id);
  }
}

function fileFragment(frag, bookId, chapterId) {
  frag.bookId = bookId || null;
  frag.chapterId = bookId ? chapterId || null : null;
  frag.suggestion = null;
}

/* ---------- Capture ---------- */

async function saveDraft() {
  const text = draft.trim();
  if (!text) return toast("Nothing to save yet.");
  const frag = {
    id: uid(),
    text,
    original: text,
    source: draftSource,
    createdAt: Date.now(),
    bookId: null,
    chapterId: null,
    tags: [],
    suggestion: null,
  };
  // Capturing while a book or chapter is open files it there directly.
  if (view.kind === "book") {
    frag.bookId = view.bookId;
    frag.chapterId = view.chapterId || null;
  }
  state.fragments.push(frag);
  draft = "";
  interim = "";
  draftSource = "text";
  commit();
  if (!frag.bookId) {
    await runPlumi(frag);
    commit();
    toast(frag.suggestion?.bookId ? `Plumi suggests ${placeLabel(frag.suggestion.bookId, frag.suggestion.chapterId)}.` : "Saved to Inbox.");
  } else {
    toast(`Saved to ${placeLabel(frag.bookId, frag.chapterId)}.`);
  }
}

function toggleMic() {
  if (stopDictation) {
    stopDictation();
    stopDictation = null;
    render();
    return;
  }
  if (!speechSupported()) return toast("Dictation needs Chrome, Edge or Safari. You can also use your keyboard's mic.");
  const base = draft ? draft.trim() + " " : "";
  draftSource = "voice";
  stopDictation = startDictation({
    onText: (finalText, live) => {
      draft = base + finalText;
      interim = live;
      const ta = $("#draft");
      if (ta) ta.value = draft;
      const im = $("#interim");
      if (im) im.textContent = interim;
    },
    onEnd: () => {
      stopDictation = null;
      interim = "";
      render();
    },
    onError: (err) => {
      toast(err === "not-allowed" ? "Microphone permission was blocked." : `Dictation error: ${err}`);
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
    toast("Text pulled from the image. Review it, then save.");
  } catch (e) {
    toast(e.message || "Could not read that image.");
  }
}

/* ---------- Mode Assisté ---------- */

async function polish(frag) {
  if (!hasKey()) {
    assists.set(frag.id, { suggestion: lightTidy(frag.text), notes: "Spacing, capitals and ending tidied. Add a Claude key in Settings for full suggestions." });
    return render();
  }
  busy.add(frag.id);
  render();
  try {
    assists.set(frag.id, await assistWithClaude({ apiKey: settings.apiKey, model: settings.model, text: frag.text }));
  } catch (e) {
    toast(`Suggestion failed. ${e.message || ""}`.trim());
  } finally {
    busy.delete(frag.id);
    render();
  }
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
  html += `<button class="ghost add-book" data-action="new-book">+ New book</button>
    <h3>Manuscrit</h3>
    <button class="nav-item" data-action="open-settings">Settings and backup</button>`;
  $("#nav").innerHTML = html;
}

function placeSelect(frag) {
  let opts = `<option value="">Inbox</option>`;
  for (const b of state.books) {
    const sel = frag.bookId === b.id && !frag.chapterId ? " selected" : "";
    opts += `<option value="${b.id}|"${sel}>${esc(b.title)}</option>`;
    for (const ch of b.chapters || []) {
      const s2 = frag.bookId === b.id && frag.chapterId === ch.id ? " selected" : "";
      opts += `<option value="${b.id}|${ch.id}"${s2}>&nbsp;&nbsp;${esc(ch.title)}</option>`;
    }
  }
  return `<select data-action="move" data-id="${frag.id}" aria-label="Move to">${opts}</select>`;
}

function fragCard(f) {
  const date = new Date(f.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const isBusy = busy.has(f.id);
  let html = `<article class="frag" data-id="${f.id}">`;
  if (editing.has(f.id)) {
    html += `<textarea class="frag-edit" data-edit="${f.id}" rows="4" style="width:100%;font:500 19px/1.5 var(--serif);border:1px solid var(--line);border-radius:8px;padding:8px">${esc(f.text)}</textarea>
      <div class="frag-actions"><button data-action="save-edit" data-id="${f.id}">Save</button><button data-action="cancel-edit" data-id="${f.id}">Cancel</button></div>`;
  } else {
    html += `<p class="frag-text">${esc(f.text)}</p>`;
  }
  html += `<div class="frag-meta"><span class="badge">${esc(f.source)}</span><span>${date}</span>`;
  if (view.kind !== "book" || !f.bookId) html += `<span>${esc(placeLabel(f.bookId, f.chapterId))}</span>`;
  for (const t of f.tags || []) html += `<span class="tag">${esc(t)}</span>`;
  if (f.original && f.original !== f.text) html += `<span title="${esc(f.original)}">edited, original kept</span>`;
  html += `</div>`;

  if (isBusy) html += `<div class="suggest"><span class="who">Plumi</span> is thinking...</div>`;
  else if (!f.bookId && f.suggestion) {
    const s = f.suggestion;
    if (s.bookId) {
      html += `<div class="suggest"><span class="who">${s.by === "claude" ? "Plumi (Claude)" : "Plumi"} suggests</span>
        <strong>${esc(placeLabel(s.bookId, s.chapterId))}</strong>
        <button class="gold" data-action="accept" data-id="${f.id}">File it</button>
        <span class="why">${esc(s.reason)}</span></div>`;
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

  html += `<div class="frag-actions">${placeSelect(f)}`;
  if (!f.bookId) html += `<button data-action="resort" data-id="${f.id}"${isBusy ? " disabled" : ""}>Ask Plumi</button>`;
  if (state.mode === "assiste") html += `<button data-action="polish" data-id="${f.id}"${isBusy ? " disabled" : ""}>Suggest edits</button>`;
  html += `<button data-action="edit" data-id="${f.id}">Edit</button>`;
  if (f.original && f.original !== f.text) html += `<button data-action="restore" data-id="${f.id}">Restore original</button>`;
  html += `<button class="danger" data-action="delete" data-id="${f.id}">Delete</button></div></article>`;
  return html;
}

function captureCard() {
  const where = view.kind === "book" ? placeLabel(view.bookId, view.chapterId) : "Inbox (Plumi will suggest a place)";
  return `<section class="capture" aria-label="Capture">
    <textarea id="draft" placeholder="Speak or type a thought, a line, a scene...">${esc(draft)}</textarea>
    <div class="interim" id="interim">${esc(interim)}</div>
    <div class="capture-tools">
      <button class="mic${stopDictation ? " on" : ""}" data-action="mic">${stopDictation ? "Stop dictation" : "Dictate"}</button>
      <label class="button-like">Screenshot or photo <input type="file" accept="image/*" id="image-input" hidden></label>
      <span class="spacer"></span>
      <span class="small muted">Saves to ${esc(where)}</span>
      <button class="primary" data-action="save-draft">Save</button>
    </div>
  </section>`;
}

function emptyState(title, body) {
  return `<div class="empty"><strong>${title}</strong>${body}</div>`;
}

function renderMain() {
  let html = "";
  if (view.kind === "search") {
    const hits = search(query, state.fragments);
    html += `<div class="view-head"><h1>Search</h1><span class="muted">${hits.length} result${hits.length === 1 ? "" : "s"} for "${esc(query)}"</span></div>`;
    html += hits.length ? hits.map(fragCard).join("") : emptyState("Nothing found", "Try fewer words.");
  } else if (view.kind === "inbox") {
    const items = state.fragments.filter((f) => !f.bookId).sort((a, b) => b.createdAt - a.createdAt);
    const ready = items.filter((f) => f.suggestion?.bookId).length;
    html += `<div class="view-head"><h1>Inbox</h1><span class="spacer"></span>
      ${ready ? `<button class="gold" data-action="accept-all">${ready === 1 ? "File 1 suggestion" : `File all ${ready} suggestions`}</button>` : ""}</div>`;
    html += captureCard();
    html += items.length
      ? items.map(fragCard).join("")
      : emptyState("Your ideas land here", "Dictate, type or drop a screenshot. Plumi suggests which book and chapter each one belongs to. You decide.");
  } else if (view.kind === "all") {
    const items = [...state.fragments].sort((a, b) => b.createdAt - a.createdAt);
    html += `<div class="view-head"><h1>All notes</h1></div>`;
    html += captureCard();
    html += items.length ? items.map(fragCard).join("") : emptyState("No notes yet", "Start with a single sentence.");
  } else if (view.kind === "book") {
    const book = bookById(view.bookId);
    if (!book) {
      view = { kind: "inbox" };
      return renderMain();
    }
    const ch = chapterById(book, view.chapterId);
    html += `<div class="view-head"><h1>${esc(ch ? ch.title : book.title)}</h1>
      ${ch ? `<span class="muted">${esc(book.title)}</span>` : ""}<span class="spacer"></span>
      <button class="ghost" data-action="edit-book" data-book="${book.id}">Edit book</button>
      <button class="ghost" data-action="export" data-format="md" data-book="${book.id}">Markdown</button>
      <button class="ghost" data-action="export" data-format="doc" data-book="${book.id}">Word</button>
      <button class="ghost" data-action="export" data-format="pdf" data-book="${book.id}">PDF</button></div>`;
    if (book.keywords?.length && !ch) html += `<p class="small muted">Keywords: ${esc(book.keywords.join(", "))}</p>`;
    html += captureCard();
    if (ch) {
      const items = state.fragments.filter((f) => f.bookId === book.id && f.chapterId === ch.id).sort((a, b) => a.createdAt - b.createdAt);
      html += items.length ? items.map(fragCard).join("") : emptyState("Empty chapter", "Capture here, or file notes from the Inbox.");
    } else {
      const sections = bookSections(book, state.fragments);
      const total = sections.reduce((n, s) => n + s.items.length, 0);
      if (!total) html += emptyState("A blank page", "Capture here, or file notes from the Inbox.");
      for (const s of sections) {
        if (!s.items.length) continue;
        html += `<h2 class="chapter-title">${esc(s.title)}</h2>` + s.items.map(fragCard).join("");
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
  f.chapters.value = (book?.chapters || [])
    .map((c) => (c.keywords?.length ? `${c.title}: ${c.keywords.join(", ")}` : c.title))
    .join("\n");
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
  // Refresh keyword suggestions for unfiled notes.
  for (const fr of state.fragments) if (!fr.bookId && fr.suggestion?.by !== "claude") fr.suggestion = { ...suggest(fr.text, state.books, state.fragments.filter((x) => x.bookId)), by: "plumi" };
  commit();
});

/* ---------- Settings ---------- */

$("#settings-dialog").addEventListener("close", () => {
  if ($("#settings-dialog").returnValue !== "save") return;
  const f = $("#settings-form");
  settings = { apiKey: f.apiKey.value.trim(), model: f.model.value };
  saveSettings(settings);
  toast(settings.apiKey ? "Claude is on. Plumi will sort with Claude." : "Settings saved. Plumi sorts by keywords.");
  render();
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

/* ---------- Events ---------- */

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT") return;
  const id = el.dataset.id;
  const frag = id ? state.fragments.find((f) => f.id === id) : null;

  switch (el.dataset.action) {
    case "toggle-nav":
      $("#nav").classList.toggle("open");
      break;
    case "mode":
      state.mode = el.dataset.mode;
      assists.clear();
      commit();
      toast(state.mode === "authentique" ? "Mode Authentique: your exact words, never rewritten." : "Mode Assisté: ask for suggestions, you approve every change.");
      break;
    case "view":
      view = { kind: el.dataset.kind, bookId: el.dataset.book, chapterId: el.dataset.chapter || null };
      query = "";
      $("#nav").classList.remove("open");
      render();
      break;
    case "new-book":
      openBookDialog(null);
      break;
    case "edit-book":
      openBookDialog(el.dataset.book);
      break;
    case "delete-book": {
      const book = bookById(editingBookId);
      if (book && confirm(`Delete "${book.title}"? Its notes go back to the Inbox.`)) {
        for (const f of state.fragments) if (f.bookId === book.id) fileFragment(f, null, null);
        state.books = state.books.filter((b) => b.id !== book.id);
        view = { kind: "inbox" };
        $("#book-dialog").close();
        commit();
      }
      break;
    }
    case "open-settings": {
      const f = $("#settings-form");
      f.apiKey.value = settings.apiKey;
      f.model.value = settings.model;
      $("#settings-dialog").showModal();
      break;
    }
    case "backup":
      exportBackup(state);
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
    case "accept":
      if (frag?.suggestion) {
        const s = frag.suggestion;
        fileFragment(frag, s.bookId, s.chapterId);
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
        commit();
      }
      break;
    case "export": {
      const book = bookById(el.dataset.book);
      const fmt = el.dataset.format;
      try {
        if (fmt === "md") exportMarkdown(book, state.fragments);
        else if (fmt === "doc") exportWord(book, state.fragments);
        else exportPdf(book, state.fragments);
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
      commit();
      toast(`Moved to ${placeLabel(frag.bookId, frag.chapterId)}.`);
    }
  } else if (el.id === "image-input") {
    handleImage(el.files[0]);
    el.value = "";
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "draft") {
    draft = e.target.value;
    if (!stopDictation && draftSource === "voice" && !draft) draftSource = "text";
  } else if (e.target.id === "search") {
    query = e.target.value;
    if (query.trim()) view = { kind: "search" };
    else if (view.kind === "search") view = { kind: "inbox" };
    render();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.target.id === "draft" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    saveDraft();
  }
});

render();
