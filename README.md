# Ebook Canvas — Deployment Guide

A calm, dreamcore-styled reading platform.
Stack: Pure HTML/CSS/JS · Firebase Auth + Firestore · Cloudinary · Vercel · GitHub

---

## 1. Firebase Setup

1. Go to console.firebase.google.com → your project: **ebookcanvas**
2. Authentication → Sign-in method → Enable **Google** and **Email/Password**. Leave Phone OFF.
3. Firestore Database → Create database (Production mode)
4. Firestore → Rules → paste the full content of `firestore.rules` → Publish

## 2. Firestore Collections

These are created automatically as data is written. No manual setup needed:
- users · books · comments · ratings · notes
- subscriptionRequests · bookPurchaseRequests · accountRequests
- site/ads · site/settings

## 3. Cloudinary Setup

1. Sign up at cloudinary.com (free, no card needed)
2. Dashboard → note your **Cloud Name**: `cul4wkkt`
3. Settings → Upload → Add upload preset:
   - Name: `ebookcanvas_books`
   - Signing Mode: **Unsigned**
   - Save

## 4. Vercel Setup

1. Push the project folder to a GitHub repo
2. Vercel → New Project → import the repo
3. Framework Preset: **Other** (no build step)
4. Deploy

## 5. Making Yourself Admin

After the site is live:
1. Sign up on the live site with your email
2. Firebase Console → Firestore → `users` collection → find your document
3. Edit field `isAdmin` → set to `true` (boolean)
4. Reload the site → Admin link appears in nav

## 6. Uploading a Book

Admin panel → Books tab:
- Upload PDF → auto-compressed + auto-cover generated
- Set title, author, genre, price (if premium)
- Choose Free / Premium / Paid-only
- Check "Feature on homepage" for up to 3 bestsellers
- Click "Add to library"

## 7. How Premium Works

Manual payment via bKash (01319233580):
- User pays → sends TrxID via contact form
- Admin sees request in Admin → Subscription Requests
- Admin verifies TrxID → goes to Admin → Users → selects Trial/Monthly/Lifetime → Apply

Plans:
- Trial: ৳30 / 30 days
- Monthly: ৳50 / 30 days  
- Lifetime: ৳500 / never expires

Expired Trial/Monthly = automatically treated as Free (checked on every page load).

## 8. Paid-Only Books

A "Paid-only" book is NOT unlocked by a general Premium subscription.
Only specific purchase or explicit Admin grant unlocks it.

Admin → Users → find user → click "+ Book" → type book title to grant.

## 9. Site Editor

Admin → Site Editor:
- Logo (uploaded to Cloudinary, also becomes browser tab favicon)
- Site name, nav labels, hero text, footer tagline
- Homepage promo banner (image + link + on/off)
- Page-flip sound (upload mp3/wav)
- Meta title + description

## 10. Ads

Admin → Ads:
- Top banner text + link
- Homepage ad text + link
- Marquee (scrolling ticker) on/off
- Premium users never see ads

---

## SECURITY LIMITATIONS — READ BEFORE GOING LIVE

### PDF Protection (Important)

**Current state:** Book PDFs are stored on Cloudinary as public URLs.
Firebase/Firestore rules protect *who can see the URL* in the database.
But if someone obtains the direct Cloudinary URL (e.g. from browser dev tools while reading),
they could download the PDF without being logged in.

**This is a known, accepted limitation** for a fully-static no-backend site.

**To make premium PDFs genuinely protected** (optional, for later):
1. Enable Cloudinary "Private" or "Authenticated" delivery on premium book uploads
2. Create a Vercel serverless function (`/api/get-pdf-url.js`) that:
   - Receives a Firebase ID token + bookId
   - Verifies the token server-side (Firebase Admin SDK)
   - Checks the user's premium/purchase status
   - Issues a short-lived Cloudinary signed URL
   - Returns it to the reader
3. Store Cloudinary API Secret as a Vercel environment variable (never in frontend code)

This step is not required to launch, but is recommended before marketing paid-only premium books widely.

### Unsigned Upload Preset

The Cloudinary upload preset (`ebookcanvas_books`) is Unsigned.
Anyone who knows the preset name and cloud name could upload files to your Cloudinary account.
The admin upload UI is only shown to admin users, which provides reasonable protection for a personal project.
If this becomes a concern later, switch to a signed preset + a Vercel serverless upload endpoint.

---

## Production Checklist

- [ ] Firebase Rules published (firestore.rules)
- [ ] Authentication methods enabled (Google, Email/Password)
- [ ] Cloudinary preset created (Unsigned, named ebookcanvas_books)
- [ ] Deployed to Vercel
- [ ] isAdmin: true set on your account in Firestore
- [ ] Test: upload a book, see it in library, open reader
- [ ] Test: premium gate on a premium book
- [ ] Test: comment, like, dislike, rating
- [ ] Test: timer end chime + Continue/Close modal
- [ ] Test: notes autosave + download
- [ ] Upload a page-flip sound in Admin → Site Editor
- [ ] Set your site name, logo, hero text in Admin → Site Editor
