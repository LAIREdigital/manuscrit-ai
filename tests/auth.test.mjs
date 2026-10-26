import { test } from "node:test";
import assert from "node:assert/strict";
import { signIn, changePassword, currentUser, signOut, validEmail } from "../js/auth.js";

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test("only lairedigital.com emails", () => {
  assert.ok(validEmail(" Sam@LaireDigital.com "));
  assert.ok(!validEmail("sam@gmail.com"));
  assert.ok(!validEmail("sam@lairedigital.com.evil.io"));
});

test("first sign-in uses the default password, then a changed one", async () => {
  const s = mem();
  await assert.rejects(signIn(s, "sam@gmail.com", "password"), /lairedigital/);
  await assert.rejects(signIn(s, "sam@lairedigital.com", "nope"), /Wrong/);
  assert.equal(await signIn(s, "Sam@lairedigital.com", "password"), "sam@lairedigital.com");
  assert.equal(currentUser(s), "sam@lairedigital.com");
  assert.ok(![...s.m.values()].some((v) => v.includes('"password"')), "no plain text password stored");

  await assert.rejects(changePassword(s, "sam@lairedigital.com", "wrong", "longenough"), /Current/);
  await assert.rejects(changePassword(s, "sam@lairedigital.com", "password", "short"), /8/);
  await changePassword(s, "sam@lairedigital.com", "password", "new-secret-1");

  signOut(s);
  assert.equal(currentUser(s), null);
  await assert.rejects(signIn(s, "sam@lairedigital.com", "password"), /Wrong/);
  assert.equal(await signIn(s, "sam@lairedigital.com", "new-secret-1"), "sam@lairedigital.com");
});
