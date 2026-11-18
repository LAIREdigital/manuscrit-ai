// Toolkit homepage: PIN gate, then the tool grid.
//
// The PIN is a light gate to keep casual visitors out, not real security: this is a static
// site, so anyone who reads the code can get past it. Never put client data behind it.
// It asks again for every new tab or browser session (sessionStorage).
//
// This page never reads or writes any tool's own storage (for example the manuscrit.* keys).
// Everything here lives under the "laire.toolkit." prefix.

import { TOOLS } from "./tools.js";

const PIN_HASH = "422fe0e6128a73a02469c4c804464aaa003b23bbfb87e5f797399105b1c9f613";
const UNLOCK_KEY = "laire.toolkit.unlocked";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const session = {
  get: () => { try { return sessionStorage.getItem(UNLOCK_KEY) === "1"; } catch { return false; } },
  set: (on) => { try { on ? sessionStorage.setItem(UNLOCK_KEY, "1") : sessionStorage.removeItem(UNLOCK_KEY); } catch { /* private mode */ } },
};

function unlock() {
  document.body.classList.remove("locked");
  $("#pin-screen").hidden = true;
  $("#app").hidden = false;
  render("all");
}

function lock() {
  session.set(false);
  document.body.classList.add("locked");
  $("#app").hidden = true;
  $("#pin-screen").hidden = false;
  $("#pin").value = "";
  $("#pin").focus();
}

const STATUS = { live: "Live", slack: "In Slack", soon: "Coming soon" };

function card(t) {
  const by = t.owner ? `<p class="owner">By ${esc(t.owner)}</p>` : "";
  const tags = t.tags.map((x) => `<span class="tag">${esc(x)}</span>`).join("");
  const external = /^https?:/.test(t.url);
  let action;
  if (t.status === "soon") action = `<span class="cta muted">Coming soon</span>`;
  else if (!t.url) action = `<span class="cta muted">Link coming</span>`;
  else action = `<a class="cta" href="${esc(t.url)}"${external ? ' target="_blank" rel="noopener"' : ""}>Open ${esc(t.name)}<span aria-hidden="true"> &rarr;</span></a>`;
  return `<article class="tool ${t.status}${t.url ? "" : " nolink"}">
    <div class="tool-head"><span class="status s-${t.status}">${STATUS[t.status]}</span></div>
    <h2>${esc(t.name)}</h2>
    ${by}
    <p class="blurb">${esc(t.blurb)}</p>
    <div class="tags">${tags}</div>
    ${action}
  </article>`;
}

function render(filter) {
  const list = filter === "all" ? TOOLS : TOOLS.filter((t) => t.status === filter);
  $("#grid").innerHTML = list.length ? list.map(card).join("") : `<p class="empty">Nothing here yet.</p>`;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.filter === filter));
}

$("#pin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#pin-error");
  err.textContent = "";
  if ((await sha256("laire-toolkit:" + $("#pin").value.trim())) === PIN_HASH) {
    session.set(true);
    unlock();
  } else {
    err.textContent = "That PIN is not right.";
    $("#pin").select();
  }
});

$("#lock").addEventListener("click", lock);
document.querySelector(".filters").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (b) render(b.dataset.filter);
});

if (session.get()) unlock();
