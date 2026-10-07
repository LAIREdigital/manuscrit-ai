import { test } from "node:test";
import assert from "node:assert/strict";
import { suggest, search, lightTidy, tokenize } from "../js/plumi.js";

const books = [
  {
    id: "b1",
    title: "The Garden",
    keywords: ["roses", "soil", "grandmother"],
    chapters: [
      { id: "c1", title: "Spring", keywords: ["seeds", "planting"] },
      { id: "c2", title: "Winter", keywords: ["frost", "snow"] },
    ],
  },
  { id: "b2", title: "Founder Notes", keywords: ["business", "launch", "pricing"], chapters: [] },
];

test("tokenize drops stopwords and short words", () => {
  assert.deepEqual(tokenize("The roses and I"), ["roses"]);
});

test("routes to book and chapter by keywords", () => {
  const s = suggest("Grandmother planting seeds in the roses bed", books);
  assert.equal(s.bookId, "b1");
  assert.equal(s.chapterId, "c1");
  assert.ok(s.score > 0);
});

test("routes business thoughts to the other book", () => {
  const s = suggest("Need to rethink pricing before the launch", books);
  assert.equal(s.bookId, "b2");
  assert.equal(s.chapterId, null);
});

test("hashtag of book title wins", () => {
  const s = suggest("snow and frost everywhere #foundernotes", books);
  assert.equal(s.bookId, "b2");
});

test("no books gives a helpful reason", () => {
  const s = suggest("anything", []);
  assert.equal(s.bookId, null);
  assert.match(s.reason, /Create a book/);
});

test("learns from filed fragments", () => {
  const frags = [{ id: "f1", bookId: "b2", text: "investors want traction metrics", createdAt: 1 }];
  const s = suggest("traction metrics improved", books, frags);
  assert.equal(s.bookId, "b2");
});

test("search requires every term and is accent insensitive", () => {
  const frags = [
    { id: "1", text: "Lumière lights the way", createdAt: 1 },
    { id: "2", text: "lumiere and plumi", createdAt: 2 },
  ];
  assert.deepEqual(search("lumiere", frags).map((f) => f.id), ["2", "1"]);
  assert.deepEqual(search("lumiere plumi", frags).map((f) => f.id), ["2"]);
});

test("lightTidy keeps words, fixes case and ending", () => {
  assert.equal(lightTidy("  the rain fell.  i waited "), "The rain fell. I waited.");
});

test("lightTidy ends questions with a question mark", () => {
  assert.equal(lightTidy("what should the price be"), "What should the price be?");
});
