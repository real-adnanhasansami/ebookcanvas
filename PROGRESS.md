# Ebook Canvas — PROGRESS.md
# Use this file to resume work in a new conversation.
# Attach the latest ZIP + this file and say: "Continue from PROGRESS.md"

---

## App Overview

Ebook Canvas is a web-based digital library where the admin uploads PDF books and readers get a real page-turning experience using StPageFlip (drag-to-turn with curl animation). Readers can browse a library, read books online, take notes, set reading timers, search inside books, rate and comment on books, and save books to their profile (Premium only). Monetization is manual — users pay via bKash and the admin activates Premium from the admin panel. The site is a purely static HTML/CSS/JS app with no build step, deployed directly to Vercel.

- **Live URL:** https://ebookcanvas.vercel.app
- **GitHub Repo:** https://github.com/real-adnanhasansami/ebookcanvas
- **Owner contact:** 01319233580 (WhatsApp/Call), dreamcanvasagency@gmail.com
- **Owner personal site:** https://adnanhasansami.vercel.app

---

## Tech Stack

| Layer | Tool | Why |
|---|---|---|
| Frontend | Pure HTML + CSS + JS ES Modules | No build step, deploy directly |
| Auth + Database | Firebase (Firestore + Auth) | Free tier, no backend needed |
| File Storage | Cloudinary | Firebase Storage requires paid plan since Feb 2026 |
| Hosting | Vercel | Free static hosting, auto-deploy from GitHub |
| PDF Rendering | pdf.js (CDN) | Render PDF pages as canvas images |
| Page Flip | StPageFlip (CDN) | Real curl/drag page-turn animation |
| PDF Creation | pdf-lib (CDN) | Notes download as PDF |

---

## Environment & Setup

**No .env file needed.** This is a fully static site. All config is hardcoded in JS files (safe — security is enforced by Firestore Rules, not by hiding config).

**Firebase config** — in `js/firebase-config.js`:
- `apiKey`: AIzaSyB0VNDLZdRjWzGb5f4V5MykAmC73KnxWBw
- `authDomain`: ebookcanvas.firebaseapp.com
- `projectId`: ebookcanvas
- `storageBucket`: ebookcanvas.firebasestorage.app
- `messagingSenderId`: 415991502433
- `appId`: 1:415991502433:web:4edab46d1a22fe3b4a7c20
- `measurementId`: G-ZEC2LXEQ8K

**Cloudinary config** — in `js/admin.js`:
- `CLOUDINARY_CLOUD_NAME`: cul4wkkt
- `CLOUDINARY_UPLOAD_PRESET`: ebookcanvas_books (must be Unsigned, Resource type: Raw)

**Deploy steps:**
1. Push folder to GitHub (no npm install, no build command)
2. Vercel → New Project → Framework: Other → Deploy
3. Firebase Console → Firestore → Rules → paste `firestore.rules` → Publish
4. Sign up on live site → Firebase Console → Firestore → `users/{uid}` → set `isAdmin: true`
5. Cloudinary → Settings → Upload → `ebookcanvas_books` → Edit → Resource type: Raw → Save

**Known setup issue:**
- Cloudinary upload fails if preset Resource type is not set to "Raw". The error appears in browser Console (F12). Fix: set Resource type = Raw in Cloudinary dashboard.

---

## Architecture

```
ebook-canvas/
├── index.html            Homepage (hero, library preview, featured books, ads)
├── library.html          Full library (search, filter by genre, sort)
├── reader.html           Book reader (StPageFlip, notes, timer, search, zoom)
├── login.html            Login (Email/Password + Google)
├── signup.html           Signup + email verification
├── forgot-password.html  Password reset
├── account.html          Profile, subscription status, saved books
├── contact.html          Premium page — bKash payment + TrxID form
├── legal.html            Terms, Privacy, Refunds, About
├── admin.html            Admin panel (all management tabs)
├── 404.html              Styled error page
├── css/
│   └── style.css         All styles (~506 lines, clean rewrite)
├── js/
│   ├── firebase-config.js   Firebase init (app, auth, db)
│   ├── auth.js              Auth helpers (signup, login, Google, reset)
│   ├── main.js              Shared: nav, theme switcher, ads, library render
│   ├── reader.js            Reader: flipbook, notes, timer, comments, search
│   └── admin.js             Admin panel all tabs
├── firestore.rules       Paste in Firebase Console → Firestore → Rules
├── manifest.json         PWA manifest (mobile install)
├── sw.js                 Service worker (offline shell)
├── PROGRESS.md           This file
└── README.md             Deployment guide
```

**How things connect:**
- Every page imports `js/main.js` → auto-runs theme, nav, ads, branding
- `watchAuth()` in `auth.js` tracks login state throughout
- `fetchPublishedBooks()` in `main.js` queries Firestore, caches result
- Reader page: pdf.js fetches PDF from Cloudinary URL (stored in Firestore) → StPageFlip renders pages as canvas images
- Admin uploads: pdf-lib compresses → pdf.js generates cover thumbnail → both uploaded to Cloudinary → URL saved in Firestore `books` collection
- Premium: user pays bKash → submits TrxID form → lands in `subscriptionRequests` → admin approves → sets `isPremium: true` + plan + expiry in Firestore

---

## Firestore Collections

| Collection | Purpose | Who reads/writes |
|---|---|---|
| `users` | Profile, isPremium, premiumPlan, premiumExpiry, purchasedBooks | Owner reads own, admin reads all, only admin writes premium fields |
| `books` | title, author, genre, fileURL, coverURL, isPremiumBook, paidOnly, price, featured, readCount | Anyone reads published, admin writes |
| `site/ads` | Top banner + homepage ad content, marquee toggle | Anyone reads, admin writes |
| `site/settings` | Logo URL, site name, nav labels, hero text, banner, flip sound URL | Anyone reads, admin writes |
| `comments` | Reader comments per book, likes, dislikes, reported flag | Signed-in reads/creates, admin deletes |
| `commentReactions` | Per-user like/dislike vote tracking | Owner reads/writes own |
| `ratings` | Star ratings (1-5) per book per user | Signed-in reads/writes |
| `notes` | Per-user per-book notes text, autosaved | Owner only |
| `downloads` | Books saved by Premium users (online only, no PC download) | Owner reads/writes own, admin reads |
| `subscriptionRequests` | bKash TrxID payment requests | Anyone creates, admin reads/updates |
| `bookPurchaseRequests` | Requests to buy a specific paid-only book | Signed-in creates, admin approves |
| `accountRequests` | Deactivation / deletion requests | Owner creates, admin resolves |

---

## Premium / Access Logic

```
isPremiumActive(profile):
  = profile.isPremium === true
  AND (premiumPlan === "lifetime" OR new Date(premiumExpiry) > new Date())

Book access:
  Free book        → any signed-in user
  Premium book     → isPremiumActive OR bookId in purchasedBooks
  Paid-only book   → bookId in purchasedBooks ONLY (Premium subscription alone not enough)
  Preview (1-5pp)  → anyone, even non-Premium

Save book (Downloads) → isPremiumActive only
  → saves to Firestore `downloads` collection
  → NO PC download (view-only on the website)

Plans:
  Trial    → ৳30, 30 days (premiumExpiry = now + 30 days)
  Monthly  → ৳50, 30 days (premiumExpiry = now + 30 days)
  Lifetime → ৳500, no expiry (premiumPlan = "lifetime", premiumExpiry = null)
```

---

## Admin Panel Tabs

| Tab | What it does |
|---|---|
| Dashboard | Books count, users count, premium count, pending subscription requests |
| Books | Upload PDF (auto-compress + auto-cover), set price, free/premium/paid-only/featured toggle, publish/unpublish/delete |
| Users | Grant plan (Trial/Monthly/Lifetime/Free), grant specific book to a user |
| Subscription requests | View bKash TrxID submissions, mark as contacted |
| Book purchase requests | Approve request → adds bookId to user's purchasedBooks |
| Comments | View all comments across all books, remove spam/abuse |
| Ads | Top banner + homepage ad text/link, marquee scroll toggle |
| Site editor | Logo upload, site name, nav labels, hero text, footer tagline, homepage banner image, page-flip sound upload |
| Account requests | View delete/deactivate requests, mark as resolved |

---

## Fixed Bugs

| Bug | What was wrong | How fixed |
|---|---|---|
| Library books invisible | `.reveal` CSS starts opacity:0 but `revealOnScroll()` was never triggered on library.html | Force `.revealed` class immediately after `innerHTML` set |
| Books go black in dark mode | `color-scheme: dark` on `<html>` made browser invert the flipbook canvas | Removed global color-scheme; `color-scheme: light !important` + `filter: none !important` on `#flipbook-wrap` and all children |
| main.js crash — whole site broken | Stray extra `}` brace at the end of `renderHomeLibraryPreview` made entire main.js invalid | Removed the stray brace |
| Featured books only showing for admin | Query used `where("featured","==",true)` which requires a Firestore composite index (not created) | Switched to client-side filter on already-fetched books array |
| Timer invisible in fullscreen | CSS selector `.reader-shell:fullscreen .reader-shell.timer-active` is impossible (shell IS the fullscreen element) | Fixed to `.reader-shell:fullscreen .focus-timer { display:block !important }` |
| Comments not loading | `orderBy("createdAt")` in query requires a composite Firestore index that wasn't created | Removed `orderBy`, sort client-side by `createdAt.seconds` |
| Like/dislike spammable | No per-user tracking, every click incremented counter | Added `commentReactions` Firestore collection, toggle behavior (click again to undo) |
| Preview page 2 blank | StPageFlip shows 2 pages side by side, but only page 1 was pre-rendered before init | Pre-render pages 1 and 2 synchronously before `pageFlip.loadFromImages()` |
| Preview pages 3-5 white after flipping | `openBook()` in reader.js only pre-rendered 2 pages (`startPage`, `startPage+1`) synchronously. Pages 3-5 were left as placeholder canvases and only filled in by `renderRemainingPages()` running in the background with a `setTimeout(...,0)` yield between each page. Flipping quickly through the 5-page preview outran that background render, so pages 3-5 showed blank/white. | In `openBook()`, replaced the 2-page sync render with a loop that renders `Math.min(4, totalPages - startPage + 1)` pages synchronously (i.e. pages 1-4 relative to `startPage`) before `initFlipbook()`/`loadFromImages()` runs. Only the pages beyond that (page 5 in a 5-page preview) are left to `renderRemainingPages()`, which is now called with the actual list of already-rendered page numbers (`syncPages`) instead of the old 2-item `[startPage, nextPage]` array. |
| Dashboard stats empty | Only `loadBooks()` ran on admin init, user/subscription counts never fetched | Added `loadDashboardStats()` on init, fetches users + subscriptionRequests |
| Cloudinary upload failing | `resource_type` not sent in FormData (only in URL), Cloudinary rejected PDF | Added `form.append("resource_type", resourceType)` explicitly |
| `fetchPublishedBooks` cached empty array permanently | On Firestore error, cached `[]` so library never retried | Only cache on success; return `[]` on error without caching, retry on next call |
| Duplicate `main.js` import on login/signup/account pages | `main.js` injected twice → theme button doubled, nav doubled | Removed duplicate script tags |
| `statusEl` null crash in reader | `statusEl` assigned at top-level before DOM ready | Changed to `let statusEl = null` + assigned in `DOMContentLoaded` |
| `renderRemainingPages` called with array but expected single value | Function signature was `(skipPage)` but called with `[1, 2]` | Updated to `const skip = Array.isArray(skipPage) ? skipPage : [skipPage]` |
| Notes `persistNotes` param name shadowed global `statusEl` | Parameter named `statusEl` shadowed the global variable, caused confusion | Renamed parameter to `statusDisplay` |
| Flipbook size scrambled after exiting fullscreen | The `fullscreenchange` handler called `reinitFlipbookForCurrentSize()`, a separate code path from the one used for window resize. It measured `stage.clientWidth/clientHeight` after a single fixed `setTimeout(…, 200)`, computed a size, then just called `pageFlip.loadFromImages(pageImages)` again — it never called `pageFlip.update()`. Two problems compounded: (1) 200ms wasn't reliably enough time for the `:fullscreen` CSS rules to finish applying and for the `reader-stage` to settle into its exited-fullscreen size before it was measured, so the size calc could run against stale, mid-transition layout values; (2) reloading images doesn't make StPageFlip's "stretch" layout re-measure its container the way `.update()` does, so even a correct size calc didn't always reach the book. A second fullscreen toggle "fixed" it because by then the stage had settled from the *first* transition, so the (still 200ms-delayed) measurement on the second toggle happened to land on a stable layout. | Replaced the divergent fullscreen-resize path with the same sizing logic the window-resize handler already uses correctly. The `calcSize()` closure inside `initFlipbook()` (which sets `#flipbook-wrap`'s width/height from the live `reader-stage` dimensions) is now saved to a module-level `calcFlipbookSize` variable so it can be reused outside `initFlipbook()`. `reinitFlipbookForCurrentSize()` (called from the `fullscreenchange` listener, on both enter and exit) now waits two nested `requestAnimationFrame` callbacks instead of a fixed timeout — so it runs right after the browser has painted the post-transition layout, not on a guessed delay — then calls `calcFlipbookSize()` followed by `pageFlip.update()`, exactly like the resize handler does. |
| Email button in contact.html redirects incorrectly | On inspection, `contact.html`'s Email link already read `href="mailto:dreamcanvasagency@gmail.com?subject=Ebook%20Canvas%20Support" target="_blank" rel="noopener"` — exactly the expected markup. No `mailto:` link anywhere else in the codebase was broken either. This looks like a tracking entry that was already resolved (or never actually broken) rather than a live bug; flagging it here since no code change was needed or made. | No code change required — verified the existing markup already matches the expected `href`/`target` exactly. |
| Book purchase flow incomplete on contact.html | The Premium page only had the subscription (bKash TrxID) form. There was no way to request a specific book — `bookPurchaseRequests` (which the admin panel's "Book purchase requests" tab already reads) could only be created from inside `reader.html` when viewing a gated book, not from the Premium page itself. | Added a "Buy a specific book" card to `contact.html`. On load it calls `fetchPublishedBooks()` (from `main.js`) and filters to `isPremiumBook` titles to populate a `<select>`. `watchAuth()` (from `auth.js`) tracks the signed-in user; the submit button stays disabled with a "please log in" hint until both the books have loaded and a user is signed in. Submitting writes a `bookPurchaseRequests` doc with the same shape `reader.html` already uses (`bookId, bookTitle, uid, email, status: "pending", createdAt`), so it shows up in Admin → Book purchase requests without any admin-side changes. |
| Premium badge not showing on account.html | The Subscription card only put a plain `<span class="pill pill-gold">Premium</span>` (always just the word "Premium", never the actual plan) inline in a sentence — the plan name and expiry date were rendered as ordinary paragraph text, not as a distinct visual badge. | Added a `#premium-badge-wrap` element above the subscription text and new `.premium-badge` / `.premium-badge-{trial,monthly,lifetime,expired,free}` CSS classes (in `css/style.css`) with distinct colors per plan tier. The `watchAuth` callback in `account.html` now renders a badge showing the actual plan name (Trial/Monthly/Lifetime) plus its expiry ("Never expires" for lifetime, a formatted date otherwise), or an "Expired"/"Free plan" badge when not on an active plan. |
| Missing `toast` import in account.html | `account.html`'s inline module script called `toast(...)` in five places (profile save, deactivate, reactivate, delete-account request, remove-download) but never imported it. `toast` is only exported from `js/main.js`; the page separately loads `js/main.js` as a `<script type="module" src="js/main.js">` for its side effects (nav rendering), but that doesn't put `toast` in scope for the *other*, inline module script — each `<script type="module">` has its own top-level scope, so importing a name in one doesn't expose it to another. Every one of those five calls would throw `ReferenceError: toast is not defined` at runtime. | Added `import { toast } from "./js/main.js";` to account.html's inline module script, alongside its existing `auth.js`/`firebase-config.js` imports. ES modules are cached by URL, so this doesn't cause `main.js` to execute twice — it just brings `toast` into this script's scope. |
| Reader layout/controls unreachable on narrow phones | `.reader-top .reader-tools` held all 6 icon buttons (search, zoom out, zoom in, notes, timer, fullscreen) in a `flex-shrink:0` row with no wrapping and no horizontal scroll. On phones around 320-375px wide, back-button + title + 6 buttons didn't fit the available width; since nothing in the row was allowed to shrink or scroll, the rightmost buttons (fullscreen, timer) were pushed outside the viewport and became untappable. This was made worse by a same-specificity CSS conflict: `@media(max-width:480px){ .icon-btn{width:32px;...} }` was defined *before* `@media(pointer:coarse){ .icon-btn{width:42px;...} }` in the stylesheet, so on an actual small touch phone (which matches both conditions) the later, larger 42px rule won the cascade instead of the smaller 32px one intended for narrow screens — making the overflow worse on exactly the devices most affected. | In `css/style.css`: `.reader-tools` now scrolls horizontally (`overflow-x:auto`, hidden scrollbar, `max-width:56vw`) instead of forcing the row to overflow the page, so every button stays reachable by a swipe even when they don't all fit at once. Reduced `.reader-top`/`.reader-stage`/`.reader-bottom` padding and the title's max-width slightly on mobile to free up room. Added a new `@media(max-width:480px)` block *after* the existing `@media(pointer:coarse)` block, specifically targeting `.reader-top .icon-btn`/`.reader-bottom .icon-btn` at 34px — placed there on purpose so it wins the cascade on small touch phones instead of the 42px pointer:coarse size. No JS changes were needed: `reader.js`'s existing `calcSize()`/`pageFlip.update()` resize logic reads live container dimensions, so it automatically picks up the extra room from the CSS changes, and `mobileScrollSupport: true` (already set) continues to handle swipe/touch page-turning. |

---

## Open Bugs / Tasks

| # | Priority | Where | What's broken | Expected |
|---|---|---|---|---|
| 1 | MEDIUM | All pages | Bangla characters sometimes render as boxes or wrong font. | Hind Siliguri / Noto Serif Bengali applied consistently |
| 2 | MEDIUM | reader.html | Voice/audio bar still appears briefly then disappears. | Remove all audio/voice code permanently from reader.js |
| 3 | MEDIUM | homepage | Cover thumbnails not showing in homepage featured section. | Auto-generated cover from PDF page 1 should show |
| 4 | LOW | manifest.json | icon-192.png and icon-512.png missing → PWA install broken | Upload icons to project root |
| 5 | LOW | mobile | No swipe gesture for page turn on mobile | Swipe left/right flips pages using StPageFlip touch support |
| 6 | LOW | library.html | No rokomari-style genre sections | Books grouped by genre in horizontal scroll rows |

---

## Next Steps (priority order)

1. **Fix Bangla font** — add `<link rel="preconnect" href="https://fonts.googleapis.com">` and `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` before the @import, test with real Bangla titles
2. **Permanently remove all audio/voice code** from reader.js and reader.html
3. **Fix cover thumbnail** on homepage — ensure `coverURL` is properly set in Firestore after upload
4. **Create PWA icons** — 192x192 and 512x512 PNG versions of the logo
5. **Mobile swipe** — set `mobileScrollSupport: true` in StPageFlip config, test on real device

---

## AI Handoff Notes — IMPORTANT

**This is a static site. No Node.js, no npm, no build step.**
All JS runs as ES Modules directly in the browser. Do NOT suggest React, Vite, webpack, or any bundler.

**Every page must import main.js:**
```html
<script type="module" src="js/main.js"></script>
```
main.js auto-runs: theme, nav, ads, site branding. Missing this = broken nav + theme.

**Reader.js is the most fragile file.**
One stray `}` previously broke the entire site. Always run `node --check js/reader.js` after editing.

**Firestore rules must be manually pasted in Firebase Console.**
Editing `firestore.rules` in the ZIP does NOT auto-update Firebase. The human must copy-paste it.

**The `.reveal` CSS class starts invisible.**
Any shelf/grid that uses `bookCardHTML()` must either:
- Call `revealOnScroll()` after setting innerHTML, OR
- Force `.revealed` class: `shelf.querySelectorAll(".reveal").forEach(el => el.classList.add("revealed"))`
Library page uses the force method. Homepage uses `revealOnScroll()`.

**`fetchPublishedBooks()` caches results.**
If called on a page where Firestore rules aren't published yet, it may cache an empty array and never retry. Solution: return `null` on error (not `[]`) so next call retries.

**StPageFlip shows 2 pages side by side on desktop.**
When opening a book, pre-render at minimum 4 pages (pages 1-4 relative to the start page) synchronously before calling `pageFlip.loadFromImages()`. 2 pages is enough for the initial spread but not enough to survive a fast flip through a short preview — pages beyond what's pre-rendered stay on the white placeholder canvas until the background loop in `renderRemainingPages()` catches up, which is easy to outrun by flipping quickly.

**Theme system: 3 states — Light / Soft / Dark.**
Stored in `localStorage` as `ec-theme`. Applied as `data-theme` attribute on `<html>`. The flipbook/book pages must NEVER be affected by theme — `#flipbook-wrap` has `filter: none !important` and `color-scheme: light !important`.

**Admin is set manually in Firestore.**
No code path allows a user to grant themselves admin. After deploy, go to Firebase Console → Firestore → `users/{uid}` → set `isAdmin: true` manually.

**isPremiumActive() must be used everywhere — not raw `profile.isPremium`.**
The function checks plan type AND expiry date. Raw `isPremium: true` alone is not sufficient for access decisions.

**Cloudinary upload preset must be "Unsigned" + Resource type "Raw".**
If not set to Raw, PDF uploads fail with a 400 error. The error message now shows in the browser console and as a toast.
