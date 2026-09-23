// ============================================================
// Ebook Canvas — Reader
// ============================================================
import { requireAuth, isPremiumActive } from "./main.js";
import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, increment, collection, addDoc, getDocs,
  query, where, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const params = new URLSearchParams(location.search);
const bookId = params.get("id");

const shell = document.getElementById("reader-shell");
const bookTitleEl = document.getElementById("book-title");
const progressLabel = document.getElementById("progress-label");
let statusEl = null;
document.addEventListener("DOMContentLoaded", () => {
  statusEl = document.getElementById("flipbook-status");
});

let pdfDoc = null, totalPages = 1, currentPage = 1;
let isPreview = false;
let currentUser = null, currentProfile = null, bookData = null;
let pageFlip = null;
let pageImages = [];
let pageTextCache = {};
let speaking = false;
let isFirstFlip = true;
let calcFlipbookSize = null; // set inside initFlipbook; reused by fullscreenchange handler

const RENDER_WIDTH = 950; // higher than before - text legibility matters more than shaving a little load time

async function loadBook() {
  if (!bookId) { statusEl.textContent = "No book selected. Go back to the library and pick one."; return; }
  const snap = await getDoc(doc(db, "books", bookId));
  if (!snap.exists()) { statusEl.textContent = "This book couldn't be found."; return; }
  bookData = snap.data();
  bookTitleEl.textContent = bookData.title || "Untitled";
  document.title = `${bookData.title || "Reading"} - Ebook Canvas`;

  const purchased = (currentProfile?.purchasedBooks || []).includes(bookId);
  // paidOnly books are never unlocked by a general Premium subscription -
  // only by buying that specific book, or an admin manually granting it.
  const generalPremiumAllowed = isPremiumActive(currentProfile) && !bookData.paidOnly;
  const isGated = bookData.isPremiumBook && !generalPremiumAllowed && !purchased;

  if (isGated) {
    showPremiumGate();
    return;
  }

  await openBook(null);
}

function showPremiumGate(previewNoticeOnly) {
  const priceLine = bookData.price ? `<p class="field-hint">Price: ৳${bookData.price}</p>` : "";
  const previewBtn = !previewNoticeOnly ? `<button class="btn btn-ghost" id="preview-book-btn">Preview (pages 1-5)</button>` : "";
  document.getElementById("flipbook-wrap").innerHTML = `
    <div class="form-card" style="text-align:center; max-width:460px;">
      <span class="pill pill-gold">Premium book</span>
      <h3 style="margin:14px 0 8px;">"${bookData.title}" is for Premium readers</h3>
      <p>Upgrade to Premium, or request to buy just this book.</p>
      ${priceLine}
      <div style="display:flex; gap:10px; justify-content:center; margin-top:10px; flex-wrap:wrap;">
        <a class="btn btn-primary" href="contact.html">Go Premium</a>
        <button class="btn btn-ghost" id="buy-book-btn">Request to buy this book</button>
        ${previewBtn}
      </div>
      <p class="field-hint" id="buy-status" style="margin-top:10px;"></p>
    </div>`;
  document.getElementById("reader-bottom")?.remove();
  document.getElementById("audio-bar")?.remove();
  document.getElementById("notes-btn")?.remove();
  document.querySelectorAll("#toc-btn, #search-btn, #zoom-in-btn, #zoom-out-btn").forEach((el) => el.remove());

  document.getElementById("buy-book-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("buy-book-btn");
    const status = document.getElementById("buy-status");
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      await addDoc(collection(db, "bookPurchaseRequests"), {
        bookId, bookTitle: bookData.title, uid: currentUser.uid,
        email: currentUser.email, status: "pending", createdAt: serverTimestamp()
      });
      btn.textContent = "Request sent ✓";
      status.textContent = "We'll confirm and unlock this book once payment is verified.";
    } catch (e) {
      btn.disabled = false; btn.textContent = "Request to buy this book";
      status.textContent = "Couldn't send that request - please try again in a moment.";
      console.error("Buy request error:", e);
    }
  });

  document.getElementById("preview-book-btn")?.addEventListener("click", () => {
    document.getElementById("flipbook-wrap").innerHTML = `<p id="flipbook-status" class="field-hint">Loading preview…</p><div id="flipbook"></div>`;
    openBook(5);
  });
}

async function openBook(previewCap) {
  const hasActivePremium = isPremiumActive(currentProfile);
  if (!bookData.hasAudio || previewCap || !hasActivePremium) document.getElementById("audio-bar")?.remove();

  updateDoc(doc(db, "books", bookId), { readCount: increment(1) }).catch(() => {});
  loadFlipSound();

  pdfDoc = await pdfjsLib.getDocument(bookData.fileURL).promise;
  const realTotalPages = pdfDoc.numPages;
  totalPages = previewCap ? Math.min(previewCap, realTotalPages) : realTotalPages;
  isPreview = !!previewCap;

  const saved = !isPreview ? currentProfile?.readingProgress?.[bookId] : null;
  const startPage = saved && saved <= totalPages ? saved : 1;

  const statusNow = document.getElementById("flipbook-status");
  if (statusNow) statusNow.textContent = isPreview
    ? `Loading preview (${totalPages} of ${realTotalPages} pages)…`
    : `Opening book (${totalPages} pages)…`;

  // Render the first FOUR pages (relative to startPage) synchronously
  // before init, not just two. With only 2 pages pre-rendered, pages
  // 3-5 stayed on the placeholder canvas until the background loop in
  // renderRemainingPages() got around to them (throttled with a 0ms
  // yield per page) - flipping quickly through a 5-page preview outran
  // that background fill and showed white pages. Pre-rendering the
  // first 4 pages means every page reachable by a fast initial flip
  // through a preview is ready before the flipbook ever mounts.
  pageImages = new Array(totalPages).fill(null);
  const syncCount = Math.min(4, totalPages - startPage + 1);
  const syncPages = [];
  let dims = null;
  for (let i = 0; i < syncCount; i++) {
    const num = startPage + i;
    try {
      const { dataURL, dims: d } = await renderPageToImage(num);
      pageImages[num - 1] = dataURL;
      if (!dims) dims = d;
    } catch (e) { /* use placeholder */ }
    syncPages.push(num);
  }
  if (!dims) dims = (await renderPageToImage(startPage)).dims; // fallback, shouldn't normally hit

  for (let i = 0; i < totalPages; i++) {
    if (!pageImages[i]) pageImages[i] = blankPlaceholder(dims.width, dims.height);
  }

  initFlipbook(dims, startPage);
  const s = document.getElementById("flipbook-status");
  if (s) s.style.display = "none";
  if (statusEl) statusEl.style.display = "none";

  // Render remaining pages in background
  renderRemainingPages(syncPages);
}

function blankPlaceholder(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#C9C3D2"; ctx.font = "16px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("…", w / 2, h / 2);
  return canvas.toDataURL("image/jpeg", 0.7);
}

async function renderPageToImage(num) {
  const page = await pdfDoc.getPage(num);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = RENDER_WIDTH / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return { dataURL: canvas.toDataURL("image/jpeg", 0.88), dims: { width: viewport.width, height: viewport.height } };
}

function initFlipbook(dims, startPage) {
  const wrap = document.getElementById("flipbook-wrap");
  const stage = document.getElementById("reader-stage");

  function calcSize() {
    const sw = stage.clientWidth || window.innerWidth;
    const sh = stage.clientHeight || window.innerHeight * 0.72;
    const maxW = Math.min(900, sw * 0.96);
    const h = Math.min(sh * 0.94, (dims.height / dims.width) * maxW);
    wrap.style.width = maxW + "px";
    wrap.style.height = h + "px";
    return { w: maxW, h };
  }
  calcSize();
  // Expose this closure's calcSize so the fullscreenchange handler (which
  // lives outside initFlipbook) can reuse the exact same sizing logic
  // instead of a separate, divergent calculation.
  calcFlipbookSize = calcSize;

  const el = document.getElementById("flipbook");
  pageFlip = new St.PageFlip(el, {
    width: dims.width, height: dims.height, size: "stretch",
    minWidth: 240, maxWidth: 1000, minHeight: 320, maxHeight: 1400,
    maxShadowOpacity: 0.35, showCover: false,
    mobileScrollSupport: true, flippingTime: 600,
    usePortrait: window.innerWidth < 600
  });
  pageFlip.loadFromImages(pageImages);
  if (startPage > 1) pageFlip.turnToPage(startPage - 1);
  currentPage = startPage;
  updateProgressLabel();

  pageFlip.on("flip", (e) => {
    if (isFirstFlip) { isFirstFlip = false; }
    else { playPageTurnSound(); }
    currentPage = e.data + 1;
    updateProgressLabel();
    saveProgress(currentPage);
    if (speaking) speakCurrentPage();
    if (isPreview && currentPage >= totalPages) {
      progressLabel.textContent = "Preview ends here - Go Premium to keep reading";
    }
  });

  document.getElementById("next-btn").addEventListener("click", () => pageFlip.flipNext());
  document.getElementById("prev-btn").addEventListener("click", () => pageFlip.flipPrev());
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") pageFlip.flipNext();
    if (e.key === "ArrowLeft") pageFlip.flipPrev();
  });

  // Recalc on window resize (handles mobile rotate, desktop resize)
  window.addEventListener("resize", () => {
    calcSize();
    setTimeout(() => { try { pageFlip.update(); } catch(e){} }, 100);
  });

  applyReadingThemeFilter();
}

function updateProgressLabel() { progressLabel.textContent = `Page ${currentPage} of ${totalPages}`; }

async function renderRemainingPages(skipPage) {
  const skip = Array.isArray(skipPage) ? skipPage : [skipPage];
  let sinceUpdate = 0;
  for (let num = 1; num <= totalPages; num++) {
    if (skip.includes(num)) continue;
    try {
      const { dataURL } = await renderPageToImage(num);
      pageImages[num - 1] = dataURL;
      sinceUpdate++;
    } catch (e) { /* leave placeholder */ }
    if (sinceUpdate >= 4) { updateFlipbookImagesSilently(); sinceUpdate = 0; }
    await new Promise((r) => setTimeout(r, 0));
  }
  updateFlipbookImagesSilently();
}

// updateFromImages() can re-trigger StPageFlip's internal 'flip' event
// as it redraws - this stops that from spamming the page-turn sound
// while the book is still loading in the background.
function updateFlipbookImagesSilently() {
  if (!pageFlip) return;
  suppressFlipSound = true;
  pageFlip.updateFromImages(pageImages);
  setTimeout(() => { suppressFlipSound = false; }, 50);
}

let saveTimer = null;
function saveProgress(num) {
  if (!currentUser || isPreview) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    updateDoc(doc(db, "users", currentUser.uid), { [`readingProgress.${bookId}`]: num }).catch(() => {});
  }, 600);
}

// --- Page-turn sound: OFF by default. If the admin uploads a sound in
// Admin -> Site editor, that plays instead - nothing synthesized here
// anymore. suppressFlipSound guards against the background page
// renderer's updateFromImages() calls re-triggering the 'flip' event
// and playing the sound repeatedly while the book is still loading. ---
let audioCtx = null;
let flipSoundEl = null;
let suppressFlipSound = false;

async function loadFlipSound() {
  try {
    const snap = await getDoc(doc(db, "site", "settings"));
    const url = snap.exists() ? snap.data().pageFlipSoundURL : null;
    if (url) {
      flipSoundEl = new Audio(url);
      flipSoundEl.preload = "auto";
    }
  } catch (e) { flipSoundEl = null; }
}
function playPageTurnSound() {
  if (suppressFlipSound || !flipSoundEl) return;
  try { flipSoundEl.currentTime = 0; flipSoundEl.play().catch(() => {}); } catch (e) {}
}

function playChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.18, start + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.6);
    });
  } catch (e) {}
}

// --- Reading timer: always available, small indicator visible in
// fullscreen, ends with a chime + a Continue/Turn-off choice. ---
let timerInterval = null, overtime = false;
document.getElementById("timer-btn").addEventListener("click", () => {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; shell.classList.remove("timer-active"); return; }
  const mins = parseInt(prompt("Set a reading timer, in minutes:", "25"), 10);
  if (!mins || mins <= 0) return;
  overtime = false;
  runTimer(mins * 60);
});

function runTimer(seconds) {
  let remaining = seconds;
  shell.classList.add("timer-active");
  const timerEl = document.getElementById("focus-timer");
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!overtime) {
      const m = String(Math.floor(remaining / 60)).padStart(2, "0");
      const s = String(remaining % 60).padStart(2, "0");
      timerEl.textContent = `${m}:${s}`;
      if (remaining <= 0) {
        clearInterval(timerInterval); timerInterval = null;
        playChime();
        document.getElementById("timer-modal").style.display = "flex";
        return;
      }
      remaining--;
    } else {
      remaining++;
      const m = String(Math.floor(remaining / 60)).padStart(2, "0");
      const s = String(remaining % 60).padStart(2, "0");
      timerEl.textContent = `+${m}:${s}`;
    }
  }, 1000);
}
document.getElementById("timer-continue-btn").addEventListener("click", () => {
  document.getElementById("timer-modal").style.display = "none";
  overtime = true;
  runTimer(0);
});
document.getElementById("timer-close-btn").addEventListener("click", () => {
  window.location.href = "index.html";
});

// --- Fullscreen ---
document.getElementById("fullscreen-btn").addEventListener("click", () => {
  if (!document.fullscreenElement) shell.requestFullscreen?.();
  else document.exitFullscreen?.();
});
document.addEventListener("fullscreenchange", () => {
  const isFullscreen = !!document.fullscreenElement;
  const adTop = document.querySelector("[data-ad='top']");
  if (adTop) adTop.style.display = isFullscreen ? "none" : "";
  reinitFlipbookForCurrentSize();
});

// Recalculates the flipbook's container size and tells StPageFlip's
// "stretch" layout to pick up the new bounds. Used on both fullscreen
// enter and exit. Runs on a couple of animation frames (rather than a
// single fixed setTimeout) because the browser applies the :fullscreen
// CSS rules (which change #flipbook-wrap's max-width/max-height and the
// reader-stage's own size) asynchronously with the fullscreen transition;
// measuring stage.clientWidth/Height too early reads stale, pre-transition
// values, which is what previously left the flipbook scrambled until a
// second toggle happened to catch the settled layout.
function reinitFlipbookForCurrentSize() {
  if (!pageFlip || !calcFlipbookSize) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      calcFlipbookSize();
      try { pageFlip.update(); } catch (e) { /* ignore */ }
    });
  });
}

// Audiobook removed — voice section permanently removed per user request.
async function getPageText(num) {
  if (pageTextCache[num] != null) return pageTextCache[num];
  const page = await pdfDoc.getPage(num);
  const content = await page.getTextContent();
  const text = content.items.map((i) => i.str).join(" ").trim();
  pageTextCache[num] = text;
  return text;
}

// --- Notes panel: simplified - single textarea, autosave, download dropdown, clear ---
const notesPanel = document.getElementById("notes-panel");
const notesTextarea = document.getElementById("notes-textarea");
let notesSaveTimer = null;
let notesText = "";
let notesLoaded = false;

document.getElementById("notes-btn")?.addEventListener("click", async () => {
  const opening = notesPanel.style.display === "none";
  notesPanel.style.display = opening ? "flex" : "none";
  shell.classList.toggle("notes-open", opening);
  if (opening && !notesLoaded) {
    try {
      const snap = await getDoc(doc(db, "notes", `${bookId}_${currentUser.uid}`));
      notesText = snap.exists() ? (snap.data().text || "") : "";
    } catch (e) { notesText = ""; }
    notesTextarea.value = notesText;
    notesLoaded = true;
  }
});

async function saveNotesNow(showStatus) {
  const status = document.getElementById("notes-status");
  notesText = notesTextarea.value;
  try {
    await setDoc(doc(db, "notes", `${bookId}_${currentUser.uid}`), {
      bookId, uid: currentUser.uid, bookTitle: bookData?.title || "",
      text: notesText, updatedAt: serverTimestamp()
    });
    if (showStatus && status) status.textContent = "Saved ✓";
  } catch (e) { if (status) status.textContent = "Save failed."; }
}

notesTextarea?.addEventListener("input", () => {
  const status = document.getElementById("notes-status");
  if (status) status.textContent = "Saving…";
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(() => saveNotesNow(true), 1500);
});
document.getElementById("notes-clear-btn")?.addEventListener("click", async () => {
  if (!confirm("Clear all notes for this book?")) return;
  notesTextarea.value = ""; notesText = "";
  await saveNotesNow(false);
  const status = document.getElementById("notes-status");
  if (status) status.textContent = "Cleared";
});

// Download dropdown toggle
document.getElementById("notes-download-btn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const dd = document.getElementById("notes-download-dropdown");
  dd.style.display = dd.style.display === "none" ? "block" : "none";
});
document.addEventListener("click", () => {
  const dd = document.getElementById("notes-download-dropdown");
  if (dd) dd.style.display = "none";
});
document.getElementById("notes-download-txt")?.addEventListener("click", () => {
  const blob = new Blob([notesTextarea.value], { type: "text/plain" });
  downloadBlob(blob, `${(bookData?.title || "notes").replace(/[^a-z0-9]+/gi, "_")}-notes.txt`);
});
document.getElementById("notes-download-pdf")?.addEventListener("click", async () => {
  const pdfOut = await PDFLib.PDFDocument.create();
  const font = await pdfOut.embedFont(PDFLib.StandardFonts.Helvetica);
  const fz = 11, margin = 50, lh = 16;
  let pg = pdfOut.addPage();
  let { width, height } = pg.getSize();
  let y = height - margin;
  const maxW = width - margin * 2;
  const words = (notesTextarea.value || "(no notes)").split(/\s+/);
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(test, fz) > maxW) {
      pg.drawText(line, { x: margin, y, size: fz, font });
      y -= lh;
      if (y < margin) { pg = pdfOut.addPage(); ({ height } = pg.getSize()); y = height - margin; }
      line = word;
    } else { line = test; }
  }
  if (line) pg.drawText(line, { x: margin, y, size: fz, font });
  const bytes = await pdfOut.save();
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), `${(bookData?.title || "notes").replace(/[^a-z0-9]+/gi, "_")}-notes.pdf`);
});
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Resizable notes panel
(function setupResize() {
  const handle = document.getElementById("notes-resize-handle");
  if (!handle) return;
  let dragging = false;
  handle.addEventListener("mousedown", () => { dragging = true; document.body.style.userSelect = "none"; });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const newWidth = Math.min(600, Math.max(220, window.innerWidth - e.clientX));
    notesPanel.style.width = newWidth + "px";
  });
  document.addEventListener("mouseup", () => { dragging = false; document.body.style.userSelect = ""; });
})();

// TOC removed per user request.

// --- Search inside the book ---
document.getElementById("search-btn")?.addEventListener("click", () => {
  const panel = document.getElementById("search-panel");
  panel.style.display = panel.style.display === "none" ? "flex" : "none";
});
document.getElementById("search-close")?.addEventListener("click", () => { document.getElementById("search-panel").style.display = "none"; });

let searchTimer = null;
document.getElementById("search-input")?.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const term = e.target.value.trim();
  const results = document.getElementById("search-results");
  if (term.length < 2) { results.innerHTML = ""; return; }
  results.innerHTML = `<p class="field-hint">Searching…</p>`;
  searchTimer = setTimeout(() => runSearch(term), 400);
});

async function runSearch(term) {
  const results = document.getElementById("search-results");
  const lower = term.toLowerCase();
  const matches = [];
  for (let num = 1; num <= totalPages && matches.length < 30; num++) {
    const text = await getPageText(num);
    const idx = text.toLowerCase().indexOf(lower);
    if (idx > -1) {
      const start = Math.max(0, idx - 30);
      const snippet = (start > 0 ? "…" : "") + text.slice(start, idx + term.length + 40) + "…";
      matches.push({ page: num, snippet });
    }
  }
  if (matches.length === 0) { results.innerHTML = `<p class="field-hint">No matches found.</p>`; return; }
  results.innerHTML = matches.map((m) =>
    `<div class="search-result" data-page="${m.page}"><strong>Page ${m.page}</strong><div class="snippet">${m.snippet.replace(/</g, "&lt;")}</div></div>`
  ).join("");
  results.querySelectorAll("[data-page]").forEach((el) =>
    el.addEventListener("click", () => {
      pageFlip.turnToPage(parseInt(el.dataset.page, 10) - 1);
      document.getElementById("search-panel").style.display = "none";
    })
  );
}

// --- Zoom (scales the book only, the rest of the UI stays put) ---
let zoomLevel = 1;
function applyZoom() { document.getElementById("flipbook-wrap").style.transform = `scale(${zoomLevel})`; }
document.getElementById("zoom-in-btn")?.addEventListener("click", () => { zoomLevel = Math.min(1.8, zoomLevel + 0.1); applyZoom(); });
document.getElementById("zoom-out-btn")?.addEventListener("click", () => { zoomLevel = Math.max(0.6, zoomLevel - 0.1); applyZoom(); });

// --- Theme sync: the site-wide theme (Light/Soft/Dark) changes the
// reader stage background via CSS vars only. The book pages themselves
// (which are rendered images of real PDF pages) are never filtered or
// inverted — they always look like printed pages.
function applyReadingThemeFilter() {
  // Nothing to do in JS — CSS handles it via data-theme on <html>.
  // This function exists so the ec-theme-change listener still works
  // without throwing if called.
}
window.addEventListener("ec-theme-change", applyReadingThemeFilter);

// --- Star rating ---
let myRating = 0;
function renderStars() {
  const el = document.getElementById("star-rating");
  if (!el) return;
  el.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${n <= myRating ? "filled" : ""}">★</button>`).join("");
  el.querySelectorAll("[data-star]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      myRating = parseInt(btn.dataset.star, 10);
      renderStars();
      await setDoc(doc(db, "ratings", `${bookId}_${currentUser.uid}`), { bookId, uid: currentUser.uid, value: myRating, createdAt: serverTimestamp() });
      loadRatingSummary();
    });
  });
}
async function loadRatingSummary() {
  const summaryEl = document.getElementById("rating-summary");
  if (!summaryEl) return;
  try {
    const snap = await getDocs(query(collection(db, "ratings"), where("bookId", "==", bookId)));
    if (snap.empty) { summaryEl.textContent = "No ratings yet - be the first."; return; }
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

// --- Comments: query only filters by bookId (no orderBy), sorted
// client-side - avoids needing a Firestore composite index, which was
// the likely reason comments silently failed to load before. ---
async function loadComments() {
  const list = document.getElementById("comments-list");
  if (!list) return;
  list.innerHTML = "Loading comments…";
  try {
    const snap = await getDocs(query(collection(db, "comments"), where("bookId", "==", bookId)));
    if (snap.empty) { list.innerHTML = `<p class="field-hint">No comments yet - be the first to share a thought.</p>`; return; }
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    // Load this user's existing reactions (stored in userReactions collection)
    let myReactions = {};
    try {
      const rSnap = await getDoc(doc(db, "commentReactions", `${bookId}_${currentUser.uid}`));
      myReactions = rSnap.exists() ? (rSnap.data() || {}) : {};
    } catch (e) { myReactions = {}; }

    list.innerHTML = "";
    docs.forEach((c) => {
      const myVote = myReactions[c.id]; // "like", "dislike", or undefined
      const row = document.createElement("div");
      row.className = "comment-row";
      row.innerHTML = `
        <div class="comment-head"><strong>${c.name || "Anonymous reader"}</strong></div>
        <p style="margin:4px 0 0;">${(c.text || "").replace(/</g, "&lt;")}</p>
        <div class="comment-actions">
          <button data-like="${c.id}" class="${myVote === "like" ? "voted" : ""}">👍 ${c.likes || 0}</button>
          <button data-dislike="${c.id}" class="${myVote === "dislike" ? "voted" : ""}">👎 ${c.dislikes || 0}</button>
          <button data-report="${c.id}">Report</button>
        </div>`;
      list.appendChild(row);
    });

    list.querySelectorAll("[data-report]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await updateDoc(doc(db, "comments", btn.dataset.report), { reported: true });
        btn.textContent = "Reported"; btn.disabled = true;
      })
    );

    // One vote per user per comment — clicking again removes the vote
    async function handleVote(commentId, voteType) {
      const current = myReactions[commentId];
      const reactionRef = doc(db, "commentReactions", `${bookId}_${currentUser.uid}`);
      const commentRef = doc(db, "comments", commentId);

      if (current === voteType) {
        // Remove vote
        myReactions[commentId] = null;
        delete myReactions[commentId];
        await setDoc(reactionRef, myReactions);
        await updateDoc(commentRef, { [voteType + "s"]: increment(-1) });
      } else {
        // Switch or new vote
        const updates = { [voteType + "s"]: increment(1) };
        if (current === "like" || current === "dislike") {
          updates[(current + "s")] = increment(-1);
        }
        myReactions[commentId] = voteType;
        await setDoc(reactionRef, myReactions);
        await updateDoc(commentRef, updates);
      }
      loadComments();
    }

    list.querySelectorAll("[data-like]").forEach((btn) =>
      btn.addEventListener("click", () => handleVote(btn.dataset.like, "like"))
    );
    list.querySelectorAll("[data-dislike]").forEach((btn) =>
      btn.addEventListener("click", () => handleVote(btn.dataset.dislike, "dislike"))
    );
  } catch (e) {
    console.error("Comments error:", e);
    list.innerHTML = `<p class="field-hint">Comments couldn't load right now.</p>`;
  }
}
// Comments toggle
document.getElementById("toggle-comments-btn")?.addEventListener("click", () => {
  const inner = document.getElementById("comments-inner");
  const btn = document.getElementById("toggle-comments-btn");
  if (!inner) return;
  const hidden = inner.style.display === "none";
  inner.style.display = hidden ? "block" : "none";
  btn.textContent = hidden ? "Hide comments & ratings" : "Show comments & ratings";
});

document.getElementById("comment-submit")?.addEventListener("click", async () => {
  const input = document.getElementById("comment-input");
  const text = input.value.trim();
  if (!text || !currentUser) return;
  await addDoc(collection(db, "comments"), {
    bookId, bookTitle: bookData?.title || "", uid: currentUser.uid,
    name: currentProfile?.displayName || currentUser.email?.split("@")[0] || "Reader",
    text, reported: false, likes: 0, dislikes: 0, createdAt: serverTimestamp()
  });
  input.value = "";
  loadComments();
});

// --- Offline download: exports the whole book as a PDF of page images.
// Premium-only. The PDF is built from the already-rendered pageImages
// array, so it only works after the background render is done (or at
// least partially). No extra network requests needed.
// "Save book" — marks it as saved in user's profile for online reading.
// NO PC download. Users can revisit from their account page.
document.getElementById("offline-btn")?.addEventListener("click", async () => {
  if (!isPremiumActive(currentProfile)) {
    if (confirm("Saving books is a Premium feature. Go to Premium page?")) {
      window.location.href = "contact.html";
    }
    return;
  }
  const btn = document.getElementById("offline-btn");
  btn.textContent = "Saving…";
  btn.disabled = true;
  try {
    // Check if already saved
    const existing = await getDocs(query(
      collection(db, "downloads"),
      where("uid", "==", currentUser.uid),
      where("bookId", "==", bookId)
    ));
    if (!existing.empty) {
      btn.textContent = "Saved ✓";
      setTimeout(() => { btn.textContent = "Save"; btn.disabled = false; }, 2000);
      return;
    }
    await addDoc(collection(db, "downloads"), {
      uid: currentUser.uid, bookId, bookTitle: bookData?.title || "",
      coverURL: bookData?.coverURL || null, savedAt: serverTimestamp()
    });
    btn.textContent = "Saved ✓";
    setTimeout(() => { btn.textContent = "Save"; btn.disabled = false; }, 2000);
  } catch (e) {
    console.error("Save error:", e);
    btn.textContent = "Save";
    btn.disabled = false;
    alert("Could not save — try again.");
  }
});

requireAuth((user, profile) => {
  currentUser = user;
  currentProfile = profile;
  loadBook().catch((e) => { console.error("loadBook error:", e); statusEl.textContent = "Something went wrong opening this book."; });
  loadComments();
  loadMyRating();
  loadRatingSummary();
});
