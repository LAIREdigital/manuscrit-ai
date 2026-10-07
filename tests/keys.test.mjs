import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeysFile, parseJson } from "../js/ai.js";

const fake = (p, n) => p + "x".repeat(n);

test("parses the app's own keys JSON", () => {
  assert.deepEqual(parseKeysFile(JSON.stringify({ keys: { groq: "gsk_abc", gemini: "AIzaQ" } })), { groq: "gsk_abc" });
});

test("finds keys inside free text notes", () => {
  const txt = `* Groq\n  * ${fake("gsk\\_", 40)}\n* Mistral\n  * ${fake("mstrl\\_", 30)}\n* Openrouter\n  * ${fake("sk-or-v1-", 30)}\nGemini AIza${"y".repeat(35)}`;
  const k = parseKeysFile(txt);
  assert.equal(k.groq, fake("gsk_", 40));
  assert.equal(k.openrouter, fake("sk-or-v1-", 30));
  assert.equal(k.gemini, undefined);
  assert.equal(k.cerebras, undefined);
});

test("parses provider: key lines", () => {
  assert.deepEqual(parseKeysFile("cerebras: csk-123\nopenrouter = sk-or-1"), { cerebras: "csk-123", openrouter: "sk-or-1" });
});

test("parseJson ignores fences and chatter", () => {
  assert.deepEqual(parseJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
});
