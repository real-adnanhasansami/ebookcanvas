// ============================================================
// Ebook Canvas — shared site behavior
// Auth-aware nav, dark mode, site branding, ad slots, featured
// books hero, library rendering + search (shared by index and
// library pages), star-rating helper, mobile nav, toast.
// ============================================================
import { watchAuth, logOut } from "./auth.js";
import { db } from "./firebase-config.js";
import { doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2600);
}

// --- Dark mode: a real, site-wide toggle (persisted per browser) ---
function applySavedTheme() {
  const saved = localStorage.getItem("ec-theme");
  if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");
}
function setupThemeSwitch() {
  const actionsRow = document.querySelector(".site-nav .row");
  if (!actionsRow || document.getElementById("theme-switch")) return;
  const btn = document.createElement("button");
  btn.id = "theme-switch";
  btn.className = "theme-switch";
  btn.title = "Toggle dark mode";
  btn.textContent = document.documentElement.getAttribute("data-theme") === "dark" ? "☀" : "☾";
  actionsRow.insertBefore(btn, actionsRow.lastElementChild);
  btn.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) { document.documentElement.removeAttribute("data-theme"); localStorage.setItem("ec-theme", "light"); }
    else { document.documentElement.setAttribute("data-theme", "dark"); localStorage.setItem("ec-theme", "dark"); }
    btn.textContent = isDark ? "☾" : "☀";
  });
}
applySavedTheme();

// --- Site branding: logo, name, meta — editable from Admin → Site ---
export async function applySiteSettings() {
  let s;
  try {
    const snap = await getDoc(doc(db, "site", "settings"));
    s = snap.exists() ? snap.data() : null;
  } catch (e) { s = null; }
  if (!s) return;

  if (s.siteName) document.querySelectorAll(".brand-name").forEach((el) => (el.textContent = s.siteName));
  if (s.logoURL) document.querySelectorAll(".brand-mark").forEach((el) => { el.style.background = `url(${s.logoURL}) center/cover no-repeat`; });
  if (s.metaDescription) {
    document.querySelector('meta[name="description"]')?.setAttribute("content", s.metaDescription);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", s.metaDescription);
  }
  if (s.metaTitle) document.querySelector('meta[property="og:title"]')?.setAttribute("content", s.metaTitle);
  if (s.heroTitle) document.querySelectorAll("[data-site='hero-title']").forEach((el) => (el.innerHTML = s.heroTitle));
  if (s.heroSubtitle) document.querySelectorAll("[data-site='hero-subtitle']").forEach((el) => (el.textContent = s.heroSubtitle));
  if (s.libraryEmpty) document.querySelectorAll("[data-site='library-empty']").forEach((el) => (el.textContent = s.libraryEmpty));
  if (s.footerTagline) document.querySelectorAll("[data-site='footer-tagline']").forEach((el) => (el.textContent = s.footerTagline));
}

// --- Nav ---
function renderNav(user, profile) {
  const slot = document.getElementById("nav-actions");
  if (slot) {
    if (!user) {
      slot.innerHTML = `<a class="btn btn-ghost" href="login.html">Log in</a><a class="btn btn-primary" href="signup.html">Sign up</a>`;
    } else {
      const adminLink = profile?.isAdmin ? `<a href="admin.html" class="muted-link">Admin</a>` : "";
      slot.innerHTML = `${adminLink}<a href="account.html" class="muted-link">${(profile?.displayName || user.email || "Account").split("@")[0]}</a><button class="btn btn-ghost" id="nav-logout">Log out</button>`;
      document.getElementById("nav-logout")?.addEventListener("click", async () => {
        await logOut(); toast("Logged out"); setTimeout(() => (window.location.href = "index.html"), 500);
      });
    }
  }
}

function setupMobileNav() {
  const nav = document.querySelector(".site-nav .row");
  if (!nav || document.getElementById("mobile-toggle")) return;
  const btn = document.createElement("button");
  btn.id = "mobile-toggle";
  btn.className = "icon-btn mobile-only";
  btn.setAttribute("aria-label", "Menu");
  btn.textContent = "☰";
  nav.appendChild(btn);
  btn.addEventListener("click", () => document.querySelector(".site-nav")?.classList.toggle("nav-open"));
}

// --- Ads ---
async function renderAds(profile) {
  const topSlot = document.querySelector("[data-ad='top']");
  const homeSlot = document.querySelector("[data-ad='home']");
  if (!topSlot && !homeSlot) return;

  let ads;
  try {
    const snap = await getDoc(doc(db, "site", "ads"));
    ads = snap.exists() ? snap.data() : null;
  } catch (e) { ads = null; }
  ads = ads || {
    enabled: true,
    topText: "Ebook Canvas Premium — ad-free, offline reading & audiobooks.",
    topLink: "contact.html",
    homeText: "Go Premium — remove ads and unlock every audiobook.",
    homeLink: "contact.html"
  };
  const isPremium = !!profile?.isPremium;

  if (topSlot) {
    if (isPremium || ads.enabled === false) topSlot.style.display = "none";
    else {
      topSlot.style.display = "flex";
      topSlot.innerHTML = `<span class="ad-badge">Sponsored</span><a href="${ads.topLink || '#'}" class="ad-text">${ads.topText}</a><span class="ad-badge ad-badge-ghost">Ad</span>`;
    }
  }
  if (homeSlot) {
    if (isPremium || ads.enabled === false) homeSlot.style.display = "none";
    else {
      homeSlot.style.display = "flex";
      homeSlot.innerHTML = `<span class="ad-badge">Sponsored</span><a href="${ads.homeLink || '#'}" class="ad-text ad-text-lg">${ads.homeText}</a><span class="ad-badge ad-badge-ghost">Ad</span>`;
    }
  }
}

// --- Featured / bestselling books hero (replaces the gradient blocks) ---
async function renderFeaturedHero() {
  const stack = document.getElementById("hero-stack");
  if (!stack) return;
  try {
    const snap = await getDocs(query(collection(db, "books"), where("featured", "==", true)));
    const featured = snap.docs.map((d) => ({ id: d.id, ...d.data() })).slice(0, 3);
    if (featured.length === 0) return; // keep the default decorative gradients
    stack.innerHTML = featured.map((b, i) => `
      <div class="floating-cover c${i + 1}" style="background-image:url(${b.coverURL || ''}); background-color:var(--lilac);">
        <div class="fc-title">${b.title || ""}</div>
      </div>`).join("");
  } catch (e) { /* keep the default decorative gradients on failure */ }
}

// --- Ratings: average + count for a book (small helper reused by reader/library) ---
export async function getBookRating(bookId) {
  try {
    const snap = await getDocs(query(collection(db, "ratings"), where("bookId", "==", bookId)));
    if (snap.empty) return { avg: 0, count: 0 };
    let total = 0;
    snap.forEach((d) => (total += d.data().value || 0));
    return { avg: total / snap.size, count: snap.size };
  } catch (e) { return { avg: 0, count: 0 }; }
}

// --- Library rendering (shared by index.html's small preview and library.html) ---
let allBooksCache = null;

export async function fetchPublishedBooks() {
  if (allBooksCache) return allBooksCache;
  const snap = await getDocs(query(collection(db, "books"), where("published", "==", true)));
  allBooksCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return allBooksCache;
}

export function bookCardHTML(b) {
  const cover = b.coverURL
    ? `style="background-image:url(${b.coverURL})"`
    : `style="background:linear-gradient(160deg, var(--lilac), var(--blush))"`;
  const badge = b.isPremiumBook ? `<span class="pill pill-gold" style="margin-bottom:6px;">Premium</span>` : "";
  return `
    <a class="book-card reveal" href="reader.html?id=${b.id}">
      <div class="book-cover" ${cover}></div>
      ${badge}
      <div class="book-title">${b.title || "Untitled"}</div>
      <div class="book-author">${b.author || "Unknown author"}</div>
    </a>`;
}

async function renderHomeLibraryPreview(user, profile) {
  const shelf = document.getElementById("library-shelf");
  if (!shelf) return;
  if (!user) {
    shelf.innerHTML = `<p class="field-hint"><a href="signup.html">Sign up</a> or <a href="login.html">log in</a> to browse the library.</p>`;
    return;
  }
  let books;
  try { books = await fetchPublishedBooks(); }
  catch (e) { shelf.innerHTML = `<p class="field-hint">Couldn't load the library right now.</p>`; return; }

  if (books.length === 0) {
    shelf.innerHTML = `<p class="field-hint" data-site="library-empty">The library is empty right now — once the admin uploads a book, it'll appear here.</p>`;
    return;
  }
  shelf.innerHTML = books.slice(0, 8).map(bookCardHTML).join("");
  revealOnScroll();

  const continueShelf = document.getElementById("continue-shelf");
  const continueSection = continueShelf?.closest("section");
  if (continueShelf) {
    const progress = profile?.readingProgress || {};
    const inProgress = books.filter((b) => progress[b.id]);
    if (inProgress.length === 0) { if (continueSection) continueSection.style.display = "none"; }
    else continueShelf.innerHTML = inProgress.map(bookCardHTML).join("");
  }
}

function revealOnScroll() {
  const items = document.querySelectorAll(".reveal:not(.revealed)");
  if (!("IntersectionObserver" in window) || items.length === 0) { items.forEach((el) => el.classList.add("revealed")); return; }
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("revealed"); obs.unobserve(entry.target); } });
  }, { threshold: 0.1 });
  items.forEach((el) => obs.observe(el));
}

export function requireAuth(onReady) {
  return watchAuth((user, profile) => {
    if (!user) { window.location.href = "login.html"; return; }
    if (profile?.accountStatus === "deactivated") { window.location.href = "account.html?reactivate=1"; return; }
    onReady(user, profile);
  });
}
export function requireAdmin(onReady) {
  return watchAuth((user, profile) => {
    if (!user || !profile?.isAdmin) { window.location.href = "index.html"; return; }
    onReady(user, profile);
  });
}

applySiteSettings();
setupMobileNav();
setupThemeSwitch();
watchAuth((user, profile) => {
  renderNav(user, profile);
  renderAds(profile);
  renderFeaturedHero();
  renderHomeLibraryPreview(user, profile);
  revealOnScroll();
});
