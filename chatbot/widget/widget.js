// LAIRE chat widget. One script tag per site:
// <script src="https://lairedigital.github.io/manuscrit-ai/chatbot/widget/widget.js"
//         data-site="laire-demo" data-api="https://laire-chat.<account>.workers.dev" async></script>
(function () {
  const me = document.currentScript;
  const SITE = me && me.dataset.site;
  const API = me && (me.dataset.api || "").replace(/\/$/, "");
  if (!SITE || !API || window.__laireChat) return;
  window.__laireChat = true;

  const KEY = `laire-chat:${SITE}`;
  const state = load() || { messages: [], leadDone: false, open: false };
  let cfg = null;
  let busy = false;
  let leadShown = false;

  function load() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY));
    } catch {
      return null;
    }
  }
  function save() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }
  const hutk = () => (document.cookie.match(/(?:^|;\s*)hubspotutk=([^;]+)/) || [])[1];

  async function call(path, body) {
    const res = await fetch(`${API}${path}?site=${encodeURIComponent(SITE)}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "on") for (const [e, f] of Object.entries(v)) n.addEventListener(e, f);
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k) n.append(k);
    return n;
  }

  function render() {
    const t = cfg.theme || {};
    root.innerHTML = "";
    root.append(
      el("style", {
        text: `
:host{--p:${t.primary || "#0b2545"};--a:${t.accent || "#f2a541"};--t:${t.text || "#fff"};all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.btn{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;border:0;background:var(--p);color:var(--t);cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:2147483000;font-size:26px}
.panel{position:fixed;right:20px;bottom:90px;width:370px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 120px);background:#fff;color:#1b1b1b;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;z-index:2147483000}
@media (max-width:480px){.panel{right:16px;left:16px;width:auto;bottom:86px}}
.head{background:var(--p);color:var(--t);padding:14px 16px;display:flex;align-items:center;gap:10px;font-weight:600}
.head img{height:24px}.head span{flex:1}.x{background:none;border:0;color:var(--t);font-size:20px;cursor:pointer}
.log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f6f7f9}
.m{max-width:85%;padding:9px 12px;border-radius:12px;line-height:1.4;font-size:14px;white-space:pre-wrap;word-wrap:break-word}
.bot{background:#fff;border:1px solid #e3e6ea;align-self:flex-start}.user{background:var(--p);color:var(--t);align-self:flex-end}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip,.cta{border:1px solid var(--p);background:#fff;color:var(--p);border-radius:16px;padding:6px 10px;font-size:13px;cursor:pointer;text-decoration:none}
.cta{background:var(--a);border-color:var(--a);color:#1b1b1b;font-weight:600;align-self:flex-start}
form.lead{background:#fff;border:1px solid #e3e6ea;border-radius:12px;padding:10px;display:grid;gap:6px;font-size:13px}
form.lead input{padding:8px;border:1px solid #ccd1d7;border-radius:8px;font-size:14px}
form.lead button{background:var(--p);color:var(--t);border:0;border-radius:8px;padding:8px;cursor:pointer}
.hp{position:absolute;left:-9999px}
.foot{display:flex;gap:6px;padding:10px;border-top:1px solid #e3e6ea}
.foot input{flex:1;padding:10px;border:1px solid #ccd1d7;border-radius:10px;font-size:14px}
.foot button{background:var(--p);color:var(--t);border:0;border-radius:10px;padding:0 14px;cursor:pointer}
.note{font-size:11px;color:#666;text-align:center;padding:0 10px 8px}.note a{color:#666}
`,
      })
    );
    const btn = el("button", { class: "btn", "aria-label": `Chat with ${cfg.botName}`, text: state.open ? "×" : "✉", on: { click: toggle } });
    root.append(btn);
    if (!state.open) return;

    const log = el("div", { class: "log", role: "log", "aria-live": "polite" });
    log.append(el("div", { class: "m bot", text: cfg.greeting }));
    if (!state.messages.length && cfg.suggestions.length)
      log.append(el("div", { class: "chips" }, ...cfg.suggestions.map((s) => el("button", { class: "chip", text: s, on: { click: () => send(s) } }))));
    for (const m of state.messages) {
      log.append(el("div", { class: `m ${m.role === "user" ? "user" : "bot"}`, text: m.content }));
      if (m.offerMeeting && cfg.meetingUrl) log.append(meetingLink());
    }
    const botTurns = state.messages.filter((m) => m.role === "assistant").length;
    if (!state.leadDone && (leadShown || botTurns >= cfg.leadAfter)) {
      leadShown = true;
      log.append(leadForm());
    }
    if (busy) log.append(el("div", { class: "m bot", text: "..." }));

    const input = el("input", { placeholder: "Type your question", maxlength: "1000", "aria-label": "Your message" });
    const form = el("form", { class: "foot", on: { submit: (e) => (e.preventDefault(), send(input.value)) } }, input, el("button", { type: "submit", text: "Send" }));
    root.append(
      el(
        "div",
        { class: "panel", role: "dialog", "aria-label": cfg.botName },
        el("div", { class: "head" }, t.logo ? el("img", { src: t.logo, alt: "" }) : null, el("span", { text: cfg.botName }), el("button", { class: "x", "aria-label": "Close", text: "×", on: { click: toggle } })),
        log,
        form,
        el("div", { class: "note" }, document.createTextNode("AI assistant. Answers may be imperfect. "), cfg.privacyUrl ? el("a", { href: cfg.privacyUrl, target: "_blank", text: "Privacy" }) : null)
      )
    );
    log.scrollTop = log.scrollHeight;
    if (!busy) input.focus();
  }

  function meetingLink() {
    return el("a", { class: "cta", href: cfg.meetingUrl, target: "_blank", rel: "noopener", text: "Book a call with the team" });
  }

  function leadForm() {
    const f = el(
      "form",
      { class: "lead" },
      el("div", { text: "Want the team to follow up? Leave your details." }),
      el("input", { name: "firstname", placeholder: "First name", autocomplete: "given-name" }),
      el("input", { name: "email", type: "email", required: "", placeholder: "Work email", autocomplete: "email" }),
      el("input", { name: "company", placeholder: "Company", autocomplete: "organization" }),
      el("input", { name: "website", class: "hp", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" }),
      el("button", { type: "submit", text: "Send to the team" })
    );
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      f.querySelector("button").disabled = true;
      const r = await call("/lead", {
        lead: { email: d.email, firstname: d.firstname, company: d.company },
        website: d.website,
        transcript: state.messages.map(({ role, content }) => ({ role, content })),
        pageUri: location.href,
        pageName: document.title,
        hutk: hutk(),
      }).catch(() => ({ ok: false, data: {} }));
      if (r.ok) {
        state.leadDone = true;
        state.messages.push({ role: "assistant", content: "Thanks, the team has your details and will be in touch.", offerMeeting: true });
        save();
        render();
      } else {
        f.querySelector("button").disabled = false;
        f.firstChild.textContent = r.data.error || "Could not send. Please try again.";
      }
    });
    return f;
  }

  async function send(text) {
    text = String(text || "").trim();
    if (!text || busy) return;
    state.messages.push({ role: "user", content: text });
    busy = true;
    render();
    const r = await call("/chat", { messages: state.messages.map(({ role, content }) => ({ role, content })) }).catch(() => ({ ok: false, data: {} }));
    busy = false;
    if (r.ok) state.messages.push({ role: "assistant", content: r.data.reply, offerMeeting: r.data.offerMeeting });
    else {
      state.messages.push({ role: "assistant", content: r.data.error || "Something went wrong. Please try again.", offerMeeting: true });
      if (r.data.fallback) leadShown = true;
    }
    save();
    render();
  }

  function toggle() {
    state.open = !state.open;
    save();
    render();
  }

  call("/config")
    .then((r) => {
      if (!r.ok) return console.warn("LAIRE chat:", r.data.error);
      cfg = r.data;
      render();
    })
    .catch(() => {});
})();
