import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { CONFIG, auth } from "./firebase.js";

let ready = false;
let signedIn = false;
const waiters = [];

function notifyReady() {
  ready = true;
  waiters.splice(0).forEach((resolve) => resolve(signedIn));
}

onAuthStateChanged(auth, (user) => {
  signedIn = Boolean(user);
  notifyReady();
});

// Waits until Firebase Auth has resolved the current session.
export function waitForStaffAuth() {
  if (ready) return Promise.resolve(signedIn);
  return new Promise((resolve) => waiters.push(resolve));
}

// Returns whether a staff member is signed in.
export function isStaffSignedIn() {
  return signedIn;
}

// Signs in with the configured staff email and password.
export async function signInStaff(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
  return auth.currentUser;
}

// Signs out the current staff session.
export async function signOutStaff() {
  await signOut(auth);
}

// Ensures staff are signed in; runs callback when ready.
export async function requireStaffAuth(onReady) {
  const ok = await waitForStaffAuth();
  if (ok) {
    onReady();
    return;
  }
  showStaffLoginModal(onReady);
}

function showStaffLoginModal(onSuccess) {
  let backdrop = document.querySelector("#staffLoginModal");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "staffLoginModal";
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <section class="history-modal payment-method-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h2>Staff Sign In</h2>
        </div>
        <form class="payment-method-body staff-login-form" id="staffLoginForm">
          <p class="subtle">Use the staff account created in Firebase Authentication. Password is not stored in this app code.</p>
          <label class="select-label" for="staffEmail">Staff email</label>
          <input class="table-select" id="staffEmail" type="email" autocomplete="username" placeholder="staff@yourcafe.com" required>
          <label class="select-label" for="staffPassword">Password</label>
          <input class="table-select" id="staffPassword" type="password" autocomplete="current-password" required>
          <p class="staff-login-error subtle" id="staffLoginError" hidden></p>
          <button class="primary-btn" type="submit">Sign In</button>
        </form>
      </section>
    `;
    document.body.appendChild(backdrop);
  }

  const form = backdrop.querySelector("#staffLoginForm");
  const emailInput = backdrop.querySelector("#staffEmail");
  const passwordInput = backdrop.querySelector("#staffPassword");
  const errorEl = backdrop.querySelector("#staffLoginError");

  emailInput.value = "";
  passwordInput.value = "";
  errorEl.hidden = true;
  backdrop.hidden = false;

  form.onsubmit = async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    try {
      await signInStaff(emailInput.value.trim(), passwordInput.value);
      backdrop.hidden = true;
      onSuccess();
    } catch (error) {
      const code = error?.code || "";
      if (code === "auth/invalid-api-key" || code === "auth/api-key-not-valid") {
        errorEl.textContent = "Invalid Firebase API key. Update CONFIG.FIREBASE in firebase.js from Firebase Console.";
      } else if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        errorEl.textContent = "Wrong email or password. Check Firebase Authentication → Users.";
      } else if (code === "auth/unauthorized-domain") {
        errorEl.textContent = "Add cafeddream.github.io to Firebase Auth → Settings → Authorized domains.";
      } else {
        errorEl.textContent = `Sign in failed (${code || "unknown"}). Check Firebase setup.`;
      }
      errorEl.hidden = false;
    }
  };
}
