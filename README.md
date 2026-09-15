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
- `admin.html` + `js/admin.js` — upload/manage books, manage users & premium access, edit ads, handle account requests
- `contact.html` — WhatsApp / call / email to buy Premium
- `legal.html` — Terms, Privacy, Refunds starting draft
- `firestore.rules`, `storage.rules` — the real, permanent security rules (replace the ones currently in your Firebase project)

## 1. Deploy the security rules first
Your current Firestore/Realtime Database rules are wide open and expire
Oct 15, 2026. Before anything goes live:
1. Firebase Console → Firestore Database → Rules → paste in `firestore.rules` → Publish.
2. Firebase Console → Storage → Rules → paste in `storage.rules` → Publish.
3. You can leave Realtime Database alone if you're not using it (Ebook Canvas uses Firestore, not Realtime Database).

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
