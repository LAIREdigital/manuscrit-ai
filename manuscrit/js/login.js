// Entry point. Shows the sign-in screen until someone is signed in, then loads the app.
import { signIn, currentUser, DOMAIN } from "./auth.js";

const screen = document.getElementById("login-screen");

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
