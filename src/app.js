import { initializeApp } from "firebase/app";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  connectFirestoreEmulator, collection, doc, onSnapshot, getDoc, writeBatch,
  updateDoc, deleteDoc, setDoc, serverTimestamp
} from "firebase/firestore";
import { FIREBASE_CONFIG } from "./config.build.js";

const CODE_KEY = "draaiboek.code";
const NAME_KEY = "draaiboek.naam";
const DB_SALT = "quakoken-draaiboek-db-v1";

// ---------- crypto ----------
const enc = new TextEncoder();
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const normalize = c => (c || "").trim().toLowerCase().replace(/\s+/g, "");

async function deriveAes(code, salt, iter) {
  const base = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}
async function decryptBundle(code) {
  const res = await fetch("content.enc.json", { cache: "no-cache" });
  const pkg = await res.json();
  const key = await deriveAes(code, b64(pkg.salt), pkg.iter);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(pkg.iv) }, key, b64(pkg.data));
  return JSON.parse(new TextDecoder().decode(plain)); // {html, seed}
}
async function dbKey(code) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(DB_SALT + ":" + code));
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

// ---------- lock screen ----------
const lock = document.getElementById("lock");
const lockForm = document.getElementById("lockform");
const lockErr = document.getElementById("lockerr");
const app = document.getElementById("app");

async function tryOpen(code, name, remember) {
  const data = await decryptBundle(code);
  try { if (remember) { localStorage.setItem(CODE_KEY, code); if (name) localStorage.setItem(NAME_KEY, name); } } catch (e) {}
  lock.hidden = true;
  app.innerHTML = data.html;
  app.hidden = false;
  document.title = data.title || "Draaiboek";
  initInstallHint();
  initActions(data.seed, data.owners, await dbKey(code));
}

lockForm.addEventListener("submit", async ev => {
  ev.preventDefault();
  const code = normalize(document.getElementById("code").value);
  const name = document.getElementById("naam").value.trim();
  if (!code) { lockErr.textContent = "Vul de toegangscode in."; lockErr.hidden = false; return; }
  const btn = lockForm.querySelector("button"); btn.disabled = true; btn.textContent = "Openen…";
  try { await tryOpen(code, name, true); }
  catch (e) {
    lockErr.textContent = navigator.onLine === false ? "Geen internet. Probeer het opnieuw zodra je verbinding hebt." : "Deze code klopt niet. Controleer hem en probeer het opnieuw.";
    lockErr.hidden = false; btn.disabled = false; btn.textContent = "Openen";
  }
});

(async () => {
  let saved = null;
  try { saved = localStorage.getItem(CODE_KEY); } catch (e) {}
  if (saved) {
    try { await tryOpen(saved, null, false); return; } catch (e) { try { localStorage.removeItem(CODE_KEY); } catch (_) {} }
  }
  lock.hidden = false;
  try { const n = localStorage.getItem(NAME_KEY); if (n) document.getElementById("naam").value = n; } catch (e) {}
})();

// ---------- install hint ----------
function initInstallHint() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const hint = document.getElementById("installhint");
  if (!hint) return;
  if (standalone) { hint.remove(); return; }
  let dismissed = false; try { dismissed = localStorage.getItem("draaiboek.hint") === "weg"; } catch (e) {}
  if (dismissed) { hint.remove(); return; }
  hint.hidden = false;
  hint.querySelector("button").addEventListener("click", () => { try { localStorage.setItem("draaiboek.hint", "weg"); } catch (e) {} hint.remove(); });
}

// ---------- actielijst ----------
function initActions(seed, OWNERS, key) {
  const NEXT = { open: "bezig", bezig: "klaar", klaar: "open" };
  const LABEL = { open: "Open", bezig: "Bezig", klaar: "Klaar" };
  const listEl = document.getElementById("alist");
  const filtersEl = document.getElementById("filters");
  const form = document.getElementById("addform");
  const ownerSel = document.getElementById("a-owner");
  const errEl = document.getElementById("a-err");
  const syncEl = document.getElementById("sync");
  const syncText = document.getElementById("synctext");
  let items = []; let filter = "Alle"; let pendingDelete = null;
  const me = () => { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } };

  OWNERS.forEach(o => { const op = document.createElement("option"); op.value = o; op.textContent = o; ownerSel.appendChild(op); });

  // Firebase
  const params = new URLSearchParams(location.search);
  const emu = params.get("emu");
  const fb = initializeApp(FIREBASE_CONFIG);
  let db;
  try { db = initializeFirestore(fb, { localCache: emu ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (e) { db = initializeFirestore(fb, { localCache: memoryLocalCache() }); }
  if (emu) connectFirestoreEmulator(db, "127.0.0.1", Number(emu));
  const metaRef = doc(db, "draaiboeken", key);
  const col = collection(db, "draaiboeken", key, "acties");

  function setSync(state, text) { syncEl.dataset.state = state; syncText.textContent = text; }

  function fmtWhen(ts) {
    if (!ts || !ts.toDate) return "";
    const d = ts.toDate();
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  }

  function renderFilters() {
    filtersEl.innerHTML = "";
    ["Alle", ...OWNERS].forEach(o => {
      const b = document.createElement("button"); b.type = "button"; b.className = "fchip"; b.textContent = o;
      b.setAttribute("aria-pressed", String(filter === o));
      b.addEventListener("click", () => { filter = o; renderFilters(); render(); });
      filtersEl.appendChild(b);
    });
    const c = document.createElement("span"); c.className = "count";
    c.textContent = items.filter(i => i.status !== "klaar").length + " open van " + items.length;
    filtersEl.appendChild(c);
  }

  function render() {
    const shown = items.filter(i => filter === "Alle" || i.eigenaar === filter)
      .sort((a, b) => (a.status === "klaar") - (b.status === "klaar") || (a.volgorde || 0) - (b.volgorde || 0));
    listEl.innerHTML = "";
    if (!shown.length) {
      const e = document.createElement("div"); e.className = "empty";
      e.textContent = items.length ? "Geen acties voor deze eigenaar." : "Nog geen acties. Voeg hieronder de eerste toe.";
      listEl.appendChild(e); return;
    }
    shown.forEach(it => {
      const row = document.createElement("div"); row.className = "aitem" + (it.status === "klaar" ? " done" : "");
      const st = document.createElement("button"); st.type = "button"; st.className = "status " + (it.status || "open");
      st.textContent = LABEL[it.status] || "Open";
      st.setAttribute("aria-label", "Status: " + (LABEL[it.status] || "Open") + ". Klik om te wijzigen");
      st.addEventListener("click", () => setStatus(it));
      const body = document.createElement("div");
      const t = document.createElement("div"); t.className = "atitle"; t.textContent = it.titel || "";
      const m = document.createElement("div"); m.className = "ameta";
      const o = document.createElement("span"); o.textContent = it.eigenaar || ""; m.appendChild(o);
      if (it.deadline) { const d = document.createElement("span"); d.textContent = "Deadline: " + it.deadline; m.appendChild(d); }
      body.appendChild(t); body.appendChild(m);
      if (it.notitie) { const n = document.createElement("div"); n.className = "anote"; n.textContent = it.notitie; body.appendChild(n); }
      if (it.door) {
        const w = document.createElement("div"); w.className = "awho";
        w.textContent = "Laatst gewijzigd door " + it.door + (it.gewijzigd ? " · " + fmtWhen(it.gewijzigd) : "");
        body.appendChild(w);
      }
      row.appendChild(st); row.appendChild(body);
      const del = document.createElement("button"); del.type = "button"; del.className = "adel";
      const confirming = pendingDelete === it.id;
      del.textContent = confirming ? "Zeker?" : "Verwijder"; if (confirming) del.classList.add("confirm");
      del.addEventListener("click", () => removeItem(it));
      row.appendChild(del);
      listEl.appendChild(row);
    });
  }

  function stamp() { return { door: me() || "Iemand", gewijzigd: serverTimestamp() }; }

  async function setStatus(it) {
    try { await updateDoc(doc(col, it.id), Object.assign({ status: NEXT[it.status] || "bezig" }, stamp())); }
    catch (e) { setSync("err", "Opslaan lukte niet. Probeer het opnieuw."); }
  }
  async function removeItem(it) {
    if (pendingDelete !== it.id) { pendingDelete = it.id; render(); setTimeout(() => { if (pendingDelete === it.id) { pendingDelete = null; render(); } }, 4000); return; }
    pendingDelete = null;
    try { await deleteDoc(doc(col, it.id)); } catch (e) { setSync("err", "Verwijderen lukte niet. Probeer het opnieuw."); }
  }

  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const title = document.getElementById("a-title").value.trim();
    if (!title) { errEl.textContent = "Vul eerst een omschrijving van de actie in."; errEl.hidden = false; return; }
    errEl.hidden = true;
    const max = items.reduce((m, i) => Math.max(m, i.volgorde || 0), 0);
    const id = "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const data = Object.assign({ titel: title.slice(0, 300), eigenaar: ownerSel.value, deadline: document.getElementById("a-deadline").value.trim().slice(0, 80), status: "open", notitie: "", volgorde: max + 1 }, stamp());
    document.getElementById("a-title").value = ""; document.getElementById("a-deadline").value = "";
    try { await setDoc(doc(col, id), data); }
    catch (e) { errEl.textContent = "Toevoegen lukte niet. Probeer het zo nog eens."; errEl.hidden = false; }
  });
  document.getElementById("a-title").addEventListener("input", () => { errEl.hidden = true; });

  renderFilters();

  // Seed once: only when the shared book has never been initialised
  (async () => {
    try {
      const meta = await getDoc(metaRef);
      if (!meta.exists() || !meta.data().seeded) {
        const batch = writeBatch(db);
        seed.forEach(s => { const { id, ...rest } = s; batch.set(doc(col, id), rest); });
        batch.set(metaRef, { seeded: true, sinds: serverTimestamp() });
        await batch.commit();
      }
    } catch (e) { /* offline: the snapshot listener will pick up data later */ }
  })();

  onSnapshot(col, { includeMetadataChanges: true }, snap => {
    items = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    if (snap.metadata.hasPendingWrites) setSync("pending", "Opslaan…");
    else if (snap.metadata.fromCache) setSync("offline", "Offline: je ziet de laatst bekende versie. Wijzigingen worden verstuurd zodra je weer verbinding hebt.");
    else setSync("ok", "Live verbonden: wijzigingen zijn direct zichtbaar voor iedereen.");
    renderFilters(); render();
  }, err => {
    setSync("err", "Geen verbinding met de gedeelde actielijst.");
    const e = document.getElementById("aempty"); if (e) e.textContent = "De actielijst kon niet geladen worden.";
  });
}

// ---------- service worker ----------
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
