// Simple sign-in. Only @lairedigital.com emails. Every account starts with the password "password"
// and the author can change it in Settings. Passwords are stored as salted PBKDF2 hashes in this
// browser, never as plain text. There is no server, so accounts live per browser.

export const DOMAIN = "@lairedigital.com";
export const DEFAULT_PASSWORD = "password";
const USERS_KEY = "manuscrit.users.v1";
const SESSION_KEY = "manuscrit.session.v1";

export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => /^[a-z0-9._%+-]+@lairedigital\.com$/.test(normEmail(e));

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return hex(bits);
}

const newSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)));

const readUsers = (store) => {
  try {
    return JSON.parse(store.getItem(USERS_KEY) || "{}");
  } catch {
    return {};
  }
};
const writeUsers = (store, users) => store.setItem(USERS_KEY, JSON.stringify(users));

/** Returns the signed-in email, or throws with a message for the login screen. */
export async function signIn(store, email, password) {
  const e = normEmail(email);
  if (!validEmail(e)) throw new Error(`Use your ${DOMAIN} email.`);
  const users = readUsers(store);
  const u = users[e];
  if (!u) {
    // First sign-in on this browser: the account starts with the default password.
    if (password !== DEFAULT_PASSWORD) throw new Error("Wrong email or password.");
    const salt = newSalt();
    users[e] = { salt, hash: await hashPassword(DEFAULT_PASSWORD, salt) };
    writeUsers(store, users);
  } else if ((await hashPassword(password, u.salt)) !== u.hash) {
    throw new Error("Wrong email or password.");
  }
  store.setItem(SESSION_KEY, e);
  return e;
}

export async function changePassword(store, email, current, next) {
  const e = normEmail(email);
  if (String(next || "").length < 8) throw new Error("New password needs at least 8 characters.");
  const users = readUsers(store);
  const u = users[e];
  if (!u || (await hashPassword(current, u.salt)) !== u.hash) throw new Error("Current password is wrong.");
  const salt = newSalt();
  users[e] = { salt, hash: await hashPassword(next, salt) };
  writeUsers(store, users);
}

export const currentUser = (store) => {
  const e = store.getItem(SESSION_KEY);
  return e && readUsers(store)[e] ? e : null;
};
export const signOut = (store) => store.removeItem(SESSION_KEY);
