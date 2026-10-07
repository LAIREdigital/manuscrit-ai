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

export function loadSettings() {
  try {
    return { apiKey: "", model: "claude-opus-5-5", ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { apiKey: "", model: "claude-opus-5-5" };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function importBackup(json) {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.books) || !Array.isArray(data.fragments)) {
    throw new Error("That file is not a Manuscrit backup.");
  }
  return data;
}
