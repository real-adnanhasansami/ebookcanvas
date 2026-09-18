// ============================================================
// Ebook Canvas — Reader
// ============================================================
import { requireAuth } from "./main.js";
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
const statusEl = document.getElementById("flipbook-status");
const progressLabel = document.getElementById("progress-label");

let pdfDoc = null, totalPages = 1, currentPage = 1;
let currentUser = null, currentProfile = null, bookData = null;
let pageFlip = null;
let pageImages = [];
let pageTextCache = {};
let speaking = false;
let isFirstFlip = true;

const RENDER_WIDTH = 760;

async function loadBook() {
  if (!bookId) { statusEl.textContent = "No book selected. Go back to the library and pick one."; return; }
  const snap = await getDoc(doc(db, "books", bookId));
  if (!snap.exists()) { statusEl.textContent = "This book couldn't be found."; return; }
  bookData = snap.data();
  bookTitleEl.textContent = bookData.title || "Untitled";
  document.title = `${bookData.title || "Reading"} - Ebook Canvas`;

  const purchased = (currentProfile?.purchasedBooks || []).includes(bookId);
  if (bookData.isPremiumBook && !currentProfile?.isPremium && !purchased) {
    const priceLine = bookData.price ? `<p class="field-hint">Price: ৳${bookData.price}</p>` : "";
    document.getElementById("flipbook-wrap").innerHTML = `
      <div class="form-card" style="text-align:center; max-width:440px;">
        <span class="pill pill-gold">Premium book</span>
        <h3 style="margin:14px 0 8px;">"${bookData.title}" is for Premium readers</h3>
        <p>Upgrade to Premium, or request to buy just this book.</p>
        ${priceLine}
        <div style="display:flex; gap:10px; justify-content:center; margin-top:10px;">
          <a class="btn btn-primary" href="contact.html">Go Premium</a>
          <button class="btn btn-ghost" id="buy-book-btn">Request to buy this book</button>
        </div>
      </div>`;
    document.getElementById("reader-bottom")?.remove();
    document.getElementById("audio-bar")?.remove();
    document.getElementById("comments-section")?.remove();
    document.getElementById("notes-btn")?.remove();

    document.getElementById("buy-book-btn")?.addEventListener("click", async () => {
      await addDoc(collection(db, "bookPurchaseRequests"), {
        bookId, bookTitle: bookData.title, uid: currentUser.uid,
        email: currentUser.email, status: "pending", createdAt: serverTimestamp()
      });
      document.getElementById("buy-book-btn").textContent = "Request sent ✓";
      document.getElementById("buy-book-btn").disabled = true;
    });
    return;
  }

  if (!bookData.hasAudio) document.getElementById("audio-bar")?.remove();

  updateDoc(doc(db, "books", bookId), { readCount: increment(1) }).catch(() => {});

  pdfDoc = await pdfjsLib.getDocument(bookData.fileURL).promise;
  totalPages = pdfDoc.numPages;

  const saved = currentProfile?.readingProgress?.[bookId];
  const startPage = saved && saved <= totalPages ? saved : 1;

  statusEl.textContent = `Opening book (${totalPages} pages)…`;

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
  return { dataURL: canvas.toDataURL("image/jpeg", 0.78), dims: { width: viewport.width, height: viewport.height } };
}

function initFlipbook(dims, startPage) {
  const wrap = document.getElementById("flipbook-wrap");
  const stage = document.getElementById("reader-stage");
  const maxW = Math.min(900, stage.clientWidth * 0.94);
  const wrapWidth = Math.min(maxW, dims.width);
  wrap.style.width = wrapWidth + "px";
  wrap.style.height = Math.min(stage.clientHeight * 0.92, (dims.height / dims.width) * wrapWidth) + "px";

  const el = document.getElementById("flipbook");
  pageFlip = new St.PageFlip(el, {
    width: dims.width, height: dims.height, size: "stretch",
    minWidth: 260, maxWidth: 900, minHeight: 360, maxHeight: 1200,
    maxShadowOpacity: 0.4, showCover: false, mobileScrollSupport: false, flippingTime: 650
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
  });

  document.getElementById("next-btn").addEventListener("click", () => pageFlip.flipNext());
  document.getElementById("prev-btn").addEventListener("click", () => pageFlip.flipPrev());
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") pageFlip.flipNext();
    if (e.key === "ArrowLeft") pageFlip.flipPrev();
  });
}

function updateProgressLabel() { progressLabel.textContent = `Page ${currentPage} of ${totalPages}`; }

async function renderRemainingPages(skipPage) {
  let sinceUpdate = 0;
  for (let num = 1; num <= totalPages; num++) {
    if (num === skipPage) continue;
    try {
      const { dataURL } = await renderPageToImage(num);
      pageImages[num - 1] = dataURL;
      sinceUpdate++;
    } catch (e) { /* leave placeholder */ }
    if (sinceUpdate >= 4) { pageFlip?.updateFromImages(pageImages); sinceUpdate = 0; }
    await new Promise((r) => setTimeout(r, 0));
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

// --- Page-turn sound: short, crisp "riffle" - not sustained static,
// and never plays on the very first (programmatic) page render. ---
let audioCtx = null;
function playPageTurnSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const duration = 0.14;
    const bufferSize = Math.floor(audioCtx.sampleRate * duration);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(1800, now);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter).connect(gain).connect(audioCtx.destination);
    noise.start(now);
    noise.stop(now + duration);

    // A tiny "flick" tick at the very end for a satisfying snap.
    const tick = audioCtx.createOscillator();
    const tickGain = audioCtx.createGain();
    tick.type = "sine";
    tick.frequency.setValueAtTime(2400, now + duration * 0.7);
    tickGain.gain.setValueAtTime(0.0001, now + duration * 0.7);
    tickGain.gain.exponentialRampToValueAtTime(0.08, now + duration * 0.75);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.03);
    tick.connect(tickGain).connect(audioCtx.destination);
    tick.start(now + duration * 0.7);
    tick.stop(now + duration + 0.03);
  } catch (e) { /* sound is optional */ }
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
  const adTop = document.querySelector("[data-ad='top']");
  if (adTop && document.fullscreenElement) adTop.style.display = "none";
});

// --- Audiobook (simple: default system voice, no picker) ---
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
  if (!text || text.length < 20) {
    if (speaking && currentPage < totalPages) pageFlip.flipNext();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = parseFloat(document.getElementById("speed").value);
  utterance.onend = () => { if (speaking && currentPage < totalPages) pageFlip.flipNext(); };
  window.speechSynthesis.speak(utterance);
}
document.getElementById("play-btn")?.addEventListener("click", (e) => {
  speaking = !speaking;
  e.target.textContent = speaking ? "⏸" : "▶";
  if (speaking) speakCurrentPage(); else window.speechSynthesis.cancel();
});
document.getElementById("speed")?.addEventListener("change", () => { if (speaking) speakCurrentPage(); });

// --- Notes panel: resizable, auto-saving, downloadable ---
const notesPanel = document.getElementById("notes-panel");
const notesTextarea = document.getElementById("notes-textarea");
let notesSaveTimer = null;

document.getElementById("notes-btn")?.addEventListener("click", async () => {
  const opening = notesPanel.style.display === "none";
  notesPanel.style.display = opening ? "flex" : "none";
  if (opening) await loadNotes();
});

async function loadNotes() {
  try {
    const snap = await getDoc(doc(db, "notes", `${bookId}_${currentUser.uid}`));
    notesTextarea.value = snap.exists() ? (snap.data().text || "") : "";
  } catch (e) { notesTextarea.value = ""; }
}
async function saveNotes(silent) {
  const status = document.getElementById("notes-status");
  if (!silent) status.textContent = "Saving…";
  try {
    await setDoc(doc(db, "notes", `${bookId}_${currentUser.uid}`), {
      bookId, uid: currentUser.uid, bookTitle: bookData?.title || "",
      text: notesTextarea.value, updatedAt: serverTimestamp()
    });
    status.textContent = "Saved ✓";
  } catch (e) { status.textContent = "Couldn't save."; }
}
notesTextarea?.addEventListener("input", () => {
  document.getElementById("notes-status").textContent = "Typing…";
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(() => saveNotes(true), 1500);
});
document.getElementById("notes-save-btn")?.addEventListener("click", () => saveNotes(false));
document.getElementById("notes-clear-btn")?.addEventListener("click", async () => {
  if (!confirm("Clear all notes for this book? This can't be undone.")) return;
  notesTextarea.value = "";
  await saveNotes(true);
});
document.getElementById("notes-download-txt")?.addEventListener("click", () => {
  const blob = new Blob([notesTextarea.value], { type: "text/plain" });
  downloadBlob(blob, `${(bookData?.title || "notes").replace(/[^a-z0-9]+/gi, "_")}-notes.txt`);
});
document.getElementById("notes-download-pdf")?.addEventListener("click", async () => {
  const pdfDocOut = await PDFLib.PDFDocument.create();
  const font = await pdfDocOut.embedFont(PDFLib.StandardFonts.Helvetica);
  const fontSize = 11, margin = 50, lineHeight = 16;
  let page = pdfDocOut.addPage();
  let { width, height } = page.getSize();
  let y = height - margin;
  const maxWidth = width - margin * 2;

  const words = (notesTextarea.value || "(no notes)").split(/\s+/);
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(test, fontSize) > maxWidth) {
      page.drawText(line, { x: margin, y, size: fontSize, font });
      y -= lineHeight;
      if (y < margin) { page = pdfDocOut.addPage(); ({ width, height } = page.getSize()); y = height - margin; }
      line = word;
    } else { line = test; }
  }
  if (line) page.drawText(line, { x: margin, y, size: fontSize, font });

  const bytes = await pdfDocOut.save();
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
    list.innerHTML = "";
    docs.forEach((c) => {
      const row = document.createElement("div");
      row.className = "comment-row";
      row.innerHTML = `
        <div class="comment-head"><strong>${c.name || "Anonymous reader"}</strong></div>
        <p style="margin:4px 0 0;">${(c.text || "").replace(/</g, "&lt;")}</p>
        <div class="comment-actions">
          <button data-like="${c.id}">👍 ${c.likes || 0}</button>
          <button data-dislike="${c.id}">👎 ${c.dislikes || 0}</button>
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
    list.querySelectorAll("[data-like]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await updateDoc(doc(db, "comments", btn.dataset.like), { likes: increment(1) });
        loadComments();
      })
    );
    list.querySelectorAll("[data-dislike]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await updateDoc(doc(db, "comments", btn.dataset.dislike), { dislikes: increment(1) });
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
    bookId, bookTitle: bookData?.title || "", uid: currentUser.uid,
    name: currentProfile?.displayName || currentUser.email?.split("@")[0] || "Reader",
    text, reported: false, likes: 0, dislikes: 0, createdAt: serverTimestamp()
  });
  input.value = "";
  loadComments();
});

requireAuth((user, profile) => {
  currentUser = user;
  currentProfile = profile;
  loadBook().then(() => { loadComments(); loadMyRating(); loadRatingSummary(); });
});
