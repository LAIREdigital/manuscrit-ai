// Capture helpers: dictation through the browser's speech engine, and OCR for screenshots.

export function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Start dictation. Calls onText(finalText, interimText) as words arrive.
 * Returns a stop() function.
 */
export function startDictation({ onText, onEnd, onError, lang = "en-US" }) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Rec();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;

  let finalText = "";
  let stopped = false;
  let lastFinalAt = Date.now();
  // A pause longer than this starts a new paragraph, which the splitter treats as a new note.
  const PAUSE_MS = 3500;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        const now = Date.now();
        const sep = !finalText ? "" : now - lastFinalAt > PAUSE_MS ? "\n\n" : " ";
        finalText += sep + r[0].transcript.trim();
        lastFinalAt = now;
      }
      else interim += r[0].transcript;
    }
    onText(finalText, interim);
  };
  rec.onerror = (e) => {
    if (e.error !== "no-speech" && e.error !== "aborted") onError?.(e.error);
  };
  // Browsers end long sessions on their own. Keep listening until the author stops.
  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start();
        return;
      } catch {
        /* fall through */
      }
    }
    onEnd?.(finalText);
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
