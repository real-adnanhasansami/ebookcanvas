// ============================================================
// Ebook Canvas - shared site behavior
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

// --- Central premium-active check ---
// Use this everywhere instead of raw profile.isPremium.
// Lifetime plans never expire.
// Trial/Monthly plans expire at premiumExpiry.
// An expired plan is treated as Free.
export function isPremiumActive(profile) {
  if (!profile || !profile.isPremium) return false;
  if (profile.premiumPlan === "lifetime") return true;
  if (!profile.premiumExpiry) return false;
  return new Date(profile.premiumExpiry) > new Date();
}

// --- Theme: Light / Soft / Dark - one site-wide switcher, works on
// every page including the reader (which mirrors it onto the book
// pages too, via reader.js listening for "ec-theme-change"). ---
const THEME_ORDER = ["light", "soft", "dark"];
const THEME_ICONS = { light: "☀", soft: "◐", dark: "☾" };

function applySavedTheme() {
  const saved = localStorage.getItem("ec-theme") || "light";
  if (saved !== "light") document.documentElement.setAttribute("data-theme", saved);
}
function setupThemeSwitch() {
  // Admin page has the button pre-built in HTML; other pages need it injected.
  let btn = document.getElementById("theme-switch");
  if (!btn) {
    const actionsRow = document.querySelector(".site-nav .row") || document.querySelector(".reader-top .reader-tools");
    if (!actionsRow) return;
    btn = document.createElement("button");
    btn.id = "theme-switch";
    btn.className = actionsRow.classList.contains("reader-tools") ? "icon-btn" : "theme-switch";
    btn.title = "Theme: Light / Soft / Dark";
    if (actionsRow.classList.contains("reader-tools")) actionsRow.insertBefore(btn, actionsRow.firstElementChild);
    else actionsRow.insertBefore(btn, actionsRow.lastElementChild);
  }
  const current = document.documentElement.getAttribute("data-theme") || "light";
  btn.textContent = THEME_ICONS[current];

  btn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
    if (next === "light") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("ec-theme", next);
    btn.textContent = THEME_ICONS[next];
    window.dispatchEvent(new CustomEvent("ec-theme-change", { detail: next }));
  });
}
applySavedTheme();

// --- Site branding: logo, name, meta - editable from Admin → Site ---
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
  if (s.navHome) document.querySelectorAll("[data-site='nav-home']").forEach((el) => (el.textContent = s.navHome));
  if (s.navLibrary) document.querySelectorAll("[data-site='nav-library']").forEach((el) => (el.textContent = s.navLibrary));
  if (s.navPremium) document.querySelectorAll("[data-site='nav-premium']").forEach((el) => (el.textContent = s.navPremium));
  if (s.navAbout) document.querySelectorAll("[data-site='nav-about']").forEach((el) => (el.textContent = s.navAbout));

  // Logo doubles as the browser-tab favicon.
  if (s.logoURL) {
    let iconLink = document.querySelector('link[rel="icon"]');
    if (!iconLink) { iconLink = document.createElement("link"); iconLink.rel = "icon"; document.head.appendChild(iconLink); }
    iconLink.href = s.logoURL;
  }

  // Homepage promo banner
  const bannerSlot = document.getElementById("promo-banner-slot");
  if (bannerSlot) {
    if (s.bannerEnabled && s.bannerURL) {
      bannerSlot.innerHTML = s.bannerLink
        ? `<a class="promo-banner" href="${s.bannerLink}" target="_blank" rel="noopener"><img src="${s.bannerURL}" alt="Promotion" /></a>`
        : `<div class="promo-banner"><img src="${s.bannerURL}" alt="Promotion" /></div>`;
    } else {
      bannerSlot.innerHTML = "";
    }
  }
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
    topText: "Ebook Canvas Premium - ad-free, offline reading & audiobooks.",
    topLink: "contact.html",
    homeText: "Go Premium - remove ads and unlock every audiobook.",
    homeLink: "contact.html"
  };
  const isPremium = isPremiumActive(profile);

  if (topSlot) {
    if (isPremium || ads.enabled === false) topSlot.style.display = "none";
    else {
      topSlot.style.display = "flex";
      topSlot.classList.toggle("ad-marquee", !!ads.marquee);
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
    // Filter client-side from cached books — avoids Firestore composite index
    // requirement and auth issues for guest visitors.
    const books = await fetchPublishedBooks();
    const featured = books.filter((b) => b.featured).slice(0, 3);
    if (featured.length === 0) return;
    stack.innerHTML = featured.map((b, i) => `
      <div class="floating-cover c${i + 1}" style="${b.coverURL ? `background-image:url('${b.coverURL}');` : ""}background-color:var(--lilac); background-size:cover; background-position:center;">
        <div class="fc-title">${b.title || ""}</div>
      </div>`).join("");
  } catch (e) { console.error("Featured hero error:", e); }
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
  if (allBooksCache && allBooksCache.length > 0) return allBooksCache;
  try {
    const snap = await getDocs(query(collection(db, "books"), where("published", "==", true)));
    allBooksCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.log("Books loaded:", allBooksCache.length);
  } catch (e) {
    console.error("fetchPublishedBooks failed:", e);
    allBooksCache = null; // don't cache failures
    return [];
  }
  return allBooksCache;
}

export function bookCardHTML(b) {
  const cover = b.coverURL
    ? `style="background-image:url('${b.coverURL}')"` 
    : `style="background:linear-gradient(160deg,var(--lilac),var(--blush))"`;
  const badge = b.isPremiumBook ? `<span class="pill pill-gold" style="margin-bottom:6px;font-size:.72rem;">Premium</span>` : "";
  const price = b.isPremiumBook && b.price ? `<div class="book-price">৳${b.price}</div>` : "";
  return `<a class="book-card reveal" href="reader.html?id=${b.id}"><div class="book-cover" ${cover}></div>${badge}${price}<div class="book-title">${b.title || "Untitled"}</div><div class="book-author">${b.author || "Unknown author"}</div></a>`;
}

async function renderHomeLibraryPreview(user, profile) {
  const shelf = document.getElementById("library-shelf");
  if (!shelf) return;
  let books = [];
  try {
    books = await fetchPublishedBooks();
  } catch(e) {
    console.error("Home library error:", e);
    shelf.innerHTML = `<p class="field-hint">Could not load books.</p>`;
    return;
  }
  if (books.length === 0) {
    shelf.innerHTML = `<p class="field-hint" data-site="library-empty">The library is empty right now - once the admin uploads a book, it'll appear here.</p>`;
    return;
  }
  shelf.innerHTML = books.slice(0, 8).map(bookCardHTML).join("");
  // Force visible — scroll-reveal can miss items already in viewport
  shelf.querySelectorAll(".reveal").forEach((el) => el.classList.add("revealed"));
  if (!user) {
    shelf.querySelectorAll(".book-card").forEach((card) => {
      card.classList.add("guest-locked");
      card.addEventListener("click", (e) => { e.preventDefault(); window.location.href = "login.html"; });
    });
  }
  revealOnScroll();
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
  renderFeaturedHero(); // now allowed for guests too - see firestore.rules
  renderHomeLibraryPreview(user, profile);
  revealOnScroll();
});
