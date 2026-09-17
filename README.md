# Ebook Canvas

A calm, dreamcore-styled reading platform: upload a PDF, readers get a real
page-turning book with focus mode, an audiobook mode, and an admin panel
you fully control.

This is a **static site** (plain HTML/CSS/JS modules) — no build step, no
`npm install` required, so it deploys to Vercel as-is.

## What's included
- `index.html` — homepage, bookshelf, ad slots
- `login.html`, `signup.html`, `forgot-password.html` — auth (Google + email/password)
- `account.html` — profile edit, deactivate/reactivate, request deletion
- `reader.html` + `js/reader.js` — the page-flip reader, focus mode, reading timer, audiobook (browser text-to-speech, free)
- `admin.html` + `js/admin.js` — upload/manage books (files go to Cloudinary), manage users & premium access, edit ads, handle account requests
- `contact.html` — WhatsApp / call / email to buy Premium
- `legal.html` — Terms, Privacy, Refunds starting draft
- `firestore.rules` — the real, permanent security rules (replace the ones currently in your Firebase project)

## This round: real bug fixes + a big feature pass
- **Fixed: flipbook wasn't rendering/flipping properly.** The container it mounts into had no defined size in CSS, so the library effectively had nothing to attach to. Fixed.
- **Fixed: covers sometimes missing.** The auto-generated cover thumbnail ran in the background without being awaited, so clicking "Add to library" quickly could publish before the cover was ready. The publish button now waits for it and shows "Preparing…".
- **Real page-turn sound** — synthesized with the Web Audio API on every flip (no audio file, no cost).
- **Site-wide dark/light mode** — a real toggle in the nav now, not just the reading light inside the book. Persists per browser.
- **Dedicated Library page** (`library.html`) — search by title/author, filter by genre, sort by Newest/Trending/Top rated. The homepage now shows a small preview with a "Browse the full library" link.
- **Featured/bestseller books on the homepage hero** — mark a book "Feature on homepage" in Admin → Books and its real cover replaces the placeholder gradients (up to 3).
- **Star ratings** — readers can rate a book 1–5 on the reader page; the average shows there and can sort the Library.
- **Comment likes** — a 👍 button with a count (see the honest caveat below).
- **Bangla font support** — added Hind Siliguri / Noto Serif Bengali as fallbacks, so Bangla text in comments, the site UI, etc. renders properly instead of broken/boxy glyphs.
- **Voice picker now grouped by language** (English / বাংলা), with a free voice and a Premium-gated second voice per language where the device has more than one.
- **Expanded Site editor**: footer tagline and the empty-library message are now editable too.
- **Admin → Books**: added Genre (optional, powers Library filters) and "Feature on homepage".

### Two things told straight, because you'd find out anyway
- **The realistic curl effect (StPageFlip) means every page is now a rendered image of the real PDF page**, not reflowable text. This is what makes the drag-to-turn animation and the "looks like a real book" feel possible, and it also fixes the scanned-PDF blank-page issue for good — every page always shows correctly now, no exceptions. The trade-off: text no longer reflows to a chosen font size, since a curling page has to be a picture. Text is still extracted separately, silently, in the background — purely to feed the audiobook voice.
- **Voice quality has a real ceiling without a paid API.** What "Free" vs "Premium" voice means here is picking between whatever voices your browser/OS actually has installed — there's no way to make a free browser voice sound like a studio narrator. If a device has no Bangla voice installed at all (common on many phones/browsers), the picker says so rather than pretending. A genuinely great-sounding Bangla or English narrator voice means a paid TTS API (Google Cloud TTS, Amazon Polly, ElevenLabs, etc.), billed per character — a real cost that conflicts with the "completely free" goal, so it's not wired in by default. Happy to add it later if/when you're OK with that cost.
- **Comment likes aren't capped per person** — the counter just increments; it doesn't stop someone from clicking it five times. A proper one-like-per-user system is a small follow-up if it matters.
- **Ratings are computed by reading every rating document for a book each time** (no running average stored). Totally fine at your current scale; if a book gets thousands of ratings someday, that read pattern would want revisiting.

## What's new in this update
- **Library actually loads now** — this was a real bug (the homepage never queried Firestore for books). Fixed.
- **Free vs Premium books** — set per book in Admin → Books. Premium books show a paywall prompt with an upgrade link for non-Premium readers.
- **Admin → Users** now lets you pick a plan (Free / Trial / Monthly / Lifetime) before granting — Trial and Monthly set a 30-day expiry, Lifetime never expires.
- **Admin → Subscription requests** — the Premium page now has a request form (name, email, phone, plan); submissions land here for you to review and confirm manually.
- **Admin → Comments** — readers can comment on a book from the reader page; this tab lists every comment so you can remove spam or anything against your guidelines. Readers can also "Report" a comment from the reader page.
- **Admin → Site editor** — instead of a separate `admin2.html`, this is a new tab in the same panel: site name, logo (uploaded to Cloudinary), homepage headline/subheading, and the meta description used for SEO/link previews. This updates every page's nav logo/name live.
- **Library filters** (All / Newest / Trending) on the homepage, backed by a `readCount` that increments each time a book is opened.
- **Mobile nav** — a hamburger menu now appears on small screens (the nav links were simply hidden before, with no way to open them).
- **Scroll-reveal animation** on book cards, and a visual refresh of the ad slots and Premium page.

## Known limitations, told straight
- **Premium gating is a UI-level gate, not real DRM.** Book files live at a public Cloudinary URL so pdf.js can load them. The reader page checks `isPremium` before showing that URL, and Firestore rules require sign-in to even read a book's data — but a technically determined signed-in user could still find the direct file URL through browser dev tools. Real DRM would need a backend that issues short-lived signed URLs, which isn't possible on a pure static-site setup. Fine for a real-world soft paywall; not bulletproof against a motivated pirate.
- **First-time Firestore index prompt**: the comments-per-book query (used on the reader page) needs a composite index. The first time it runs, check your browser console — Firebase logs a direct link that creates the index for you in one click. After that it's instant.
- **Subscription request form accepts submissions from anyone**, signed in or not (so people can request Premium before creating an account) — this also means it isn't spam-protected. If spam becomes a problem, add a simple honeypot field or Firebase App Check later.

## 1. Deploy the security rules first
Your current Firestore/Realtime Database rules are wide open and expire
Oct 15, 2026. Before anything goes live:
1. Firebase Console → Firestore Database → Rules → paste in `firestore.rules` → Publish.
2. You can leave Realtime Database alone if you're not using it (Ebook Canvas uses Firestore, not Realtime Database).

## 1b. Set up Cloudinary for book files
Firebase Storage now requires the paid Blaze plan even for small usage
(this changed Feb 3, 2026), so book PDFs are stored on **Cloudinary**
instead — free, no card required.
1. Sign up at cloudinary.com → your **Cloud Name** is shown on the dashboard.
2. Settings → Upload → Add upload preset → Signing Mode: **Unsigned** → name it something like `ebookcanvas_books` → Save.
3. Open `js/admin.js` and fill in `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_UPLOAD_PRESET` with those two values.
4. Note: an unsigned preset is convenient for a no-backend admin panel, but anyone who finds the preset name could technically upload files to your account. Fine for a single-admin MVP; if that ever matters, move uploads behind a small signed backend later.

## 2. Make yourself the first admin
No one is an admin by default (this is intentional — a user can never
grant themself access). After you sign up once on the live site:
1. Firebase Console → Firestore → `users` collection → find your document (matches your uid).
2. Edit the field `isAdmin` → set it to `true` (boolean).
3. Reload the site — you'll now see an **Admin** link in the nav.

## 3. Enable the sign-in methods you're using
Firebase Console → Authentication → Sign-in method → make sure **Google**
and **Email/Password** are enabled (you already have this set). Phone auth
is intentionally left off, since it requires the paid Blaze plan.

## 4. Deploy to Vercel
Since payments are involved (even manual ones), Vercel's free Hobby plan
isn't eligible — its terms restrict Hobby to non-commercial projects.
You'll want the Pro plan before going live with real subscribers. To deploy:
1. Push this folder to a GitHub repo.
2. Vercel → New Project → import the repo → Framework Preset: **Other** (static) → Deploy.
3. No environment variables needed — the Firebase config is safe to ship in client code (it's not a secret; your security rules are what actually protect data).

## About the "PDF shrinks to 1-2 KB" idea
Real compression (stripping metadata, re-encoding streams) typically saves
10–40% depending on the file — the admin upload flow does this
automatically and shows you the before/after size. A 2MB PDF becoming a
few KB isn't possible without deleting content, so that specific number
was adjusted to something real.

## Honest scope notes for this first version
- **Ads**: fully admin-editable (text + link) for the top banner and homepage slot; hidden automatically for Premium users, and the top banner also hides when a reader enters fullscreen in the book reader.
- **Audiobook**: uses the browser's built-in speech synthesis (100% free, works offline-ish, quality varies by device/browser). A higher-quality cloud voice can be added later but costs per character.
- **Page-flip**: a real animated flip, page-by-page, extracting each page's text from the PDF live with pdf.js. For image-heavy PDFs (comics, scanned books), a canvas-rendering mode can be added later.
- **Admin analytics**: the dashboard shows the core numbers (books, users, premium count, pending requests). Deeper analytics (drop-off pages, most-read books) is a natural next step once there's real usage to measure.
- **Account deletion**: intentionally manual — a request is logged in `accountRequests`, you confirm with the user, then delete their Firebase Auth account from the console and their Firestore doc from the admin panel.
