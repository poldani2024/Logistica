// core.js (Firebase v10+ modular, multipágina, GitHub Pages)
// - NO usa `firebase.*` global
// - Exporta helpers y mantiene STATE
// - Centraliza auth + carga de masters + eventos + contexto de evento

import { app, db } from "./firebase-init.js";

// Auth (modular)
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";

// Firestore (modular)
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
  runTransaction,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

/* -------------------------
 * Constantes + helpers DOM
 * ------------------------- */

export const $ = (id) => document.getElementById(id);

export const ADMIN_EMAIL = "pedro.l.oldani@gmail.com";

/* -------------------------
 * Estado global
 * ------------------------- */

export const STATE = {
  auth: {
    user: null,
    isAdmin: false,
    driver: null // objeto driver master si matchea email
  },
  events: [],
  master: {
    drivers: [],
    passengers: []
  },
  event: {
    id: null,
    
    driverPhases: new Map(), // driverId -> {phaseId:true}
    phases: [],
driversIds: new Set(),
    passengersIds: new Set(),
    passengersMeta: new Map(), // passengerId -> meta (status/tracking/assignedDriverId/etc)
    assignments: new Map()     // driverId -> { driverId, passengerIds: [] }
  }
};

// Exponer para debug (multipágina)
window.STATE = STATE;

/* -------------------------
 * UI: escape + toast
 * ------------------------- */

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
  if (!el) {
    // fallback
    alert(msg);
    return;
  }
  el.textContent = String(msg ?? "");
  el.classList.add("show");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove("show");
    el.textContent = "";
  }, 2200);
}

/* -------------------------
 * Evento seleccionado (localStorage)
 * ------------------------- */

export function getSelectedEventId() {
  return localStorage.getItem("eventId") || "";
}

export function setSelectedEventId(id) {
  const v = (id || "").trim();
  localStorage.setItem("eventId", v);
  STATE.event.id = v || null;
}
export function driversForPhase(phaseId){
  const pid = String(phaseId || STATE.ui?.activePhase || "").trim();
  if (!pid) return [];

  const drivers = STATE.master?.drivers || [];
  const linked = STATE.event?.driversIds; // si usás el modelo viejo con Set()
  const map = STATE.event?.driverPhases;  // Map(driverId -> {phaseId:true})

  return drivers.filter(d => {
    // Si existe vínculo por evento (modelo viejo), respetarlo
    if (linked && typeof linked.has === "function" && !linked.has(d.id)) return false;

    // Si existe driverPhases (modelo nuevo), filtrar por fase
    if (map && typeof map.get === "function") {
      const phasesObj = map.get(d.id) || {};
      return phasesObj[pid] === true;
    }

    // Si no hay info de fases, no filtramos por fase
    return true;
  });
}
export function getActivePhaseId() {
  if (!STATE.event?.phases?.length) return null;

  const active = STATE.ui.activePhase;

  const exists = STATE.event.phases.some(p => p.id === active);
  return exists ? active : null;
}

/* -------------------------
 * Auth
 * ------------------------- */

export const auth = getAuth(app);

let _authReadyPromise = null;

/**
 * Inicializa auth una sola vez:
 * - setPersistence(local)
 * - suscribe onAuthStateChanged y completa STATE.auth
 * - devuelve el user (o null)
 */
export async function ensureAuth() {
  if (_authReadyPromise) return _authReadyPromise;

  _authReadyPromise = (async () => {
    // Importante: en algunos browsers puede fallar si storage está bloqueado
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (e) {
      console.warn("setPersistence warning:", e);
      // seguimos igual: auth puede funcionar sin persistencia
    }

    return new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        STATE.auth.user = user || null;
        const email = (user?.email || "").trim().toLowerCase();
        STATE.auth.isAdmin = email === ADMIN_EMAIL.toLowerCase();
        // driver se resuelve luego de cargar master drivers
        resolve(user || null);
        // No hacemos unsub: es útil mantenerlo para cambios de sesión.
        // Si preferís 1-shot: descomentá la línea siguiente.
        // unsub();
      });
    });
  })();

  return _authReadyPromise;
}

/** Alias de compatibilidad si alguna página llama waitForAuth */
window.waitForAuth = ensureAuth;

export async function loginGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

export async function logout() {
  await signOut(auth);
}

/* -------------------------
 * Carga de master data
 * ------------------------- */

export async function loadMasterDrivers() {
  // Si no tenés lastName en todos, el orderBy podría fallar.
  // Asumimos que existe. Si no, sacá orderBy y ordená en JS.
  const snap = await getDocs(query(collection(db, "drivers"), orderBy("lastName")));
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  arr.sort((a, b) =>
    `${a.lastName || ""} ${a.firstName || ""}`.localeCompare(`${b.lastName || ""} ${b.firstName || ""}`)
  );
  STATE.master.drivers = arr;
  return arr;
}

export async function loadMasterPassengers() {
  const snap = await getDocs(query(collection(db, "passengers"), orderBy("lastName")));
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  arr.sort((a, b) =>
    `${a.lastName || ""} ${a.firstName || ""}`.localeCompare(`${b.lastName || ""} ${b.firstName || ""}`)
  );
  STATE.master.passengers = arr;
  return arr;
}

export function resolveDriverRoleFromMaster() {
  const email = (STATE.auth.user?.email || "").trim().toLowerCase();
  if (!email) {
    STATE.auth.driver = null;
    return null;
  }
  const d =
    (STATE.master.drivers || []).find(x =>
      String(x.email || "").trim().toLowerCase() === email
    ) || null;

  STATE.auth.driver = d;
  return d;
}

/* -------------------------
 * Eventos
 * ------------------------- */

export async function loadEvents() {
  // Si dateStart es ISO string, orderBy funciona si todos tienen ese campo.
  const snap = await getDocs(query(collection(db, "events"), orderBy("dateStart")));
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  STATE.events = arr;
  return arr;
}

export function renderEventSelect() {
  const sel = $("eventSelect");
  if (!sel) return;

  const current = getSelectedEventId();

  const opts = (STATE.events || []).map(ev => {
    const name = ev.name ? ` — ${ev.name}` : "";
    return `<option value="${escapeHtml(ev.id)}">${escapeHtml(ev.id + name)}</option>`;
  });

  sel.innerHTML = opts.join("") || `<option value="">(sin eventos)</option>`;

  // Persistir si no hay guardado pero hay valor
  if (!current && sel.value) {
    setSelectedEventId(sel.value);
  }

  // Importante: evitar duplicar listeners si renderizás muchas veces
  if (!sel.dataset.bound) {
    sel.addEventListener("change", () => {
      setSelectedEventId(sel.value);
      document.dispatchEvent(
        new CustomEvent("eventChanged", { detail: { eventId: getSelectedEventId() } })
      );
      const hint = $("eventHint");
      if (hint) {
        hint.textContent = getSelectedEventId()
          ? `Evento activo: ${getSelectedEventId()}`
          : "No hay evento seleccionado";
      }
    });
    sel.dataset.bound = "1";
  }

  const hint = $("eventHint");
  if (hint) {
    hint.textContent = current ? `Evento activo: ${current}` : "No hay evento seleccionado";
  }
}

/* -------------------------
 * Contexto por evento (subcolecciones)
 * ------------------------- */

export async function loadEventContext(eventId) {
  const id = (eventId || getSelectedEventId() || "").trim();
  STATE.event.id = id || null;

  // reset contexto en memoria
  STATE.event.phases = [];
  STATE.event.driverPhases = new Map();
  STATE.event.driversIds = new Set();
  STATE.event.passengersIds = new Set();
  STATE.event.passengersMeta = new Map();
  STATE.event.assignments = new Map();

  if (!STATE.event.id) return;

  // 1) Cargar el doc del evento (fases, etc.)
  const evSnap = await getDoc(doc(db, "events", STATE.event.id));
  if (evSnap.exists()) {
    const ev = evSnap.data() || {};
    const phases = Array.isArray(ev.phases) ? ev.phases : [];
    STATE.event.phases = phases
      .map(p => ({ id: String(p.id || "").trim(), name: String(p.name || p.id || "").trim() }))
      .filter(p => p.id);
  }

  // 2) drivers links + disponibilidad por fase (phases en el doc del link)
  const dSnap = await getDocs(collection(db, "events", STATE.event.id, "eventDrivers"));
  dSnap.forEach(x => {
    STATE.event.driversIds.add(x.id);
    const data = x.data() || {};
    const phasesObj = (data.phases && typeof data.phases === "object") ? data.phases : {};
    STATE.event.driverPhases.set(x.id, phasesObj);
  });

  // 3) passengers links + meta
  const pSnap = await getDocs(collection(db, "events", STATE.event.id, "eventPassengers"));
  pSnap.forEach(x => {
    STATE.event.passengersIds.add(x.id);
    STATE.event.passengersMeta.set(x.id, x.data() || {});
  });

  // 4) assignments (1 doc por driverId)
  const aSnap = await getDocs(collection(db, "events", STATE.event.id, "assignments"));
  aSnap.forEach(x => {
    const data = x.data() || {};
    STATE.event.assignments.set(x.id, {
      driverId: x.id,
      passengerIds: Array.isArray(data.passengerIds) ? data.passengerIds : []
    });
  });
}
export async function saveDriverPhase(driverId, phaseId, enabled){
  if (!STATE.event?.id) throw new Error("No hay evento seleccionado");
  if (!driverId) throw new Error("Falta driverId");
  if (!phaseId) throw new Error("Falta phaseId");

  const ref = doc(db, "events", STATE.event.id, "eventDrivers", driverId);

  await setDoc(ref, {
    phases: { [phaseId]: !!enabled },
    updatedAt: serverTimestamp()
  }, { merge: true });

  // mantener STATE sincronizado en memoria
  STATE.event.driverPhases = STATE.event.driverPhases || new Map();
  const current = STATE.event.driverPhases.get(driverId) || {};
  current[phaseId] = !!enabled;
  STATE.event.driverPhases.set(driverId, current);
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

/* -------------------------
 * Mutaciones: eventos / links / asignaciones / tracking
 * ------------------------- */

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
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const driver = STATE.auth.driver;
  if (!driver) throw new Error("No sos chofer en el sistema");

  const a = assignmentForDriver(driver.id);
  if (!a.passengerIds.includes(passengerId)) {
    throw new Error("Ese pasajero no está asignado a vos");
  }

  const pRef = doc(db, "events", STATE.event.id, "eventPassengers", passengerId);
  await updateDoc(pRef, {
    trackingStatus: trackingStatus || "Pendiente",
    trackingNote: (trackingNote || "").trim(),
    trackingUpdatedAt: serverTimestamp(),
    trackingUpdatedBy: STATE.auth.user?.email || ""
  });
}

/* -------------------------
 * Inicialización por página
 * ------------------------- */

/**
 * initCorePage:
 * - engancha botones login/logout (si existen)
 * - ensureAuth()
 * - carga masters (drivers) para resolver rol chofer
 * - carga eventos + render selector
 * - carga contexto del evento activo (si existe)
 *
 * page: "home" | "events" | "drivers" | "passengers" | "assignments" | "tracking"
 */
export async function initCorePage({ page }) {
  // Botones auth (si existen)
 $("btnLogin")?.addEventListener("click", async () => {
  console.log("CLICK login"); // <-- agregado
  try {
    await loginGoogle();
    console.log("loginGoogle resolved");
  } catch (e) {
    console.error("loginGoogle error", e);
    toast(e.message || String(e));
  }
});

  $("btnLogout")?.addEventListener("click", async () => {
    try { await logout(); } catch (e) { console.error(e); toast(e.message || String(e)); }
  });

  // 1) Auth
  await ensureAuth();

  // UI status
  const st = $("authStatus");
  if (st) {
    const u = STATE.auth.user;
    st.textContent = u
      ? `Ingresado: ${u.email}${STATE.auth.isAdmin ? " (Admin)" : ""}`
      : "No ingresado";
  }

  if (!STATE.auth.user) {
    toast("Necesitás ingresar con Google para usar la app");
    return;
  }

  // 2) Master drivers -> resolver rol chofer
  await loadMasterDrivers();
  resolveDriverRoleFromMaster();

  // Update status con rol chofer si aplica
  if (st) {
    const u = STATE.auth.user;
    st.textContent = u
      ? `Ingresado: ${u.email}${STATE.auth.isAdmin ? " (Admin)" : (STATE.auth.driver ? " (Chofer)" : "")}`
      : "No ingresado";
  }

  // 3) Eventos + selector
  await loadEvents();
  renderEventSelect();

  $("btnReloadEvents")?.addEventListener("click", async () => {
    await loadEvents();
    renderEventSelect();
    toast("Eventos recargados");
  });

  // 4) Evento inicial
  setSelectedEventId(getSelectedEventId());
  if (getSelectedEventId()) {
    await loadEventContext(getSelectedEventId());
  }

  // Home: hint
  if (page === "home") {
    const hint = $("eventHint");
    if (hint) {
      hint.textContent = getSelectedEventId()
        ? `Evento activo: ${getSelectedEventId()}`
        : "No hay evento seleccionado";
    }
  }
}
