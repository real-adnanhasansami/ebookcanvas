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
let isPreview = false;
let currentUser = null, currentProfile = null, bookData = null;
let pageFlip = null;
let pageImages = [];
let pageTextCache = {};
let speaking = false;
let isFirstFlip = true;

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
  const generalPremiumAllowed = currentProfile?.isPremium && !bookData.paidOnly;
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
  if (!bookData.hasAudio || previewCap) document.getElementById("audio-bar")?.remove();

  updateDoc(doc(db, "books", bookId), { readCount: increment(1) }).catch(() => {});
  loadFlipSound();

  pdfDoc = await pdfjsLib.getDocument(bookData.fileURL).promise;
  const realTotalPages = pdfDoc.numPages;
  totalPages = previewCap ? Math.min(previewCap, realTotalPages) : realTotalPages;
  isPreview = !!previewCap;

  const saved = !isPreview ? currentProfile?.readingProgress?.[bookId] : null;
  const startPage = saved && saved <= totalPages ? saved : 1;

  const statusNow = document.getElementById("flipbook-status");
  if (statusNow) statusNow.textContent = isPreview ? `Loading preview (${totalPages} of ${realTotalPages} pages)…` : `Opening book (${totalPages} pages)…`;

  const firstImage = await renderPageToImage(startPage);
  const dims = firstImage.dims;

  pageImages = new Array(totalPages).fill(null);
  pageImages[startPage - 1] = firstImage.dataURL;
  for (let i = 0; i < totalPages; i++) {
    if (!pageImages[i]) pageImages[i] = blankPlaceholder(dims.width, dims.height);
  }

  initFlipbook(dims, startPage);
  const s = document.getElementById("flipbook-status");
  if (s) s.style.display = "none";
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
  return { dataURL: canvas.toDataURL("image/jpeg", 0.88), dims: { width: viewport.width, height: viewport.height } };
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

  applyReadingThemeFilter();
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
    const snap = await getDoc(doc(db, "site", "ads"));
    const url = snap.exists() ? snap.data().pageFlipSoundURL : null;
    if (url) { flipSoundEl = new Audio(url); flipSoundEl.preload = "auto"; }
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
  const adTop = document.querySelector("[data-ad='top']");
  if (adTop && document.fullscreenElement) adTop.style.display = "none";
  // Recalculate flipbook size after fullscreen toggle so book fills screen
  setTimeout(() => {
    if (!pageFlip) return;
    const wrap = document.getElementById("flipbook-wrap");
    const stage = document.getElementById("reader-stage");
    if (!wrap || !stage) return;
    const maxW = Math.min(900, (document.fullscreenElement ? window.innerWidth : stage.clientWidth) * 0.94);
    if (pageImages.length && pageImages[0]) {
      const img = new Image();
      img.onload = () => {
        const ratio = img.height / img.width;
        wrap.style.width = maxW + "px";
        wrap.style.height = Math.min(
          (document.fullscreenElement ? window.innerHeight : stage.clientHeight) * 0.94,
          maxW * ratio
        ) + "px";
        pageFlip.update();
      };
      img.src = pageImages[0];
    }
  }, 120);
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

// --- Notes panel: three tabs sharing one Firestore doc per book+user ---
const notesPanel = document.getElementById("notes-panel");
const notesTextarea = document.getElementById("notes-textarea");
let notesSaveTimer = null, pageNoteSaveTimer = null;
let notesDoc = { text: "", pageNotes: {}, highlights: [] };
let notesLoaded = false;

document.getElementById("notes-btn")?.addEventListener("click", async () => {
  const opening = notesPanel.style.display === "none";
  notesPanel.style.display = opening ? "flex" : "none";
  shell.classList.toggle("notes-open", opening);
  if (opening) {
    if (!notesLoaded) { await loadNotes(); notesLoaded = true; }
    refreshActiveNotesTab();
  }
});

async function loadNotes() {
  try {
    const snap = await getDoc(doc(db, "notes", `${bookId}_${currentUser.uid}`));
    const d = snap.exists() ? snap.data() : {};
    notesDoc = { text: d.text || "", pageNotes: d.pageNotes || {}, highlights: d.highlights || [] };
  } catch (e) { notesDoc = { text: "", pageNotes: {}, highlights: [] }; }
  notesTextarea.value = notesDoc.text;
}
async function persistNotes(statusEl, silent) {
  if (statusEl && !silent) statusEl.textContent = "Saving…";
  try {
    await setDoc(doc(db, "notes", `${bookId}_${currentUser.uid}`), {
      bookId, uid: currentUser.uid, bookTitle: bookData?.title || "",
      ...notesDoc, updatedAt: serverTimestamp()
    });
    if (statusEl) statusEl.textContent = "Saved ✓";
  } catch (e) { if (statusEl) statusEl.textContent = "Couldn't save."; }
}

// Tab switching
document.querySelectorAll(".notes-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".notes-tab").forEach((t) => t.classList.remove("filter-active"));
    tab.classList.add("filter-active");
    document.querySelectorAll(".notes-tab-pane").forEach((p) => (p.style.display = "none"));
    document.getElementById(`notes-tab-${tab.dataset.notesTab}`).style.display = "flex";
    refreshActiveNotesTab();
  });
});
function refreshActiveNotesTab() {
  const active = document.querySelector(".notes-tab.filter-active")?.dataset.notesTab;
  if (active === "page") refreshPageNoteTab();
  if (active === "highlights") refreshHighlightsTab();
}

// Tab 1: whole-book notes (unchanged behavior)
notesTextarea?.addEventListener("input", () => {
  document.getElementById("notes-status").textContent = "Typing…";
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(() => { notesDoc.text = notesTextarea.value; persistNotes(document.getElementById("notes-status"), true); }, 1500);
});
document.getElementById("notes-save-btn")?.addEventListener("click", () => {
  notesDoc.text = notesTextarea.value;
  persistNotes(document.getElementById("notes-status"), false);
});
document.getElementById("notes-clear-btn")?.addEventListener("click", async () => {
  if (!confirm("Clear all notes for this book? This can't be undone.")) return;
  notesTextarea.value = ""; notesDoc.text = "";
  await persistNotes(document.getElementById("notes-status"), true);
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

// --- Tab 2: per-page sticky note ---
function refreshPageNoteTab() {
  const label = document.getElementById("page-note-label");
  const ta = document.getElementById("page-note-textarea");
  if (!ta) return;
  label.textContent = `Note for page ${currentPage}`;
  ta.value = notesDoc.pageNotes[currentPage] || "";
}
document.getElementById("page-note-textarea")?.addEventListener("input", (e) => {
  document.getElementById("page-note-status").textContent = "Typing…";
  clearTimeout(pageNoteSaveTimer);
  pageNoteSaveTimer = setTimeout(() => {
    notesDoc.pageNotes[currentPage] = e.target.value;
    persistNotes(document.getElementById("page-note-status"), true);
  }, 1200);
});

// --- Tab 3: highlights (select text from the current page's extracted
// text, since a curling page is an image and can't be selected directly) ---
async function refreshHighlightsTab() {
  const source = document.getElementById("highlight-source");
  source.value = (await getPageText(currentPage)) || "(No extractable text on this page.)";
  renderHighlightsList();
}
function renderHighlightsList() {
  const list = document.getElementById("highlights-list");
  if (notesDoc.highlights.length === 0) { list.innerHTML = `<p class="field-hint">No highlights saved yet.</p>`; return; }
  list.innerHTML = notesDoc.highlights
    .slice().sort((a, b) => a.page - b.page)
    .map((h) => `
      <div class="highlight-item">
        <div class="hl-page">Page ${h.page}</div>
        <div>${h.text.replace(/</g, "&lt;")}</div>
        <button data-remove-hl="${h.id}">Remove</button>
      </div>`).join("");
  list.querySelectorAll("[data-remove-hl]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      notesDoc.highlights = notesDoc.highlights.filter((h) => h.id !== btn.dataset.removeHl);
      renderHighlightsList();
      await persistNotes(null, true);
    })
  );
}
document.getElementById("highlight-save-btn")?.addEventListener("click", async () => {
  const source = document.getElementById("highlight-source");
  const selected = source.value.substring(source.selectionStart, source.selectionEnd).trim();
  const text = selected || source.value.trim();
  if (!text) return;
  notesDoc.highlights.push({ id: `${Date.now()}`, page: currentPage, text: text.slice(0, 500) });
  renderHighlightsList();
  await persistNotes(null, true);
});

// --- Chapters / Table of contents ---
let tocLoaded = false;
document.getElementById("toc-btn")?.addEventListener("click", async () => {
  const panel = document.getElementById("toc-panel");
  const opening = panel.style.display === "none";
  panel.style.display = opening ? "flex" : "none";
  if (opening && !tocLoaded) { tocLoaded = true; await loadToc(); }
});
document.getElementById("toc-close")?.addEventListener("click", () => { document.getElementById("toc-panel").style.display = "none"; });

async function loadToc() {
  const list = document.getElementById("toc-list");
  try {
    const outline = await pdfDoc.getOutline();
    if (!outline || outline.length === 0) { list.innerHTML = `<p class="field-hint">No table of contents found for this book.</p>`; return; }
    const items = await Promise.all(outline.map(async (item) => {
      try {
        let dest = item.dest;
        if (typeof dest === "string") dest = await pdfDoc.getDestination(dest);
        const pageIndex = await pdfDoc.getPageIndex(dest[0]);
        return { title: item.title, page: pageIndex + 1 };
      } catch (e) { return null; }
    }));
    const valid = items.filter(Boolean);
    if (valid.length === 0) { list.innerHTML = `<p class="field-hint">Couldn't resolve chapter locations for this book.</p>`; return; }
    list.innerHTML = valid.map((it) => `<div class="toc-item" data-page="${it.page}">${it.title} <span style="color:var(--ink-soft); font-size:.78rem;">— p.${it.page}</span></div>`).join("");
    list.querySelectorAll("[data-page]").forEach((el) =>
      el.addEventListener("click", () => {
        pageFlip.turnToPage(parseInt(el.dataset.page, 10) - 1);
        document.getElementById("toc-panel").style.display = "none";
      })
    );
  } catch (e) {
    list.innerHTML = `<p class="field-hint">No table of contents found for this book.</p>`;
  }
}

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

// --- Book page tint follows the single site-wide theme switcher (in
// the toolbar) rather than having its own separate control. ---
function applyReadingThemeFilter() {
  const wrap = document.getElementById("flipbook-wrap");
  if (!wrap) return;
  const theme = document.documentElement.getAttribute("data-theme") || "light";
  wrap.classList.remove("rt-soft", "rt-dark");
  if (theme === "soft") wrap.classList.add("rt-soft");
  if (theme === "dark") wrap.classList.add("rt-dark");
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
  // Comments/ratings are independent of whether the book itself loads
  // cleanly - previously they were chained after loadBook() with .then(),
  // so any hiccup there silently skipped them too. Now they always run.
  loadBook().catch((e) => { console.error("loadBook error:", e); statusEl.textContent = "Something went wrong opening this book."; });
  loadComments();
  loadMyRating();
  loadRatingSummary();
});
