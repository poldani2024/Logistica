import { app, db } from "./firebase-init.js";

// Auth
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";

// Firestore
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
  runTransaction,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

export const $ = (id) => document.getElementById(id);

export const ADMIN_EMAIL = "pedro.l.oldani@gmail.com";

export const STATE = {
  auth: {
    user: null,
    isAdmin: false,
    driver: null
  },
  events: [],
  master: {
    drivers: [],
    passengers: []
  },
  event: {
    id: null,
    driversIds: new Set(),
    passengersIds: new Set(),
    passengersMeta: new Map(), // passengerId -> meta (status/tracking/assignedDriverId/etc)
    assignments: new Map()      // driverId -> { passengerIds: [] }
  }
};
window.waitForAuth = function(){
  return new Promise((resolve) => {
    const unsub = firebase.auth().onAuthStateChanged((user) => {
      STATE.auth = STATE.auth || {};
      STATE.auth.user = user || null;
      STATE.auth.isAdmin = !!(user && user.email === "pedro.l.oldani@gmail.com");
      if (user){ unsub(); resolve(user); }
    });
  });
};

const auth = getAuth(app);

export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let _toastTimer = null;
export function toast(msg) {
  const el = $("toast");
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.classList.add("show");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove("show");
    el.textContent = "";
  }, 2200);
}

export function getSelectedEventId() {
  return localStorage.getItem("eventId") || "";
}

export function setSelectedEventId(id) {
  const v = (id || "").trim();
  localStorage.setItem("eventId", v);
  STATE.event.id = v || null;
}

export async function ensureAuth() {
  await setPersistence(auth, browserLocalPersistence);

  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      STATE.auth.user = user || null;
      const email = (user?.email || "").toLowerCase();
      STATE.auth.isAdmin = (email === ADMIN_EMAIL.toLowerCase());
      resolve(user || null);
    });
  });
}

export async function loginGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

export async function logout() {
  await signOut(auth);
}

export async function loadMasterDrivers() {
  const snap = await getDocs(query(collection(db, "drivers"), orderBy("lastName")));
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // fallback sorting (si no existe lastName en alguno)
  arr.sort((a,b)=> `${a.lastName||""} ${a.firstName||""}`.localeCompare(`${b.lastName||""} ${b.firstName||""}`));
  STATE.master.drivers = arr;
  return arr;
}

export async function loadMasterPassengers() {
  const snap = await getDocs(query(collection(db, "passengers"), orderBy("lastName")));
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  arr.sort((a,b)=> `${a.lastName||""} ${a.firstName||""}`.localeCompare(`${b.lastName||""} ${b.firstName||""}`));
  STATE.master.passengers = arr;
  return arr;
}

export function resolveDriverRoleFromMaster() {
  const email = (STATE.auth.user?.email || "").trim().toLowerCase();
  if (!email) { STATE.auth.driver = null; return null; }
  const d = (STATE.master.drivers || []).find(x => String(x.email||"").trim().toLowerCase() === email) || null;
  STATE.auth.driver = d;
  return d;
}

export async function loadEvents() {
  const snap = await getDocs(query(collection(db, "events"), orderBy("dateStart")));
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  STATE.events = arr;
  return arr;
}

export function renderEventSelect() {
  const sel = $("eventSelect");
  if (!sel) return;

  const current = getSelectedEventId();
  sel.innerHTML = (STATE.events || []).map(ev => {
    const name = ev.name ? ` — ${ev.name}` : "";
    return `<option value="${escapeHtml(ev.id)}">${escapeHtml(ev.id + name)}</option>`;
  }).join("") || `<option value="">(sin eventos)</option>`;

  // Si no hay eventId guardado pero el select tiene un valor, persistirlo
  if (!current && sel.value) {
    localStorage.setItem("eventId", sel.value);
    STATE.event.id = sel.value;
  }

  sel.addEventListener("change", () => {
    setSelectedEventId(sel.value);
    document.dispatchEvent(new CustomEvent("eventChanged", { detail: { eventId: getSelectedEventId() }}));
    const hint = $("eventHint");
    if (hint) hint.textContent = getSelectedEventId() ? `Evento activo: ${getSelectedEventId()}` : "No hay evento seleccionado";
  });

  const hint = $("eventHint");
  if (hint) hint.textContent = current ? `Evento activo: ${current}` : "No hay evento seleccionado";
}

export async function loadEventContext(eventId) {
  const id = (eventId || getSelectedEventId() || "").trim();
  STATE.event.id = id || null;

  STATE.event.driversIds = new Set();
  STATE.event.passengersIds = new Set();
  STATE.event.passengersMeta = new Map();
  STATE.event.assignments = new Map();

  if (!STATE.event.id) return;

  // drivers links
  const dSnap = await getDocs(collection(db, "events", STATE.event.id, "eventDrivers"));
  dSnap.forEach(x => STATE.event.driversIds.add(x.id));

  // passengers links + meta
  const pSnap = await getDocs(collection(db, "events", STATE.event.id, "eventPassengers"));
  pSnap.forEach(x => {
    STATE.event.passengersIds.add(x.id);
    STATE.event.passengersMeta.set(x.id, x.data() || {});
  });

  // assignments (1 doc por driverId)
  const aSnap = await getDocs(collection(db, "events", STATE.event.id, "assignments"));
  aSnap.forEach(x => {
    const data = x.data() || {};
    STATE.event.assignments.set(x.id, {
      driverId: x.id,
      passengerIds: Array.isArray(data.passengerIds) ? data.passengerIds : []
    });
  });
}

export function driversInEvent() {
  const ids = STATE.event.driversIds;
  return (STATE.master.drivers || []).filter(d => ids.has(d.id));
}

export function passengersInEvent() {
  const ids = STATE.event.passengersIds;
  return (STATE.master.passengers || [])
    .filter(p => ids.has(p.id))
    .map(p => ({ ...p, _event: (STATE.event.passengersMeta.get(p.id) || {}) }));
}

export function assignmentForDriver(driverId) {
  return STATE.event.assignments.get(driverId) || { driverId, passengerIds: [] };
}

export function assignedDriverIdForPassenger(passengerId) {
  const meta = STATE.event.passengersMeta.get(passengerId) || {};
  return meta.assignedDriverId || "";
}

export async function saveEvent({ id, name, dateStart, dateEnd, address, localidad }) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin puede guardar eventos");
  const eventId = (id || "").trim();
  if (!eventId) throw new Error("Falta ID del evento");

  const payload = {
    name: (name || "").trim(),
    dateStart: dateStart ? new Date(dateStart).toISOString() : null,
    dateEnd: dateEnd ? new Date(dateEnd).toISOString() : null,
    address: (address || "").trim(),
    localidad: (localidad || "").trim(),
    updatedAt: serverTimestamp()
  };
  // create/update
  await setDoc(doc(db, "events", eventId), payload, { merge: true });
}

export async function linkDriversToEvent(driverIds, enabled) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const batch = writeBatch(db);
  for (const id of driverIds) {
    const ref = doc(db, "events", STATE.event.id, "eventDrivers", id);
    if (enabled) batch.set(ref, { linkedAt: serverTimestamp() }, { merge: true });
    else batch.delete(ref);
  }
  await batch.commit();
}

export async function linkPassengersToEvent(passengerIds, enabled) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const batch = writeBatch(db);
  for (const id of passengerIds) {
    const ref = doc(db, "events", STATE.event.id, "eventPassengers", id);
    if (enabled) {
      batch.set(ref, {
        status: "Pendiente",
        trackingStatus: "Pendiente",
        trackingNote: "",
        assignedDriverId: "",
        linkedAt: serverTimestamp()
      }, { merge: true });
    } else {
      batch.delete(ref);
    }
  }
  await batch.commit();
}

export async function assignPassengerToDriver({ passengerId, driverId }) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const pRef = doc(db, "events", STATE.event.id, "eventPassengers", passengerId);
  const aRef = doc(db, "events", STATE.event.id, "assignments", driverId);

  await runTransaction(db, async (tx) => {
    const aSnap = await tx.get(aRef);
    const current = aSnap.exists() ? (aSnap.data().passengerIds || []) : [];
    const set = new Set(current);
    set.add(passengerId);

    tx.set(aRef, { passengerIds: Array.from(set), updatedAt: serverTimestamp() }, { merge: true });

    tx.set(pRef, {
      assignedDriverId: driverId,
      status: "Asignado",
      trackingUpdatedAt: serverTimestamp(),
      trackingUpdatedBy: STATE.auth.user?.email || ""
    }, { merge: true });
  });
}

export async function unassignPassenger({ passengerId, driverId }) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const pRef = doc(db, "events", STATE.event.id, "eventPassengers", passengerId);
  const aRef = doc(db, "events", STATE.event.id, "assignments", driverId);

  await runTransaction(db, async (tx) => {
    const aSnap = await tx.get(aRef);
    const current = aSnap.exists() ? (aSnap.data().passengerIds || []) : [];
    const next = current.filter(x => x !== passengerId);

    if (next.length) tx.set(aRef, { passengerIds: next, updatedAt: serverTimestamp() }, { merge: true });
    else tx.delete(aRef);

    tx.set(pRef, {
      assignedDriverId: "",
      status: "Pendiente",
      trackingUpdatedAt: serverTimestamp(),
      trackingUpdatedBy: STATE.auth.user?.email || ""
    }, { merge: true });
  });
}

export async function updateTrackingAsDriver({ passengerId, trackingStatus, trackingNote }) {
  // Driver solo puede actualizar tracking de un pasajero que está en SU lista (en este evento).
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");
  const driver = STATE.auth.driver;
  if (!driver) throw new Error("No sos chofer en el sistema");

  const a = assignmentForDriver(driver.id);
  if (!a.passengerIds.includes(passengerId)) throw new Error("Ese pasajero no está asignado a vos");

  const pRef = doc(db, "events", STATE.event.id, "eventPassengers", passengerId);
  await updateDoc(pRef, {
    trackingStatus: trackingStatus || "Pendiente",
    trackingNote: (trackingNote || "").trim(),
    trackingUpdatedAt: serverTimestamp(),
    trackingUpdatedBy: STATE.auth.user?.email || ""
  });
}

export async function initCorePage({ page }) {
  // Botones auth (si existen)
  $("btnLogin")?.addEventListener("click", async () => {
    try { await loginGoogle(); } catch (e) { console.error(e); toast(e.message || String(e)); }
  });
  $("btnLogout")?.addEventListener("click", async () => {
    try { await logout(); } catch (e) { console.error(e); toast(e.message || String(e)); }
  });

  await ensureAuth();
  // carga master para resolver rol chofer
  await loadMasterDrivers();
  resolveDriverRoleFromMaster();

  const st = $("authStatus");
  if (st) {
    const u = STATE.auth.user;
    st.textContent = u
      ? `Ingresado: ${u.email}${STATE.auth.isAdmin ? " (Admin)" : (STATE.auth.driver ? " (Chofer)" : "")}`
      : "No ingresado";
  }

  if (!STATE.auth.user) {
    toast("Necesitás ingresar con Google para usar la app");
    return;
  }

  // events + selector
  await loadEvents();
  renderEventSelect();

  $("btnReloadEvents")?.addEventListener("click", async () => {
    await loadEvents();
    renderEventSelect();
    toast("Eventos recargados");
  });

  // evento inicial
  setSelectedEventId(getSelectedEventId());
  if (getSelectedEventId()) await loadEventContext(getSelectedEventId());

  // home: solo muestra hint
  if (page === "home") {
    const hint = $("eventHint");
    if (hint) hint.textContent = getSelectedEventId() ? `Evento activo: ${getSelectedEventId()}` : "No hay evento seleccionado";
  }
}
window.STATE = STATE;
