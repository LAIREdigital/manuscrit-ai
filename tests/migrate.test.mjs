import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeData, mergeMissing } from "../manuscrit/js/migrate.js";

const book = (id, chapters = []) => ({ id, title: id, keywords: [], chapters: chapters.map((c) => ({ id: c, title: c, keywords: [] })) });
const note = (id, text, bookId = null) => ({ id, text, bookId, createdAt: 1 });

test("adds books and notes missing here", () => {
  const cur = { version: 1, books: [book("b1", ["c1"])], fragments: [note("n1", "new address")] };
  const old = { version: 1, books: [book("b2")], fragments: [note("n2", "old address", "b2")] };
  const { data, added } = mergeData(cur, old);
  assert.deepEqual(added, { books: 1, chapters: 0, notes: 1 });
  assert.deepEqual(data.books.map((b) => b.id), ["b1", "b2"]);
  assert.deepEqual(data.fragments.map((f) => f.id), ["n1", "n2"]);
});

test("never changes or drops what is already here", () => {
  const cur = { version: 1, books: [book("b1", ["c1"])], fragments: [note("n1", "edited today")] };
  const old = { version: 1, books: [{ ...book("b1", ["c1", "c2"]), title: "OLD TITLE" }], fragments: [note("n1", "older text")] };
  const { data, added } = mergeData(cur, old);
  assert.equal(data.books[0].title, "b1");
  assert.equal(data.fragments[0].text, "edited today");
  assert.deepEqual(data.books[0].chapters.map((c) => c.id), ["c1", "c2"]);
  assert.deepEqual(added, { books: 0, chapters: 1, notes: 0 });
  assert.equal(cur.books[0].chapters.length, 1, "input not mutated");
});

test("empty new address takes the old data whole", () => {
  const old = { version: 1, mode: "assiste", books: [book("b1")], fragments: [note("n1", "x", "b1")] };
  const { data, added } = mergeData(null, old);
  assert.equal(data.books.length, 1);
  assert.equal(added.notes, 1);
});

test("bad incoming data changes nothing", () => {
  const cur = { version: 1, books: [book("b1")], fragments: [] };
  assert.deepEqual(mergeData(cur, { nope: 1 }).data, cur);
  assert.deepEqual(mergeData(cur, null).added, { books: 0, chapters: 0, notes: 0 });
});

test("accounts and keys: only adds missing entries", () => {
  const { data, added } = mergeMissing({ "a@lairedigital.com": "new" }, { "a@lairedigital.com": "old", "b@lairedigital.com": "old" });
  assert.deepEqual(data, { "a@lairedigital.com": "new", "b@lairedigital.com": "old" });
  assert.equal(added, 1);
});
