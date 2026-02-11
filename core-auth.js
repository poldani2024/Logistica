// core-auth.js
import { app, db } from "./firebase-init.js";

import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";

import {
  collection,
  getDocs,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

export const STATE = {
  auth: { user: null, isAdmin: false },
  events: [],
  eventId: null,
};

export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function toast(msg) {
  const t = $("toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => {
    t.classList.remove("show");
    t.textContent = "";
  }, 2200);
}

function showAuthGate(hint = "") {
  const g = $("authGate");
  if (!g) return;
  g.classList.add("show");
  const h = $("authGateHint");
  if (h) h.textContent = hint;
}
function hideAuthGate() {
  const g = $("authGate");
  if (!g) return;
  g.classList.remove("show");
  const h = $("authGateHint");
  if (h) h.textContent = "";
}

export async function loadEvents() {
  const snap = await getDocs(collection(db, "events"));
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Orden robusto: usa startAt si existe, si no usa date, si no 0
  const toMillis = (v) => {
    if (!v) return 0;
    if (v.toDate) return v.toDate().getTime();      // Timestamp
    const d = new Date(v);                           // string/Date
    return isNaN(d.getTime()) ? 0 : d.getTime();
  };

  arr.sort((a, b) => {
    const aa = toMillis(a.startAt ?? a.date);
    const bb = toMillis(b.startAt ?? b.date);
    return bb - aa;
  });

  STATE.events = arr;
  return arr;
}


export function renderEventSelect() {
  const sel = $("eventSelect");
  if (!sel) return;

  sel.innerHTML =
    (STATE.events || [])
      .map((ev) => {
        const name = ev.name ? ` — ${ev.name}` : "";
        return `<option value="${escapeHtml(ev.id)}">${escapeHtml(ev.id + name)}</option>`;
      })
      .join("") || `<option value="">(sin eventos)</option>`;

  if (STATE.eventId) sel.value = STATE.eventId;

  sel.onchange = () => {
    STATE.eventId = sel.value || null;
    if (STATE.eventId) localStorage.setItem("selectedEventId", STATE.eventId);
    document.dispatchEvent(new CustomEvent("eventChanged", { detail: { eventId: STATE.eventId } }));
  };
}

async function loginSmart(auth) {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // En mobile suele funcionar mejor redirect
    await signInWithRedirect(auth, provider);
  }
}

export async function initAuthAndEvents({ adminEmail }) {
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);

  // terminar redirect si lo hubo
  try { await getRedirectResult(auth); } catch {}

  $("btnGoogleLogin")?.addEventListener("click", () => loginSmart(auth));

  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      STATE.auth.user = user || null;

      if (!user) {
        STATE.auth.isAdmin = false;
        showAuthGate("");
        resolve(false);
        return;
      }

      hideAuthGate();
      STATE.auth.isAdmin = (String(user.email || "").toLowerCase() === String(adminEmail || "").toLowerCase());

      await loadEvents();

      // seleccionar evento (persistido)
      const saved = localStorage.getItem("selectedEventId");
      const found = saved ? STATE.events.find(e => e.id === saved) : null;
      STATE.eventId = found ? found.id : (STATE.events[0]?.id || null);

      renderEventSelect();
      resolve(true);
    });
  });
}
