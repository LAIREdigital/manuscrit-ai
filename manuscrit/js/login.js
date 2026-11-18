// Entry point. First brings over notes saved at the old address (once per browser), then shows
// the sign-in screen until someone is signed in, then loads the app.
import { signIn, currentUser, DOMAIN } from "./auth.js";
import { runMigration } from "./migrate.js";

const screen = document.getElementById("login-screen");

function notice(msg) {
  if (!msg) return;
  const el = document.createElement("div");
  el.className = "migrate-notice";
  el.setAttribute("role", "status");
  el.textContent = msg;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "OK";
  close.addEventListener("click", () => el.remove());
  el.append(close);
  document.body.prepend(el);
}

function start() {
  if (currentUser(localStorage)) {
    screen.remove();
    import("./app.js");
  } else {
    document.body.classList.add("locked");
    const form = document.getElementById("login-form");
    const err = document.getElementById("login-error");
    form.email.placeholder = `you${DOMAIN}`;
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      err.textContent = "";
      try {
        await signIn(localStorage, form.email.value, form.password.value);
        document.body.classList.remove("locked");
        screen.remove();
        import("./app.js");
      } catch (e) {
        err.textContent = e.message;
      }
    });
  }
}

let msg = "";
try {
  msg = await runMigration();
} catch {
  msg = "";
}
if (msg !== "redirect") {
  notice(msg);
  start();
}
