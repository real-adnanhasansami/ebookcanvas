// ============================================================
// Ebook Canvas — Reader
// Renders an uploaded PDF page-by-page with a real page-flip feel,
// a focus/countdown mode, audiobook mode (browser speech synthesis),
// premium-book gating, and a comments section.
// ============================================================
import { requireAuth } from "./main.js";
import { db } from "./firebase-config.js";
import {
  doc, getDoc, updateDoc, increment, collection, addDoc, getDocs,
  query, where, orderBy, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const params = new URLSearchParams(location.search);
const bookId = params.get("id");

const shell = document.getElementById("reader-shell");
const pageEl = document.getElementById("page-el");
const pageText = document.getElementById("page-text");
const pageNumberEl = document.getElementById("page-number");
const progressLabel = document.getElementById("progress-label");
const bookTitleEl = document.getElementById("book-title");

let pdfDoc = null, currentPage = 1, totalPages = 1;
let currentUser = null, currentProfile = null, fontSize = 1.02;
let speaking = false;
let bookData = null;

async function loadBook() {
  if (!bookId) { pageText.textContent = "No book selected. Go back to the library and pick one."; return; }
  const snap = await getDoc(doc(db, "books", bookId));
  if (!snap.exists()) { pageText.textContent = "This book couldn't be found."; return; }
  bookData = snap.data();
  bookTitleEl.textContent = bookData.title || "Untitled";
  document.title = `${bookData.title || "Reading"} — Ebook Canvas`;

  // Premium gating: a premium-only book blocks non-premium readers here.
  if (bookData.isPremiumBook && !currentProfile?.isPremium) {
    document.getElementById("book-viewport").innerHTML = `
      <div class="page" style="display:flex; align-items:center; justify-content:center; text-align:center; flex-direction:column; gap:14px;">
        <span class="pill pill-gold">Premium book</span>
        <h3 style="margin:0;">"${bookData.title}" is for Premium readers</h3>
        <p>Upgrade to unlock this book, every audiobook, and an ad-free library.</p>
        <a class="btn btn-primary" href="contact.html">Go Premium</a>
      </div>`;
    document.getElementById("reader-bottom")?.remove();
    document.getElementById("audio-bar")?.remove();
    document.getElementById("comments-section")?.remove();
    return;
  }

  if (!bookData.hasAudio) document.getElementById("audio-bar")?.remove();

  const saved = currentProfile?.readingProgress?.[bookId];
  if (saved) currentPage = saved;

  // Count this as a read (once per page load) — powers the Trending filter.
  updateDoc(doc(db, "books", bookId), { readCount: increment(1) }).catch(() => {});

  const loadingTask = pdfjsLib.getDocument(bookData.fileURL);
  pdfDoc = await loadingTask.promise;
  totalPages = pdfDoc.numPages;
  await renderPage(currentPage);
  loadComments();
}

async function renderPage(num) {
  num = Math.max(1, Math.min(totalPages, num));
  currentPage = num;
  const page = await pdfDoc.getPage(num);
  const content = await page.getTextContent();
  const text = content.items.map((i) => i.str).join(" ");
  pageText.textContent = text || "(This page has no extractable text.)";
  pageText.dataset.raw = text;
  pageNumberEl.textContent = `${num} / ${totalPages}`;
  progressLabel.textContent = `Page ${num} of ${totalPages}`;
  saveProgress(num);
  if (speaking) speakCurrentPage();
}

let saveTimer = null;
function saveProgress(num) {
  if (!currentUser) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    updateDoc(doc(db, "users", currentUser.uid), {
      [`readingProgress.${bookId}`]: num
    }).catch(() => {});
  }, 600);
}

function flipTo(delta) {
  if (!pdfDoc) return;
  pageEl.classList.add("flipped");
  setTimeout(async () => {
    await renderPage(currentPage + delta);
    pageEl.classList.remove("flipped");
  }, 320);
}

document.getElementById("next-btn")?.addEventListener("click", () => flipTo(1));
document.getElementById("prev-btn")?.addEventListener("click", () => flipTo(-1));
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") flipTo(1);
  if (e.key === "ArrowLeft") flipTo(-1);
});

// --- Font size ---
document.getElementById("font-plus").addEventListener("click", () => {
  fontSize = Math.min(1.6, fontSize + 0.08);
  pageText.style.fontSize = fontSize + "rem";
});
document.getElementById("font-minus").addEventListener("click", () => {
  fontSize = Math.max(0.8, fontSize - 0.08);
  pageText.style.fontSize = fontSize + "rem";
});

// --- Page theme ---
const themes = ["#FFFFFF", "#F4ECD8", "#E8E6E1"];
let themeIdx = 0;
document.getElementById("theme-toggle").addEventListener("click", () => {
  themeIdx = (themeIdx + 1) % themes.length;
  pageEl.style.background = themes[themeIdx];
});

// --- Focus mode ---
document.getElementById("focus-btn").addEventListener("click", () => {
  shell.classList.toggle("focus-mode");
});

// --- Reading timer ---
let timerInterval = null;
document.getElementById("timer-btn").addEventListener("click", () => {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; shell.classList.remove("timer-active"); return; }
  const mins = parseInt(prompt("Set a reading timer, in minutes:", "25"), 10);
  if (!mins || mins <= 0) return;
  let remaining = mins * 60;
  shell.classList.add("timer-active");
  const timerEl = document.getElementById("focus-timer");
  const tick = () => {
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;
    if (remaining <= 0) {
      clearInterval(timerInterval); timerInterval = null; shell.classList.remove("timer-active");
      alert("Time's up! Great reading session.");
      return;
    }
    remaining--;
  };
  tick();
  timerInterval = setInterval(tick, 1000);
});

// --- Fullscreen: also hides the top ad for free users while reading ---
document.getElementById("fullscreen-btn").addEventListener("click", () => {
  if (!document.fullscreenElement) shell.requestFullscreen?.();
  else document.exitFullscreen?.();
});
document.addEventListener("fullscreenchange", () => {
  const adTop = document.querySelector("[data-ad='top']");
  if (!adTop) return;
  if (document.fullscreenElement) adTop.style.display = "none";
});

// --- Audiobook mode ---
function speakCurrentPage() {
  window.speechSynthesis.cancel();
  const text = pageText.dataset.raw || pageText.textContent;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = parseFloat(document.getElementById("speed").value);
  utterance.onend = () => { if (speaking && currentPage < totalPages) flipTo(1); };
  window.speechSynthesis.speak(utterance);
}
document.getElementById("play-btn")?.addEventListener("click", (e) => {
  speaking = !speaking;
  e.target.textContent = speaking ? "⏸" : "▶";
  if (speaking) speakCurrentPage();
  else window.speechSynthesis.cancel();
});
document.getElementById("speed")?.addEventListener("change", () => { if (speaking) speakCurrentPage(); });

// --- Comments ---
async function loadComments() {
  const list = document.getElementById("comments-list");
  if (!list) return;
  list.innerHTML = "Loading comments…";
  try {
    const snap = await getDocs(query(collection(db, "comments"), where("bookId", "==", bookId), orderBy("createdAt", "desc")));
    if (snap.empty) { list.innerHTML = `<p class="field-hint">No comments yet — be the first to share a thought.</p>`; return; }
    list.innerHTML = "";
    snap.forEach((d) => {
      const c = d.data();
      const row = document.createElement("div");
      row.className = "comment-row";
      row.innerHTML = `
        <div class="comment-head">
          <strong>${c.name || "Anonymous reader"}</strong>
          <button class="muted-link" data-report="${d.id}" style="font-size:.75rem; border:none; background:none; cursor:pointer;">Report</button>
        </div>
        <p style="margin:4px 0 0;">${(c.text || "").replace(/</g, "&lt;")}</p>`;
      list.appendChild(row);
    });
    list.querySelectorAll("[data-report]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await updateDoc(doc(db, "comments", btn.dataset.report), { reported: true });
        btn.textContent = "Reported";
        btn.disabled = true;
      })
    );
  } catch (e) {
    list.innerHTML = `<p class="field-hint">Comments couldn't load right now.</p>`;
  }
}

document.getElementById("comment-submit")?.addEventListener("click", async () => {
  const input = document.getElementById("comment-input");
  const text = input.value.trim();
  if (!text) return;
  if (!currentUser) return;
  await addDoc(collection(db, "comments"), {
    bookId, bookTitle: bookData?.title || "",
    uid: currentUser.uid,
    name: currentProfile?.displayName || currentUser.email?.split("@")[0] || "Reader",
    text, reported: false,
    createdAt: serverTimestamp()
  });
  input.value = "";
  loadComments();
});

requireAuth((user, profile) => {
  currentUser = user;
  currentProfile = profile;
  loadBook();
});
