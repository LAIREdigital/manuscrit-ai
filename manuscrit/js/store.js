// Local-first storage. Everything lives in this browser's localStorage.

const KEY = "manuscrit.v1";
const SETTINGS_KEY = "manuscrit.settings.v1";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function starter() {
  const bookId = uid();
  return {
    version: 1,
    mode: "authentique",
    books: [
      {
        id: bookId,
        title: "My First Book",
        keywords: ["memory", "childhood", "home"],
        chapters: [
          { id: uid(), title: "Beginnings", keywords: ["start", "first", "young"] },
          { id: uid(), title: "Turning Point", keywords: ["change", "decision", "leave"] },
        ],
      },
    ],
    fragments: [],
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.books) && Array.isArray(data.fragments)) return data;
    }
  } catch {
    /* fall through to starter */
  }
  return starter();
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

const KEYS_KEY = "manuscrit.keys.v1";

const read = (k, fallback) => {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(k) || "{}") };
  } catch {
    return { ...fallback };
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
};

/** Preferences: which provider runs each task, models, tips seen, backup dates. */
export function loadSettings(defaults) {
  const s = read(SETTINGS_KEY, { models: {}, tasks: { ...defaults }, tips: {}, toured: false, lastBackup: 0, backupSnooze: 0 });
  s.tasks = { ...defaults, ...(s.tasks || {}) };
  delete s.apiKey;
  delete s.model;
  return s;
}

export const saveSettings = (s) => write(SETTINGS_KEY, s);

/** API keys are kept apart from everything else and never go into backups. */
export const loadKeys = () => read(KEYS_KEY, {});
export const saveKeys = (k) => write(KEYS_KEY, k);

/** Rough size of what this app keeps in the browser, in KB. */
export function storageKb() {
  let n = 0;
  for (const k of [KEY, SETTINGS_KEY, KEYS_KEY]) n += (localStorage.getItem(k) || "").length;
  return Math.round((n * 2) / 1024);
}

export function importBackup(json) {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.books) || !Array.isArray(data.fragments)) {
    throw new Error("That file is not a Manuscrit backup.");
  }
  return data;
}
