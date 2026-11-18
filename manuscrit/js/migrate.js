// One-time move of a browser's Manuscrit data from the old address (lairedigital.github.io)
// to this one (toolkit.laire.ai). Browsers keep storage per address, so the new address starts
// empty even when the old one holds years of notes.
//
// How it works, once per browser:
//   1. No "migrated" flag here, so we send the browser to the rescue page on the old address
//      (laire-agents repo, docs/manuscrit-rescue.html, same address the old app used).
//   2. That page reads the old storage and sends the browser straight back here with the data
//      in the URL hash (#migrate=...). The hash never goes to any server.
//   3. We merge it in. The merge only ADDS: nothing already saved here is changed or removed.
//      Then the hash is wiped from the address bar and history.
//
// Force a re-run with toolkit.laire.ai/manuscrit/#rescue

export const FLAG = "manuscrit.migrated.v1";
const TRIES = "manuscrit.migrate.tries";
export const RESCUE_URL = "https://lairedigital.github.io/laire-agents/docs/manuscrit-rescue.html";
const DATA_KEY = "manuscrit.v1";
const USERS_KEY = "manuscrit.users.v1";
const KEYS_KEY = "manuscrit.keys.v1";

const parse = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

/** Add books, chapters and notes from `incoming` that `current` lacks. Never edits or drops existing ones. */
export function mergeData(current, incoming) {
  const out = current && Array.isArray(current.books) ? structuredClone(current) : { version: 1, mode: "authentique", books: [], fragments: [] };
  if (!Array.isArray(out.fragments)) out.fragments = [];
  const added = { books: 0, chapters: 0, notes: 0 };
  if (!incoming || !Array.isArray(incoming.books) || !Array.isArray(incoming.fragments)) return { data: out, added };

  const books = new Map(out.books.map((b) => [b.id, b]));
  for (const b of incoming.books) {
    const have = books.get(b.id);
    if (!have) {
      out.books.push(structuredClone(b));
      books.set(b.id, b);
      added.books++;
      continue;
    }
    have.chapters = have.chapters || [];
    const ch = new Set(have.chapters.map((c) => c.id));
    for (const c of b.chapters || []) {
      if (!ch.has(c.id)) {
        have.chapters.push(structuredClone(c));
        added.chapters++;
      }
    }
  }
  const notes = new Set(out.fragments.map((f) => f.id));
  for (const f of incoming.fragments) {
    if (!notes.has(f.id)) {
      out.fragments.push(structuredClone(f));
      added.notes++;
    }
  }
  return { data: out, added };
}

/** Accounts and AI keys: add the ones this address lacks, keep the ones it has. */
export function mergeMissing(current, incoming) {
  const out = { ...(current || {}) };
  let n = 0;
  for (const [k, v] of Object.entries(incoming || {})) {
    if (v && !(k in out)) {
      out[k] = v;
      n++;
    }
  }
  return { data: out, added: n };
}

async function decode(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (text.startsWith("H4sI") && typeof DecompressionStream !== "undefined") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function clearHash() {
  history.replaceState(null, "", location.pathname + location.search);
}

/**
 * Runs before sign-in. Returns a short message to show once data arrives, "redirect" when the
 * browser is on its way to the rescue page, or "" when there is nothing to do.
 */
export async function runMigration(store = localStorage, loc = location) {
  const hash = loc.hash || "";
  if (hash === "#rescue") {
    store.removeItem(FLAG);
    store.removeItem(TRIES);
    clearHash();
  }

  if (hash.startsWith("#migrate=")) {
    const body = hash.slice(9);
    clearHash();
    if (body === "none") {
      store.setItem(FLAG, JSON.stringify({ at: Date.now(), found: false }));
      return "";
    }
    if (body === "toobig") {
      store.setItem(FLAG, JSON.stringify({ at: Date.now(), found: true, tooBig: true }));
      return "Your notes from the old address are too big to move automatically. Download them at lairedigital.github.io/laire-agents/docs/manuscrit-rescue.html and restore the file in Settings.";
    }
    try {
      const payload = await decode(body);
      const d = mergeData(parse(store.getItem(DATA_KEY), null), payload.data);
      const u = mergeMissing(parse(store.getItem(USERS_KEY), {}), payload.users);
      const k = mergeMissing(parse(store.getItem(KEYS_KEY), {}), payload.keys);
      store.setItem(DATA_KEY, JSON.stringify(d.data));
      store.setItem(USERS_KEY, JSON.stringify(u.data));
      store.setItem(KEYS_KEY, JSON.stringify(k.data));
      store.setItem(FLAG, JSON.stringify({ at: Date.now(), found: true, ...d.added, accounts: u.added }));
      const { books, notes } = d.added;
      if (!books && !notes) return "";
      return `Brought over ${notes} note${notes === 1 ? "" : "s"} and ${books} book${books === 1 ? "" : "s"} from the old address. Nothing here was changed.`;
    } catch (e) {
      store.setItem(FLAG, JSON.stringify({ at: Date.now(), error: String(e.message || e) }));
      return "Could not bring over notes from the old address. Your notes here are safe. Download them at lairedigital.github.io/laire-agents/docs/manuscrit-rescue.html and restore the file in Settings.";
    }
  }

  if (store.getItem(FLAG)) return "";
  // Only on the live address, and give up after two tries so a broken rescue page can never trap anyone.
  let rescue = RESCUE_URL;
  if (loc.hostname !== "toolkit.laire.ai") {
    // Local testing only: point at a rescue page served on another local port.
    const test = /^(localhost|127\.0\.0\.1)$/.test(loc.hostname) && store.getItem("manuscrit.migrate.testurl");
    if (!test) return "";
    rescue = test;
  }
  const tries = Number(store.getItem(TRIES) || 0);
  if (tries >= 2) {
    store.setItem(FLAG, JSON.stringify({ at: Date.now(), gaveUp: true }));
    return "";
  }
  store.setItem(TRIES, String(tries + 1));
  loc.replace(`${rescue}?handoff=1&return=${encodeURIComponent(loc.origin + loc.pathname)}`);
  return "redirect";
}
