// ============================================================
// Ebook Canvas — Reader
// Renders the PDF as a real, drag-to-turn curling flipbook using
// StPageFlip. Each PDF page is rendered to an image (page 1 first,
// so the book opens instantly; the rest render in the background
// and get folded in as they're ready). Text is extracted separately,
// on demand, purely to feed the audiobook voice — it's not what's
// displayed, since a curling page has to be a picture of the page.
// ============================================================
import { requireAuth } from "./main.js";
import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, increment, collection, addDoc, getDocs,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const params = new URLSearchParams(location.search);
const bookId = params.get("id");

const shell = document.getElementById("reader-shell");
const bookTitleEl = document.getElementById("book-title");
const statusEl = document.getElementById("flipbook-status");
const progressLabel = document.getElementById("progress-label");

let pdfDoc = null, totalPages = 1, currentPage = 1;
let currentUser = null, currentProfile = null, bookData = null;
let pageFlip = null;
let pageImages = [];        // dataURL per page, filled progressively
let pageTextCache = {};     // pageNum -> extracted text, filled on demand
let speaking = false;

const RENDER_WIDTH = 760; // target pixel width per rendered page image

async function loadBook() {
  if (!bookId) { statusEl.textContent = "No book selected. Go back to the library and pick one."; return; }
  const snap = await getDoc(doc(db, "books", bookId));
  if (!snap.exists()) { statusEl.textContent = "This book couldn't be found."; return; }
  bookData = snap.data();
  bookTitleEl.textContent = bookData.title || "Untitled";
  document.title = `${bookData.title || "Reading"} — Ebook Canvas`;

  if (bookData.isPremiumBook && !currentProfile?.isPremium) {
    document.getElementById("flipbook-wrap").innerHTML = `
      <div class="form-card" style="text-align:center; max-width:420px;">
        <span class="pill pill-gold">Premium book</span>
        <h3 style="margin:14px 0 8px;">"${bookData.title}" is for Premium readers</h3>
        <p>Upgrade to unlock this book, every audiobook, and an ad-free library.</p>
        <a class="btn btn-primary" href="contact.html">Go Premium</a>
      </div>`;
    document.getElementById("reader-bottom")?.remove();
    document.getElementById("audio-bar")?.remove();
    document.getElementById("comments-section")?.remove();
    return;
  }

  if (!bookData.hasAudio) document.getElementById("audio-bar")?.remove();

  updateDoc(doc(db, "books", bookId), { readCount: increment(1) }).catch(() => {});

  pdfDoc = await pdfjsLib.getDocument(bookData.fileURL).promise;
  totalPages = pdfDoc.numPages;

  const saved = currentProfile?.readingProgress?.[bookId];
  const startPage = saved && saved <= totalPages ? saved : 1;

  statusEl.textContent = `Opening book (${totalPages} pages)…`;

  // Render the starting page first so the book opens instantly.
  const firstImage = await renderPageToImage(startPage);
  const dims = firstImage.dims;

  pageImages = new Array(totalPages).fill(null);
  pageImages[startPage - 1] = firstImage.dataURL;
  for (let i = 0; i < totalPages; i++) {
    if (!pageImages[i]) pageImages[i] = blankPlaceholder(dims.width, dims.height);
  }

  initFlipbook(dims, startPage);
  statusEl.style.display = "none";

  renderRemainingPages(startPage);
}

function blankPlaceholder(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#C9C3D2";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("…", w / 2, h / 2);
  return canvas.toDataURL("image/jpeg", 0.7);
}

async function renderPageToImage(num) {
  const page = await pdfDoc.getPage(num);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = RENDER_WIDTH / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return { dataURL: canvas.toDataURL("image/jpeg", 0.78), dims: { width: viewport.width, height: viewport.height } };
}

function initFlipbook(dims, startPage) {
  const wrap = document.getElementById("flipbook-wrap");
  const maxW = Math.min(900, window.innerWidth * 0.92);
  const wrapWidth = Math.min(maxW, dims.width);
  wrap.style.width = wrapWidth + "px";
  wrap.style.height = Math.min(window.innerHeight * 0.72, (dims.height / dims.width) * wrapWidth) + "px";

  const el = document.getElementById("flipbook");
  pageFlip = new St.PageFlip(el, {
    width: dims.width,
    height: dims.height,
    size: "stretch",
    minWidth: 260, maxWidth: 900,
    minHeight: 360, maxHeight: 1200,
    maxShadowOpacity: 0.4,
    showCover: false,
    mobileScrollSupport: false,
    flippingTime: 650
  });
  pageFlip.loadFromImages(pageImages);
  if (startPage > 1) pageFlip.turnToPage(startPage - 1);
  currentPage = startPage;
  updateProgressLabel();

  pageFlip.on("flip", (e) => {
    playPageTurnSound();
    currentPage = e.data + 1;
    updateProgressLabel();
    saveProgress(currentPage);
    if (speaking) speakCurrentPage();
  });

  document.getElementById("next-btn").addEventListener("click", () => pageFlip.flipNext());
  document.getElementById("prev-btn").addEventListener("click", () => pageFlip.flipPrev());
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") pageFlip.flipNext();
    if (e.key === "ArrowLeft") pageFlip.flipPrev();
  });
}

function updateProgressLabel() {
  progressLabel.textContent = `Page ${currentPage} of ${totalPages}`;
}

// --- Synthesized page-turn sound (no audio file needed — built with
// the Web Audio API: filtered noise that swells and fades, like a
// soft paper whoosh) ---
let audioCtx = null;
function playPageTurnSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const duration = 0.28;
    const bufferSize = audioCtx.sampleRate * duration;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1200, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(2600, audioCtx.currentTime + duration * 0.5);
    filter.frequency.exponentialRampToValueAtTime(900, audioCtx.currentTime + duration);
    filter.Q.value = 0.8;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, audioCtx.currentTime + duration * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

    noise.connect(filter).connect(gain).connect(audioCtx.destination);
    noise.start();
    noise.stop(audioCtx.currentTime + duration);
  } catch (e) { /* sound is a nice-to-have — never block the page turn for it */ }
}

// Renders every remaining page in the background, a little at a time,
// so the browser stays responsive. Updates the flipbook in small
// batches rather than after every single page.
async function renderRemainingPages(skipPage) {
  let sinceUpdate = 0;
  for (let num = 1; num <= totalPages; num++) {
    if (num === skipPage) continue;
    try {
      const { dataURL } = await renderPageToImage(num);
      pageImages[num - 1] = dataURL;
      sinceUpdate++;
    } catch (e) { /* leave placeholder for this page if it fails to render */ }

    if (sinceUpdate >= 4) {
      pageFlip?.updateFromImages(pageImages);
      sinceUpdate = 0;
    }
    await new Promise((r) => setTimeout(r, 0)); // yield to the browser between pages
  }
  pageFlip?.updateFromImages(pageImages);
}

let saveTimer = null;
function saveProgress(num) {
  if (!currentUser) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    updateDoc(doc(db, "users", currentUser.uid), { [`readingProgress.${bookId}`]: num }).catch(() => {});
  }, 600);
}

// --- Reading light (background behind the book, not the page itself —
// a curling page is a photo of the real page, so it can't recolor) ---
const lights = ["#F5F2F7", "#EFE6D8", "#D9D6DD"];
let lightIdx = 0;
document.getElementById("theme-toggle").addEventListener("click", () => {
  lightIdx = (lightIdx + 1) % lights.length;
  document.getElementById("reader-stage").style.background = lights[lightIdx];
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

// --- Star rating ---
let myRating = 0;
function renderStars() {
  const el = document.getElementById("star-rating");
  if (!el) return;
  el.innerHTML = [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" data-star="${n}" class="${n <= myRating ? "filled" : ""}">★</button>`
  ).join("");
  el.querySelectorAll("[data-star]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      myRating = parseInt(btn.dataset.star, 10);
      renderStars();
      await setDoc(doc(db, "ratings", `${bookId}_${currentUser.uid}`), {
        bookId, uid: currentUser.uid, value: myRating, createdAt: serverTimestamp()
      });
      loadRatingSummary();
    });
  });
}
async function loadRatingSummary() {
  const summaryEl = document.getElementById("rating-summary");
  if (!summaryEl) return;
  try {
    const snap = await getDocs(query(collection(db, "ratings"), where("bookId", "==", bookId)));
    if (snap.empty) { summaryEl.textContent = "No ratings yet — be the first."; return; }
    let total = 0;
    snap.forEach((d) => (total += d.data().value || 0));
    summaryEl.textContent = `${(total / snap.size).toFixed(1)} / 5 · ${snap.size} rating${snap.size === 1 ? "" : "s"}`;
  } catch (e) { summaryEl.textContent = ""; }
}
async function loadMyRating() {
  try {
    const snap = await getDoc(doc(db, "ratings", `${bookId}_${currentUser.uid}`));
    myRating = snap.exists() ? snap.data().value : 0;
  } catch (e) { myRating = 0; }
  renderStars();
}

// --- Audiobook mode (text is extracted on demand, per page, just for
// speech — the page you see is always the rendered image) ---
// Voices are grouped by language (English / বাংলা). Free readers get
// the first voice found for each language; Premium unlocks a second
// one if the browser/device offers more than one. Note: quality is
// whatever the browser and OS provide for free — a genuinely
// studio-quality voice needs a paid cloud TTS API, which costs money
// per character and isn't part of a $0 setup.
let selectedVoice = null;

function populateVoices() {
  const wrap = document.getElementById("voice-select-wrap") || (() => {
    const select = document.getElementById("voice-select");
    const w = document.createElement("div");
    w.id = "voice-select-wrap";
    select?.replaceWith(w);
    return w;
  })();

  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;

  const isPremium = !!currentProfile?.isPremium;
  const groups = {
    "English": voices.filter((v) => v.lang.toLowerCase().startsWith("en")),
    "বাংলা": voices.filter((v) => v.lang.toLowerCase().startsWith("bn"))
  };

  let html = "";
  Object.entries(groups).forEach(([label, list]) => {
    if (list.length === 0) {
      if (label === "বাংলা") html += `<option disabled>বাংলা — not installed on this device</option>`;
      return;
    }
    list.slice(0, 2).forEach((v, i) => {
      const locked = i === 1 && !isPremium;
      const tier = i === 0 ? "Free" : "Premium";
      html += `<option value="${v.name}" ${locked ? "disabled" : ""}>${label} — ${tier}${locked ? " 🔒" : ""}</option>`;
    });
  });

  wrap.innerHTML = `<select id="voice-select" style="max-width:200px; font-size:.78rem;">${html}</select>`;
  const select = document.getElementById("voice-select");
  const firstEnabled = [...select.options].find((o) => !o.disabled);
  if (firstEnabled) { select.value = firstEnabled.value; selectedVoice = voices.find((v) => v.name === firstEnabled.value) || null; }

  select.addEventListener("change", () => {
    selectedVoice = voices.find((v) => v.name === select.value) || null;
    if (speaking) speakCurrentPage();
  });
}
window.speechSynthesis?.addEventListener?.("voiceschanged", populateVoices);
populateVoices();

async function getPageText(num) {
  if (pageTextCache[num] != null) return pageTextCache[num];
  const page = await pdfDoc.getPage(num);
  const content = await page.getTextContent();
  const text = content.items.map((i) => i.str).join(" ").trim();
  pageTextCache[num] = text;
  return text;
}

async function speakCurrentPage() {
  window.speechSynthesis.cancel();
  const text = await getPageText(currentPage);
  const playBtn = document.getElementById("play-btn");
  if (!text || text.length < 20) {
    playBtn.title = "This page has no readable text — flip forward to keep listening";
    if (speaking && currentPage < totalPages) { pageFlip.flipNext(); }
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = parseFloat(document.getElementById("speed").value);
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.onend = () => { if (speaking && currentPage < totalPages) pageFlip.flipNext(); };
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
        </div>
        <p style="margin:4px 0 0;">${(c.text || "").replace(/</g, "&lt;")}</p>
        <div class="comment-actions">
          <button data-like="${d.id}">👍 Like${c.likes ? ` (${c.likes})` : ""}</button>
          <button data-report="${d.id}">Report</button>
        </div>`;
      list.appendChild(row);
    });
    list.querySelectorAll("[data-report]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await updateDoc(doc(db, "comments", btn.dataset.report), { reported: true });
        btn.textContent = "Reported";
        btn.disabled = true;
      })
    );
    // Note: this increments a shared counter — it doesn't stop one
    // person from liking the same comment more than once. Fine for a
    // simple "popular comment" signal; not a strict one-like-per-user system.
    list.querySelectorAll("[data-like]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await updateDoc(doc(db, "comments", btn.dataset.like), { likes: increment(1) });
        btn.disabled = true;
        loadComments();
      })
    );
  } catch (e) {
    list.innerHTML = `<p class="field-hint">Comments couldn't load right now.</p>`;
  }
}

document.getElementById("comment-submit")?.addEventListener("click", async () => {
  const input = document.getElementById("comment-input");
  const text = input.value.trim();
  if (!text || !currentUser) return;
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
  loadBook().then(() => { loadComments(); loadMyRating(); loadRatingSummary(); });
});
