// ============================================================
// Ebook Canvas — Admin panel
// Every write here is also re-checked by firestore.rules, which
// only allow these operations for a user whose users/{uid} doc has
// isAdmin: true. This file just provides the UI.
// ============================================================
import { requireAdmin, toast } from "./main.js";
import { db } from "./firebase-config.js";
import {
  collection, getDocs, getDoc, doc, setDoc, updateDoc, addDoc, deleteDoc,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ------------------------------------------------------------------
// Cloudinary holds book PDFs and the site logo (free tier, no card
// required — unlike Firebase Storage, which now requires Blaze).
// ------------------------------------------------------------------
const CLOUDINARY_CLOUD_NAME = "cul4wkkt";
const CLOUDINARY_UPLOAD_PRESET = "ebookcanvas_books";

async function uploadToCloudinary(blob, filename, resourceType = "raw") {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) throw new Error("Cloudinary upload failed");
  const data = await res.json();
  return data.secure_url;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// Renders the PDF's first page to an image so books get a real cover
// automatically when the admin doesn't paste in a cover URL.
async function generateCoverThumbnail(bytes) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85));
  } catch (e) {
    return null;
  }
}

// --- Tabs -----------------------------------------------------
const tabLoaders = {
  users: loadUsers,
  subscriptions: loadSubscriptions,
  comments: loadComments,
  requests: loadRequests,
  site: loadSite
};
document.querySelectorAll(".tab-link").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll(".tab-link").forEach((l) => l.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => (p.style.display = "none"));
    link.classList.add("active");
    document.getElementById(`tab-${link.dataset.tab}`).style.display = "block";
    tabLoaders[link.dataset.tab]?.();
  });
});

// --- PDF upload + compression ---------------------------------
let pendingFile = null, compressedBytes = null, pendingCoverBlob = null, coverReadyPromise = null;

document.getElementById("dropzone").addEventListener("click", () => document.getElementById("pdf-input").click());
document.getElementById("pdf-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingFile = file;
  pendingCoverBlob = null;
  const status = document.getElementById("compress-status");
  status.textContent = "Optimizing file and generating a cover…";
  document.getElementById("upload-form").style.display = "block";

  const bytes = await file.arrayBuffer();

  // Stored so "Add to library" can await it — previously this ran
  // unawaited in the background, so clicking publish quickly could
  // add the book before its cover finished generating. Fixed.
  coverReadyPromise = generateCoverThumbnail(new Uint8Array(bytes)).then((blob) => { pendingCoverBlob = blob; });

  try {
    const pdf = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    pdf.setTitle(""); pdf.setAuthor(""); pdf.setSubject(""); pdf.setKeywords([]);
    compressedBytes = await pdf.save({ useObjectStreams: true });
    const before = (file.size / 1024).toFixed(0);
    const after = (compressedBytes.byteLength / 1024).toFixed(0);
    const pct = Math.max(0, Math.round((1 - compressedBytes.byteLength / file.size) * 100));
    await coverReadyPromise;
    status.textContent = `Optimized: ${before} KB → ${after} KB (${pct}% smaller, same quality). Cover ready.`;
  } catch (err) {
    compressedBytes = null;
    await coverReadyPromise.catch(() => {});
    status.textContent = "Couldn't auto-optimize this file — it'll upload at its original size.";
  }
});

document.getElementById("publish-btn").addEventListener("click", async () => {
  if (!pendingFile) return toast("Choose a PDF first");
  const title = document.getElementById("book-title").value.trim();
  const author = document.getElementById("book-author").value.trim();
  const genre = document.getElementById("book-genre").value.trim();
  const coverURL = document.getElementById("book-cover").value.trim();
  const isPremiumBook = document.getElementById("book-access").value === "premium";
  const hasAudio = document.getElementById("book-audio").checked;
  const featured = document.getElementById("book-featured").checked;
  if (!title) return toast("Give the book a title");

  const btn = document.getElementById("publish-btn");
  btn.disabled = true; btn.textContent = "Preparing…";

  try {
    // Wait for the cover thumbnail to actually finish before publishing —
    // this is the fix for covers sometimes not showing up.
    await (coverReadyPromise || Promise.resolve()).catch(() => {});

    btn.textContent = "Uploading…";
    const blob = compressedBytes ? new Blob([compressedBytes], { type: "application/pdf" }) : pendingFile;
    const filename = `${Date.now()}-${pendingFile.name}`;
    const fileURL = await uploadToCloudinary(blob, filename, "raw");

    let finalCoverURL = coverURL || null;
    if (!finalCoverURL && pendingCoverBlob) {
      try {
        finalCoverURL = await uploadToCloudinary(pendingCoverBlob, `${filename}-cover.jpg`, "image");
      } catch (e) { /* cover is optional — fine if this fails */ }
    }

    await addDoc(collection(db, "books"), {
      title, author, genre: genre || null, coverURL: finalCoverURL, fileURL,
      isPremiumBook, hasAudio, featured, published: true,
      readCount: 0,
      originalSizeKB: Math.round(pendingFile.size / 1024),
      compressedSizeKB: Math.round(blob.size / 1024),
      createdAt: serverTimestamp()
    });

    toast("Book added to the library");
    document.getElementById("upload-form").style.display = "none";
    document.getElementById("pdf-input").value = "";
    document.getElementById("book-title").value = "";
    document.getElementById("book-author").value = "";
    document.getElementById("book-genre").value = "";
    document.getElementById("book-cover").value = "";
    document.getElementById("book-featured").checked = false;
    pendingFile = null; compressedBytes = null; pendingCoverBlob = null; coverReadyPromise = null;
    loadBooks();
  } catch (err) {
    toast("Upload failed — check your Cloudinary preset/cloud name and try again.");
  } finally {
    btn.disabled = false; btn.textContent = "Add to library";
  }
});

async function loadBooks() {
  const tbody = document.querySelector("#books-table tbody");
  tbody.innerHTML = "";
  const snap = await getDocs(collection(db, "books"));
  document.getElementById("stat-books").textContent = snap.size;
  snap.forEach((d) => {
    const b = d.data();
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${b.title || ""}${b.featured ? ' <span class="pill pill-gold" title="Shown on homepage">★</span>' : ''}</td>
      <td>${b.author || "—"}</td>
      <td>${b.compressedSizeKB || "—"} KB</td>
      <td>${b.isPremiumBook ? '<span class="pill pill-gold">Premium</span>' : '<span class="pill">Free</span>'}</td>
      <td>${b.published ? "Published" : "Hidden"}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-ghost" data-id="${d.id}" data-action="toggle-featured">${b.featured ? "Unfeature" : "Feature"}</button>
        <button class="btn btn-ghost" data-id="${d.id}" data-action="toggle-access">${b.isPremiumBook ? "Make free" : "Make premium"}</button>
        <button class="btn btn-ghost" data-id="${d.id}" data-action="toggle-pub">${b.published ? "Unpublish" : "Publish"}</button>
        <button class="btn btn-danger" data-id="${d.id}" data-action="delete-book">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-action='toggle-pub']").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const snap2 = await getDoc(doc(db, "books", btn.dataset.id));
      await updateDoc(doc(db, "books", btn.dataset.id), { published: !snap2.data().published });
      loadBooks();
    })
  );
  tbody.querySelectorAll("[data-action='toggle-access']").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const snap2 = await getDoc(doc(db, "books", btn.dataset.id));
      await updateDoc(doc(db, "books", btn.dataset.id), { isPremiumBook: !snap2.data().isPremiumBook });
      loadBooks();
    })
  );
  tbody.querySelectorAll("[data-action='toggle-featured']").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const snap2 = await getDoc(doc(db, "books", btn.dataset.id));
      await updateDoc(doc(db, "books", btn.dataset.id), { featured: !snap2.data().featured });
      loadBooks();
    })
  );
  tbody.querySelectorAll("[data-action='delete-book']").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this book from the library? (The file will still exist on Cloudinary — remove it there too if needed.)")) return;
      await deleteDoc(doc(db, "books", btn.dataset.id));
      loadBooks();
    })
  );
}

// --- Users ------------------------------------------------------
async function loadUsers() {
  const tbody = document.querySelector("#users-table tbody");
  tbody.innerHTML = "";
  const snap = await getDocs(collection(db, "users"));
  document.getElementById("stat-users").textContent = snap.size;
  let premiumCount = 0;
  snap.forEach((d) => {
    const u = d.data();
    if (u.isPremium) premiumCount++;
    const planLabel = u.isPremium ? (u.premiumPlan === "lifetime" ? "Lifetime" : "Monthly/Trial") : "Free";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.displayName || "—"}</td>
      <td>${u.email || "—"}</td>
      <td>${u.accountStatus || "active"}</td>
      <td>${u.isPremium ? `<span class="pill pill-gold">${planLabel}</span>` : '<span class="pill">Free</span>'}</td>
      <td style="white-space:nowrap; display:flex; gap:6px;">
        <select data-plan-select="${d.id}">
          <option value="free">Free</option>
          <option value="trial">Trial (30 days)</option>
          <option value="monthly">Monthly (30 days)</option>
          <option value="lifetime">Lifetime</option>
        </select>
        <button class="btn btn-ghost" data-id="${d.id}">Apply</button>
      </td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("stat-premium").textContent = premiumCount;

  tbody.querySelectorAll("button[data-id]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const select = tbody.querySelector(`[data-plan-select="${btn.dataset.id}"]`);
      const plan = select.value;
      let update;
      if (plan === "free") {
        update = { isPremium: false, premiumPlan: null, premiumExpiry: null };
      } else if (plan === "lifetime") {
        update = { isPremium: true, premiumPlan: "lifetime", premiumExpiry: null };
      } else {
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 30);
        update = { isPremium: true, premiumPlan: plan, premiumExpiry: expiry.toISOString() };
      }
      await updateDoc(doc(db, "users", btn.dataset.id), update);
      toast("Updated");
      loadUsers();
    })
  );
}

// --- Subscription requests (from the Premium page form) -----------
async function loadSubscriptions() {
  const tbody = document.querySelector("#subs-table tbody");
  tbody.innerHTML = "";
  const snap = await getDocs(query(collection(db, "subscriptionRequests"), orderBy("createdAt", "desc")));
  const pending = snap.docs.filter((d) => d.data().status === "pending");
  document.getElementById("stat-sub-requests").textContent = pending.length;
  snap.forEach((d) => {
    const r = d.data();
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.name || "—"}</td>
      <td>${r.email || ""}<br/>${r.phone || ""}</td>
      <td>${r.plan || "—"}</td>
      <td>${r.status}</td>
      <td>${r.status === "pending" ? `<button class="btn btn-ghost" data-id="${d.id}">Mark contacted</button>` : ""}</td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("button[data-id]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, "subscriptionRequests", btn.dataset.id), { status: "contacted" });
      loadSubscriptions();
    })
  );
}

// --- Comments moderation -------------------------------------------
async function loadComments() {
  const tbody = document.querySelector("#comments-table tbody");
  tbody.innerHTML = "";
  const snap = await getDocs(query(collection(db, "comments"), orderBy("createdAt", "desc")));
  snap.forEach((d) => {
    const c = d.data();
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.bookTitle || c.bookId || "—"}</td>
      <td>${c.name || "Anonymous"}</td>
      <td style="max-width:340px;">${(c.text || "").slice(0, 200)}</td>
      <td>${c.reported ? '<span class="pill" style="background:#FBEEF0; color:#A5445A;">Reported</span>' : ""}</td>
      <td><button class="btn btn-danger" data-id="${d.id}">Remove</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("button[data-id]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this comment?")) return;
      await deleteDoc(doc(db, "comments", btn.dataset.id));
      loadComments();
    })
  );
}

// --- Ads ----------------------------------------------------------
async function loadAds() {
  const snap = await getDoc(doc(db, "site", "ads"));
  const ads = snap.exists() ? snap.data() : {};
  document.getElementById("ads-enabled").checked = ads.enabled !== false;
  document.getElementById("ads-top-text").value = ads.topText || "";
  document.getElementById("ads-top-link").value = ads.topLink || "";
  document.getElementById("ads-home-text").value = ads.homeText || "";
  document.getElementById("ads-home-link").value = ads.homeLink || "";
}
document.getElementById("save-ads").addEventListener("click", async () => {
  await setDoc(doc(db, "site", "ads"), {
    enabled: document.getElementById("ads-enabled").checked,
    topText: document.getElementById("ads-top-text").value.trim(),
    topLink: document.getElementById("ads-top-link").value.trim(),
    homeText: document.getElementById("ads-home-text").value.trim(),
    homeLink: document.getElementById("ads-home-link").value.trim()
  });
  toast("Ads updated");
});

// --- Site editor (logo, name, hero copy, meta description) --------
let pendingLogoURL = null;
async function loadSite() {
  const snap = await getDoc(doc(db, "site", "settings"));
  const s = snap.exists() ? snap.data() : {};
  document.getElementById("site-name").value = s.siteName || "Ebook Canvas";
  document.getElementById("site-hero-title").value = s.heroTitle || "Turn any book into<br/>a page you can feel.";
  document.getElementById("site-hero-subtitle").value = s.heroSubtitle || "";
  document.getElementById("site-footer-tagline").value = s.footerTagline || "A calmer way to read.";
  document.getElementById("site-library-empty").value = s.libraryEmpty || "";
  document.getElementById("site-meta-desc").value = s.metaDescription || "";
  document.getElementById("logo-status").textContent = s.logoURL ? "Logo set ✓" : "No logo uploaded yet — using the default mark.";
  pendingLogoURL = s.logoURL || null;
}
document.getElementById("logo-upload-btn").addEventListener("click", () => document.getElementById("logo-input").click());
document.getElementById("logo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById("logo-status").textContent = "Uploading…";
  try {
    pendingLogoURL = await uploadToCloudinary(file, file.name, "image");
    document.getElementById("logo-status").textContent = "Logo uploaded ✓ (remember to Save below)";
  } catch (err) {
    document.getElementById("logo-status").textContent = "Logo upload failed.";
  }
});
document.getElementById("save-site").addEventListener("click", async () => {
  await setDoc(doc(db, "site", "settings"), {
    siteName: document.getElementById("site-name").value.trim(),
    logoURL: pendingLogoURL,
    heroTitle: document.getElementById("site-hero-title").value.trim(),
    heroSubtitle: document.getElementById("site-hero-subtitle").value.trim(),
    footerTagline: document.getElementById("site-footer-tagline").value.trim(),
    libraryEmpty: document.getElementById("site-library-empty").value.trim(),
    metaDescription: document.getElementById("site-meta-desc").value.trim(),
    metaTitle: document.getElementById("site-name").value.trim()
  });
  toast("Site settings saved — visitors will see it on next page load");
});

// --- Account requests -----------------------------------------
async function loadRequests() {
  const tbody = document.querySelector("#requests-table tbody");
  tbody.innerHTML = "";
  const snap = await getDocs(query(collection(db, "accountRequests"), orderBy("createdAt", "desc")));
  snap.forEach((d) => {
    const r = d.data();
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.email}</td><td>${r.type}</td><td>${r.status}</td>
      <td>${r.status === "pending" ? `<button class="btn btn-ghost" data-id="${d.id}">Mark resolved</button>` : ""}</td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("button[data-id]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await updateDoc(doc(db, "accountRequests", btn.dataset.id), { status: "resolved" });
      loadRequests();
    })
  );
}

requireAdmin(() => {
  loadBooks();
  loadAds();
});
