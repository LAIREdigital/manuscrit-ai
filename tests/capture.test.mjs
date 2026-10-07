import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSegments } from "../js/capture.js";

test("phone style growing results do not double", () => {
  const segs = [{ text: "I went" }, { text: "I went to the" }, { text: "I went to the store" }];
  assert.equal(mergeSegments(segs), "I went to the store");
});

test("repeated final segment is dropped", () => {
  assert.equal(mergeSegments([{ text: "hello there" }, { text: "Hello there." }, { text: "new idea" }]), "Hello there. new idea");
});

test("pauses become paragraph breaks", () => {
  assert.equal(mergeSegments([{ text: "one" }, { text: "two", pause: true }]), "one\n\ntwo");
});
