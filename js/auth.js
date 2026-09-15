// ============================================================
// Ebook Canvas — Auth helpers
// Shared by login / signup / account / reader / admin pages.
// ============================================================
import { auth, googleProvider, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, sendPasswordResetEmail, sendEmailVerification,
  onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Create the per-user profile document on first sign-up / first Google login.
// This is the ONLY place isAdmin/isPremium get written for a new account,
// and it always writes `false` — a user can never grant themself access.
// Admin status must be granted from the admin panel by an existing admin,
// enforced by firestore.rules.
async function ensureUserDoc(user, extra = {}) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || extra.displayName || "",
      isAdmin: false,
      isPremium: false,
      premiumExpiry: null,
      accountStatus: "active", // active | deactivated
      createdAt: serverTimestamp(),
      readingProgress: {},
      ...extra
    });
  }
  return ref;
}

export async function signUpWithEmail(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) await updateProfile(cred.user, { displayName: name });
  await ensureUserDoc(cred.user, { displayName: name });
  await sendEmailVerification(cred.user);
  return cred.user;
}

export async function logInWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logInWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function logOut() {
  return signOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) return callback(null, null);
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    callback(user, snap.exists() ? snap.data() : null);
  });
}

export function friendlyAuthError(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/email-already-in-use": "That email already has an account. Try logging in instead.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/weak-password": "Use at least 6 characters for your password.",
    "auth/wrong-password": "Incorrect password. Try again or reset it.",
    "auth/user-not-found": "No account found with that email.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/popup-closed-by-user": "Google sign-in was closed before finishing."
  };
  return map[code] || "Something went wrong. Please try again.";
}
