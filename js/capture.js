// Capture helpers: dictation through the browser's speech engine, and OCR for screenshots.

export function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Join finished speech segments without repeats. Phone browsers often resend the whole
 * phrase so far as each new result ("I went", "I went to the", "I went to the store"),
 * which doubled text before. A segment that extends the previous one replaces it, and a
 * segment already contained in the previous one is dropped.
 */
export function mergeSegments(segments) {
  const out = [];
  const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const raw of segments) {
    const t = String(raw.text || "").trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    if (prev) {
      const a = norm(prev.text);
      const b = norm(t);
      if (b.startsWith(a)) {
        prev.text = t;
        continue;
      }
      if (a.endsWith(b) || a === b) continue;
    }
    out.push({ text: t, pause: Boolean(raw.pause) });
  }
  return out.map((x, i) => (i === 0 ? "" : x.pause ? "\n\n" : " ") + x.text).join("");
}

const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/**
 * Start dictation. Calls onText(finalText, interimText) as words arrive.
 * Returns a stop() function.
 */
export function startDictation({ onText, onEnd, onError, lang = "en-US" }) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Rec();
  rec.lang = lang;
  // Continuous mode is what repeats words on phones. There we listen one phrase at a time
  // and restart automatically, which feels the same to the author.
  rec.continuous = !isMobile();
  rec.interimResults = true;

  const segments = []; // finished phrases from earlier listening sessions
  let session = []; // finished phrases in the current session, keyed by result index
  let stopped = false;
  let lastFinalAt = Date.now();
  // A pause longer than this starts a new paragraph, which the splitter treats as a new note.
  const PAUSE_MS = 3500;
  const text = () => mergeSegments([...segments, ...session.filter(Boolean)]);

  rec.onresult = (e) => {
    let interim = "";
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        if (!session[i]) {
          const now = Date.now();
          session[i] = { text: r[0].transcript, pause: now - lastFinalAt > PAUSE_MS };
          lastFinalAt = now;
        } else {
          session[i].text = r[0].transcript;
        }
      } else if (i >= e.resultIndex) {
        interim += r[0].transcript;
      }
    }
    onText(text(), interim);
  };
  rec.onerror = (e) => {
    if (e.error !== "no-speech" && e.error !== "aborted") onError?.(e.error);
  };
  // Browsers end sessions on their own. Keep what was heard and keep listening until stopped.
  rec.onend = () => {
    segments.push(...session.filter(Boolean));
    session = [];
    if (!stopped) {
      try {
        rec.start();
        return;
      } catch {
        /* fall through */
      }
    }
    onEnd?.(text());
  };
  rec.start();

  return () => {
    stopped = true;
    rec.stop();
  };
}

let tesseractPromise = null;

/** Extract text from an image file. Loads Tesseract.js only when first needed. */
export async function ocrImage(file, onProgress) {
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => reject(new Error("Could not load the text reader."));
      document.head.appendChild(s);
    });
  }
  const Tesseract = await tesseractPromise;
  const { data } = await Tesseract.recognize(file, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) onProgress(Math.round(m.progress * 100));
    },
  });
  return (data.text || "").trim();
}
