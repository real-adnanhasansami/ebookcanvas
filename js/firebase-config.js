// ============================================================
// Ebook Canvas — Firebase initialization
// Loaded as a module by every page. Uses the Firebase CDN build
// so the site needs no bundler/build step and can be deployed to
// Vercel as a static site.
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js";

// NOTE: Firebase Storage is intentionally NOT used — as of Feb 3, 2026,
// Cloud Storage for Firebase requires the paid Blaze plan (a linked
// billing card), even for small free-tier usage. Book PDFs are stored
// on Cloudinary instead (see js/admin.js), which has a genuinely free,
// no-card-required tier. Auth and Firestore stay on Firebase's free
// Spark plan, which this change does not affect.

// NOTE: this config is safe to expose in client code — it is not a
// secret. Actual access control lives in firestore.rules / storage.rules,
// not here.
const firebaseConfig = {
  apiKey: "AIzaSyB0VNDLZdRjWzGb5f4V5MykAmC73KnxWBw",
  authDomain: "ebookcanvas.firebaseapp.com",
  projectId: "ebookcanvas",
  storageBucket: "ebookcanvas.firebasestorage.app",
  messagingSenderId: "415991502433",
  appId: "1:415991502433:web:4edab46d1a22fe3b4a7c20",
  measurementId: "G-ZEC2LXEQ8K"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

// Analytics only works in a real browser with support (not in some
// embedded/preview contexts), so guard it.
isSupported().then((ok) => { if (ok) getAnalytics(app); }).catch(() => {});
