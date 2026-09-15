// ============================================================
// Ebook Canvas — shared site behavior
// Auth-aware nav, ad slots pulled from Firestore (admin-managed),
// small toast helper. Runs on every page via a module <script>.
// ============================================================
import { watchAuth, logOut } from "./auth.js";
import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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

// --- Nav: fill #nav-actions based on signed-in state ---------------
function renderNav(user, profile) {
  const slot = document.getElementById("nav-actions");
  if (!slot) return;

  if (!user) {
    slot.innerHTML = `
      <a class="btn btn-ghost" href="login.html">Log in</a>
      <a class="btn btn-primary" href="signup.html">Sign up</a>`;
    return;
  }

  const adminLink = profile?.isAdmin ? `<a href="admin.html" class="muted-link">Admin</a>` : "";
  slot.innerHTML = `
    ${adminLink}
    <a href="account.html" class="muted-link">${(profile?.displayName || user.email || "Account").split("@")[0]}</a>
    <button class="btn btn-ghost" id="nav-logout">Log out</button>`;

  document.getElementById("nav-logout")?.addEventListener("click", async () => {
    await logOut();
    toast("Logged out");
    setTimeout(() => (window.location.href = "index.html"), 500);
  });
}

// --- Ads: pulled from Firestore doc site/ads, editable from admin --
async function renderAds(profile) {
  const topSlot = document.querySelector("[data-ad='top']");
  const homeSlot = document.querySelector("[data-ad='home']");
  if (!topSlot && !homeSlot) return;

  let ads;
  try {
    const snap = await getDoc(doc(db, "site", "ads"));
    ads = snap.exists() ? snap.data() : null;
  } catch (e) {
    ads = null;
  }

  // Fallback so the layout still shows something sensible before
  // the admin has configured real ad content.
  ads = ads || {
    enabled: true,
    topText: "Ebook Canvas Premium — ad-free, offline reading & audiobooks.",
    topLink: "contact.html",
    homeText: "Go Premium — remove ads and unlock every audiobook.",
    homeLink: "contact.html"
  };

  const isPremium = !!profile?.isPremium;

  if (topSlot) {
    // Premium users never see the top ad. Free users lose it only
    // while in fullscreen focus mode (handled in reader.js), so on
    // ordinary pages it always shows for free/signed-out visitors.
    if (isPremium || ads.enabled === false) {
      topSlot.style.display = "none";
    } else {
      topSlot.style.display = "flex";
      topSlot.innerHTML = `
        <span class="ad-label">Sponsored</span>
        <a href="${ads.topLink || '#'}" style="flex:1; text-align:center; font-size:.88rem;">${ads.topText}</a>
        <span class="ad-label">Ad</span>`;
    }
  }

  if (homeSlot) {
    if (ads.enabled === false) {
      homeSlot.style.display = "none";
    } else if (isPremium) {
      // Premium users don't get the homepage ad either.
      homeSlot.style.display = "none";
    } else {
      homeSlot.style.display = "flex";
      homeSlot.innerHTML = `
        <span class="ad-label">Sponsored</span>
        <a href="${ads.homeLink || '#'}" style="flex:1; text-align:center; font-size:.9rem;">${ads.homeText}</a>
        <span class="ad-label">Ad</span>`;
    }
  }
}

export function requireAuth(onReady) {
  return watchAuth((user, profile) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    if (profile?.accountStatus === "deactivated") {
      window.location.href = "account.html?reactivate=1";
      return;
    }
    onReady(user, profile);
  });
}

export function requireAdmin(onReady) {
  return watchAuth((user, profile) => {
    if (!user || !profile?.isAdmin) {
      window.location.href = "index.html";
      return;
    }
    onReady(user, profile);
  });
}

// Fires on every page load automatically.
watchAuth((user, profile) => {
  renderNav(user, profile);
  renderAds(profile);
});
