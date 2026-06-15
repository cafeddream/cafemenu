import {
  browserLocalPersistence,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { auth } from "./firebase.js";

const AUTH_WAIT_MS = 8000;
const STAFF_EMAIL_KEY = "cafe_staff_email";

let ready = false;
let signedIn = false;
let persistenceReady = false;
const waiters = [];

function notifyReady() {
  if (ready) return;
  ready = true;
  hideStaffAuthBoot();
  waiters.splice(0).forEach((resolve) => resolve(signedIn));
}

function resolveAuthState(user) {
  signedIn = Boolean(user);
  notifyReady();
}

onAuthStateChanged(auth, (user) => {
  resolveAuthState(user);
}, () => {
  resolveAuthState(null);
});

// TV browsers sometimes never fire the first auth callback.
setTimeout(() => {
  if (!ready) resolveAuthState(auth.currentUser);
}, AUTH_WAIT_MS);

async function ensureAuthPersistence() {
  if (persistenceReady) return;
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    try {
      await setPersistence(auth, inMemoryPersistence);
    } catch {
      // Fall back to Firebase default persistence.
    }
  }
  persistenceReady = true;
}

function hideManagerSplash() {
  const splash = document.querySelector("#psSplash");
  if (!splash) return;
  splash.classList.add("hide");
  splash.style.display = "none";
}

function showStaffAuthBoot(message) {
  hideManagerSplash();
  let boot = document.querySelector("#staffAuthBoot");
  if (!boot) {
    boot = document.createElement("div");
    boot.id = "staffAuthBoot";
    boot.className = "staff-auth-boot";
    document.body.append(boot);
  }
  boot.textContent = message;
  boot.hidden = false;
  boot.style.display = "grid";
}

function hideStaffAuthBoot() {
  const boot = document.querySelector("#staffAuthBoot");
  if (!boot) return;
  boot.hidden = true;
  boot.style.display = "none";
}

function showLoginBackdrop(backdrop) {
  hideManagerSplash();
  hideStaffAuthBoot();
  backdrop.hidden = false;
  backdrop.classList.add("staff-login-open");
  backdrop.style.display = "grid";
  document.body.classList.add("staff-login-active");
}

function hideLoginBackdrop(backdrop) {
  backdrop.hidden = true;
  backdrop.classList.remove("staff-login-open");
  backdrop.style.display = "none";
  document.body.classList.remove("staff-login-active");
}

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
  await ensureAuthPersistence();
  await signInWithEmailAndPassword(auth, email, password);
  try {
    localStorage.setItem(STAFF_EMAIL_KEY, email);
  } catch {
    // Storage may be blocked on some TV browsers.
  }
  return auth.currentUser;
}

// Signs out the current staff session.
export async function signOutStaff() {
  await signOut(auth);
}

// Ensures staff are signed in; runs callback when ready.
export async function requireStaffAuth(onReady) {
  showStaffAuthBoot("Checking sign in...");
  await ensureAuthPersistence();
  const ok = await waitForStaffAuth();
  if (ok) {
    hideStaffAuthBoot();
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
    backdrop.className = "modal-backdrop staff-login-backdrop";
    backdrop.innerHTML = `
      <section class="history-modal staff-login-modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h2>Staff Sign In</h2>
        </div>
        <form class="payment-method-body staff-login-form" id="staffLoginForm">
          <p class="subtle">Sign in with your Firebase staff account to use Admin and Kitchen.</p>
          <label class="select-label" for="staffEmail">Staff email</label>
          <input class="table-select staff-login-input" id="staffEmail" type="email" inputmode="email" autocomplete="username" placeholder="staff@yourcafe.com" required>
          <label class="select-label" for="staffPassword">Password</label>
          <input class="table-select staff-login-input" id="staffPassword" type="password" autocomplete="current-password" required>
          <p class="staff-login-error subtle" id="staffLoginError" hidden></p>
          <button class="primary-btn staff-login-submit" type="submit">Sign In</button>
        </form>
      </section>
    `;
    document.body.appendChild(backdrop);
  }

  const form = backdrop.querySelector("#staffLoginForm");
  const emailInput = backdrop.querySelector("#staffEmail");
  const passwordInput = backdrop.querySelector("#staffPassword");
  const errorEl = backdrop.querySelector("#staffLoginError");
  const submitBtn = backdrop.querySelector(".staff-login-submit");

  let savedEmail = "";
  try {
    savedEmail = localStorage.getItem(STAFF_EMAIL_KEY) || "";
  } catch {
    savedEmail = "";
  }

  emailInput.value = savedEmail;
  passwordInput.value = "";
  errorEl.hidden = true;
  errorEl.style.display = "none";
  showLoginBackdrop(backdrop);

  setTimeout(() => {
    if (savedEmail) passwordInput.focus();
    else emailInput.focus();
  }, 100);

  form.onsubmit = async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    errorEl.style.display = "none";
    submitBtn.disabled = true;
    try {
      await signInStaff(emailInput.value.trim(), passwordInput.value);
      hideLoginBackdrop(backdrop);
      onSuccess();
    } catch (error) {
      const code = error?.code || "";
      if (code === "auth/invalid-api-key" || code === "auth/api-key-not-valid") {
        errorEl.textContent = "Invalid Firebase API key. Update CONFIG.FIREBASE in firebase.js from Firebase Console.";
      } else if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        errorEl.textContent = "Wrong email or password. Check Firebase Authentication → Users.";
      } else if (code === "auth/unauthorized-domain") {
        errorEl.textContent = "Add cafeddream.github.io to Firebase Auth → Settings → Authorized domains.";
      } else if (code === "auth/network-request-failed") {
        errorEl.textContent = "Network error. Check Wi-Fi on this TV and try again.";
      } else {
        errorEl.textContent = `Sign in failed (${code || "unknown"}). Check Firebase setup.`;
      }
      errorEl.hidden = false;
      errorEl.style.display = "block";
    } finally {
      submitBtn.disabled = false;
    }
  };
}
