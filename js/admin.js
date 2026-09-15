// ============================================================
// Ebook Canvas — Admin panel
// Every write here is also re-checked by firestore.rules, which
// only allow these operations for a user whose users/{uid} doc has
// isAdmin: true. This file just provides the UI.
// ============================================================
import { requireAdmin } from "./main.js";
import { db } from "./firebase-config.js";
import {
  collection, getDocs, getDoc, doc, setDoc, updateDoc, addDoc, deleteDoc, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { toast } from "./main.js";

// ------------------------------------------------------------------
// Cloudinary holds the actual PDF files (free tier, no card required —
// unlike Firebase Storage, which now requires the paid Blaze plan).
// Fill these in after creating a free Cloudinary account:
//   1. Sign up at cloudinary.com → your Cloud Name is on the dashboard.
//   2. Settings → Upload → Add upload preset → Signing Mode: "Unsigned"
//      → give it a name → Save. Use that name below.
// ------------------------------------------------------------------
const CLOUDINARY_CLOUD_NAME = "cul4wkkt";
const CLOUDINARY_UPLOAD_PRESET = "ebookcanvas_books";

async function uploadToCloudinary(blob, filename) {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  // resource_type=raw is required for non-image/video files like PDFs.
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`;
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) throw new Error("Cloudinary upload failed");
  const data = await res.json();
  return data.secure_url;
}

// --- Tabs -----------------------------------------------------
document.querySelectorAll(".tab-link").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll(".tab-link").forEach((l) => l.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => (p.style.display = "none"));
    link.classList.add("active");
    document.getElementById(`tab-${link.dataset.tab}`).style.display = "block";
    if (link.dataset.tab === "users") loadUsers();
    if (link.dataset.tab === "requests") loadRequests();
  });
});

// --- PDF upload + compression ---------------------------------
let pendingFile = null, compressedBytes = null;

document.getElementById("dropzone").addEventListener("click", () => document.getElementById("pdf-input").click());
document.getElementById("pdf-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingFile = file;
  const status = document.getElementById("compress-status");
  status.textContent = "Optimizing file…";
  document.getElementById("upload-form").style.display = "block";

  try {
    const bytes = await file.arrayBuffer();
    const pdf = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    // Strip metadata and re-save with object streams for a real,
    // honest size reduction (typically 10-40% depending on the file —
    // not the 2MB-to-2KB some tools claim, which isn't physically possible).
    pdf.setTitle(""); pdf.setAuthor(""); pdf.setSubject(""); pdf.setKeywords([]);
    compressedBytes = await pdf.save({ useObjectStreams: true });
    const before = (file.size / 1024).toFixed(0);
    const after = (compressedBytes.byteLength / 1024).toFixed(0);
    const pct = Math.max(0, Math.round((1 - compressedBytes.byteLength / file.size) * 100));
    status.textContent = `Optimized: ${before} KB → ${after} KB (${pct}% smaller, same quality).`;
  } catch (err) {
    compressedBytes = null;
    status.textContent = "Couldn't auto-optimize this file — it'll upload at its original size.";
  }
});

document.getElementById("publish-btn").addEventListener("click", async () => {
  if (!pendingFile) return toast("Choose a PDF first");
  const title = document.getElementById("book-title").value.trim();
  const author = document.getElementById("book-author").value.trim();
  const hasAudio = document.getElementById("book-audio").checked;
  if (!title) return toast("Give the book a title");

  try {
    const blob = compressedBytes ? new Blob([compressedBytes], { type: "application/pdf" }) : pendingFile;
    const filename = `${Date.now()}-${pendingFile.name}`;
    const fileURL = await uploadToCloudinary(blob, filename);

    await addDoc(collection(db, "books"), {
      title, author, fileURL,
      originalSizeKB: Math.round(pendingFile.size / 1024),
      compressedSizeKB: Math.round(blob.size / 1024),
      hasAudio, published: true,
      createdAt: serverTimestamp()
    });

    toast("Book added to the library");
    document.getElementById("upload-form").style.display = "none";
    document.getElementById("pdf-input").value = "";
    pendingFile = null; compressedBytes = null;
    loadBooks();
  } catch (err) {
    toast("Upload failed — check your connection and try again.");
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
      <td>${b.title || ""}</td>
      <td>${b.author || "—"}</td>
      <td>${b.compressedSizeKB || "—"} KB</td>
      <td>${b.published ? "Published" : "Hidden"}</td>
      <td><button class="btn btn-ghost" data-id="${d.id}" data-action="toggle-pub">${b.published ? "Unpublish" : "Publish"}</button>
          <button class="btn btn-danger" data-id="${d.id}" data-action="delete-book">Delete</button></td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-action='toggle-pub']").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const snap2 = await getDocs(collection(db, "books"));
      const current = snap2.docs.find((x) => x.id === btn.dataset.id).data();
      await updateDoc(doc(db, "books", btn.dataset.id), { published: !current.published });
      loadBooks();
    })
  );
  tbody.querySelectorAll("[data-action='delete-book']").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this book from the library?")) return;
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
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.displayName || "—"}</td>
      <td>${u.email || "—"}</td>
      <td>${u.accountStatus || "active"}</td>
      <td>${u.isPremium ? '<span class="pill pill-gold">Premium</span>' : '<span class="pill">Free</span>'}</td>
      <td><button class="btn btn-ghost" data-id="${d.id}" data-premium="${!u.isPremium}">${u.isPremium ? "Revoke premium" : "Grant premium"}</button></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("stat-premium").textContent = premiumCount;

  tbody.querySelectorAll("[data-premium]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const makePremium = btn.dataset.premium === "true";
      await updateDoc(doc(db, "users", btn.dataset.id), {
        isPremium: makePremium,
        premiumExpiry: null // set manually per plan (monthly/lifetime) as needed
      });
      loadUsers();
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

// --- Account requests -----------------------------------------
async function loadRequests() {
  const tbody = document.querySelector("#requests-table tbody");
  tbody.innerHTML = "";
  const snap = await getDocs(query(collection(db, "accountRequests"), orderBy("createdAt", "desc")));
  const pending = snap.docs.filter((d) => d.data().status === "pending");
  document.getElementById("stat-requests").textContent = pending.length;
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
