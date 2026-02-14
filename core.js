// core.js (Firebase v10+ modular, multipágina, GitHub Pages)
// - NO usa `firebase.*` global
// - Exporta helpers y mantiene STATE
// - Centraliza auth + carga de masters + eventos + contexto de evento
// - Soporta "FASES" por evento (Ida/Vuelta/...): asignaciones y tracking por fase

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
  getDoc,
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

    // Fases del evento (Ida/Vuelta/...)
    phases: [],               // [{id,name,order}]
    activePhaseId: "ida",     // fase seleccionada

    driversIds: new Set(),
    passengersIds: new Set(),
    passengersMeta: new Map(), // passengerId -> meta

    // Asignaciones por fase:
    // key: `${phaseId}::${driverId}` -> { phaseId, driverId, passengerIds: [] }
    assignments: new Map()
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
  if (!el) { alert(String(msg ?? "")); return; }
  el.textContent = String(msg ?? "");
  el.classList.add("show");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove("show");
    el.textContent = "";
  }, 2200);
}

/* -------------------------
 * Storage helpers (evento + fase)
 * ------------------------- */
export function getSelectedEventId() {
  return localStorage.getItem("eventId") || "";
}
export function setSelectedEventId(id) {
  const v = (id || "").trim();
  localStorage.setItem("eventId", v);
  STATE.event.id = v || null;
}

function phaseKeyForEvent(eventId){
  return `phaseId:${(eventId || "").trim() || "none"}`;
}

export function getActivePhaseId(){
  const ev = STATE.event.id || getSelectedEventId();
  const raw = localStorage.getItem(phaseKeyForEvent(ev)) || "";
  return raw || STATE.event.activePhaseId || "ida";
}

export function setActivePhaseId(phaseId){
  const ev = STATE.event.id || getSelectedEventId();
  const pid = (phaseId || "").trim();
  if (!pid) return;
  localStorage.setItem(phaseKeyForEvent(ev), pid);
  STATE.event.activePhaseId = pid;
  document.dispatchEvent(new CustomEvent("phaseChanged", { detail: { phaseId: pid }}));
}

/* -------------------------
 * Normalización de fases
 * ------------------------- */
export function normalizePhases(phases){
  // Acepta: ["ida","vuelta"] o [{id,name,order}]
  let arr = [];
  if (Array.isArray(phases) && phases.length){
    if (typeof phases[0] === "string"){
      arr = phases
        .map((id, i) => ({ id: String(id||"").trim(), name: String(id||"").trim(), order: i+1 }))
        .filter(x => x.id);
    } else {
      arr = phases
        .map((p, i) => ({
          id: String(p?.id || "").trim(),
          name: String(p?.name || p?.id || "").trim() || String(p?.id||"").trim(),
          order: Number.isFinite(Number(p?.order)) ? Number(p.order) : (i+1)
        }))
        .filter(x => x.id);
    }
  }
  if (!arr.length){
    // Default: ida/vuelta
    arr = [
      { id: "ida", name: "Ida", order: 1 },
      { id: "vuelta", name: "Vuelta", order: 2 }
    ];
  }
  // ordenar + uniq
  arr.sort((a,b)=> (a.order||0) - (b.order||0));
  const seen = new Set();
  arr = arr.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  return arr;
}

export function phasesForEvent(){
  return Array.isArray(STATE.event.phases) ? STATE.event.phases : [];
}
export function activePhase(){
  const pid = getActivePhaseId();
  return phasesForEvent().find(p => p.id === pid) || phasesForEvent()[0] || { id:"ida", name:"Ida", order:1 };
}

/* -------------------------
 * Auth
 * ------------------------- */
const auth = getAuth(app);

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

/* -------------------------
 * Carga Master Data
 * ------------------------- */
export async function loadMasterDrivers() {
  const snap = await getDocs(query(collection(db, "drivers"), orderBy("lastName")));
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

/* -------------------------
 * Eventos + selector UI
 * ------------------------- */
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

/* -------------------------
 * Contexto de evento (drivers/passengers/assignments + fases)
 * ------------------------- */
function assignmentKey(phaseId, driverId){
  return `${phaseId}::${driverId}`;
}
function parseAssignmentDocId(docId){
  // Nuevo: phaseId__driverId  (preferido)
  if (docId.includes("__")){
    const [phaseId, ...rest] = docId.split("__");
    return { phaseId, driverId: rest.join("__") };
  }
  // Compat: phaseId_driverId (viejo)
  if (docId.includes("_")){
    const [phaseId, ...rest] = docId.split("_");
    return { phaseId, driverId: rest.join("_") };
  }
  // Muy viejo: docId = driverId (sin fases) => se interpreta como "ida"
  return { phaseId: "ida", driverId: docId };
}

function normalizePassengerMeta(meta){
  const m = meta || {};
  // migración en memoria: si existía assignedDriverId, lo pasamos a assigned.ida
  if (!m.assigned && m.assignedDriverId){
    m.assigned = { ida: m.assignedDriverId };
  }
  if (!m.statusByPhase && m.status){
    m.statusByPhase = { ida: m.status };
  }
  if (!m.trackingByPhase && m.trackingStatus){
    m.trackingByPhase = { ida: { trackingStatus: m.trackingStatus, note: m.trackingNote || "" } };
  }
  return m;
}

export async function loadEventContext(eventId) {
  const id = (eventId || getSelectedEventId() || "").trim();
  STATE.event.id = id || null;

  STATE.event.driversIds = new Set();
  STATE.event.passengersIds = new Set();
  STATE.event.passengersMeta = new Map();
  STATE.event.assignments = new Map();

  if (!STATE.event.id) return;

  // 1) Cargar fases desde el doc del evento
  try{
    const evSnap = await getDoc(doc(db, "events", STATE.event.id));
    const evData = evSnap.exists() ? (evSnap.data() || {}) : {};
    STATE.event.phases = normalizePhases(evData.phases);
  }catch{
    STATE.event.phases = normalizePhases(null);
  }

  // 2) Resolver fase activa (persistida por evento)
  const storedPhase = localStorage.getItem(phaseKeyForEvent(STATE.event.id)) || "";
  const first = STATE.event.phases[0]?.id || "ida";
  const ok = STATE.event.phases.some(p => p.id === storedPhase);
  STATE.event.activePhaseId = ok ? storedPhase : first;
  localStorage.setItem(phaseKeyForEvent(STATE.event.id), STATE.event.activePhaseId);

  // drivers links
  const dSnap = await getDocs(collection(db, "events", STATE.event.id, "eventDrivers"));
  dSnap.forEach(x => STATE.event.driversIds.add(x.id));

  // passengers links + meta
  const pSnap = await getDocs(collection(db, "events", STATE.event.id, "eventPassengers"));
  pSnap.forEach(x => {
    STATE.event.passengersIds.add(x.id);
    STATE.event.passengersMeta.set(x.id, normalizePassengerMeta(x.data() || {}));
  });

  // assignments (por fase)
  const aSnap = await getDocs(collection(db, "events", STATE.event.id, "assignments"));
  aSnap.forEach(x => {
    const data = x.data() || {};
    const parsed = parseAssignmentDocId(x.id);
    const phaseId = parsed.phaseId || "ida";
    const driverId = parsed.driverId;
    const passengerIds = Array.isArray(data.passengerIds) ? data.passengerIds : [];
    STATE.event.assignments.set(assignmentKey(phaseId, driverId), {
      phaseId,
      driverId,
      passengerIds
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

export function assignmentForDriverPhase(driverId, phaseId = getActivePhaseId()) {
  return STATE.event.assignments.get(assignmentKey(phaseId, driverId)) || { phaseId, driverId, passengerIds: [] };
}

// Backward compat: "ida"
export function assignmentForDriver(driverId) {
  return assignmentForDriverPhase(driverId, "ida");
}

export function assignedDriverIdForPassengerPhase(passengerId, phaseId = getActivePhaseId()){
  const meta = STATE.event.passengersMeta.get(passengerId) || {};
  if (meta.assigned && meta.assigned[phaseId]) return meta.assigned[phaseId] || "";
  if (phaseId === "ida" && meta.assignedDriverId) return meta.assignedDriverId || "";
  return "";
}

// Backward compat: "ida"
export function assignedDriverIdForPassenger(passengerId) {
  return assignedDriverIdForPassengerPhase(passengerId, "ida");
}

/* -------------------------
 * Mutaciones: eventos / links / asignaciones / tracking
 * ------------------------- */
export async function saveEvent({ id, name, dateStart, dateEnd, address, localidad, phases }) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin puede guardar eventos");

  const eventId = (id || "").trim();
  if (!eventId) throw new Error("Falta ID del evento");

  const payload = {
    name: (name || "").trim(),
    dateStart: dateStart ? new Date(dateStart).toISOString() : null,
    dateEnd: dateEnd ? new Date(dateEnd).toISOString() : null,
    address: (address || "").trim(),
    localidad: (localidad || "").trim(),
    phases: normalizePhases(phases),
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
        assigned: {},          // {phaseId: driverId}
        statusByPhase: {},     // {phaseId: "Pendiente|Asignado"}
        trackingByPhase: {},   // {phaseId: {trackingStatus, note}}
        linkedAt: serverTimestamp()
      }, { merge: true });
    } else {
      batch.delete(ref);
    }
  }
  await batch.commit();
}

function assignmentDocId(phaseId, driverId){
  return `${phaseId}__${driverId}`;
}

export async function assignPassengerToDriverPhase({ passengerId, driverId, phaseId }) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const pid = (phaseId || getActivePhaseId() || "ida").trim();
  const pRef = doc(db, "events", STATE.event.id, "eventPassengers", passengerId);
  const aRef = doc(db, "events", STATE.event.id, "assignments", assignmentDocId(pid, driverId));

  await runTransaction(db, async (tx) => {
    // leer pasajero meta para sacar asignación previa en esa fase
    const pSnap = await tx.get(pRef);
    const pMeta = pSnap.exists() ? normalizePassengerMeta(pSnap.data() || {}) : { assigned:{}, statusByPhase:{}, trackingByPhase:{} };
    const prevDriver = (pMeta.assigned && pMeta.assigned[pid]) ? pMeta.assigned[pid] : "";

    // si estaba asignado a otro chofer en la misma fase, removerlo de su lista
    if (prevDriver && prevDriver !== driverId){
      const prevRef = doc(db, "events", STATE.event.id, "assignments", assignmentDocId(pid, prevDriver));
      const prevSnap = await tx.get(prevRef);
      if (prevSnap.exists()){
        const cur = prevSnap.data()?.passengerIds || [];
        const next = Array.isArray(cur) ? cur.filter(x => x !== passengerId) : [];
        if (next.length) tx.set(prevRef, { passengerIds: next, phaseId: pid, driverId: prevDriver, updatedAt: serverTimestamp() }, { merge:true });
        else tx.delete(prevRef);
      }
    }

    // sumar pasajero al nuevo chofer
    const aSnap = await tx.get(aRef);
    const current = aSnap.exists() ? (aSnap.data().passengerIds || []) : [];
    const set = new Set(Array.isArray(current) ? current : []);
    set.add(passengerId);

    tx.set(aRef, { phaseId: pid, driverId, passengerIds: Array.from(set), updatedAt: serverTimestamp() }, { merge: true });

    // actualizar pasajero meta por fase
    const assigned = { ...(pMeta.assigned || {}) };
    assigned[pid] = driverId;

    const statusByPhase = { ...(pMeta.statusByPhase || {}) };
    statusByPhase[pid] = "Asignado";

    const trackingByPhase = { ...(pMeta.trackingByPhase || {}) };
    if (!trackingByPhase[pid]) trackingByPhase[pid] = { trackingStatus: "Pendiente", note: "" };

    tx.set(pRef, {
      assigned,
      statusByPhase,
      trackingByPhase,
      updatedAt: serverTimestamp(),
      assignedUpdatedAt: serverTimestamp(),
      assignedUpdatedBy: STATE.auth.user?.email || ""
    }, { merge: true });
  });
}

export async function unassignPassengerPhase({ passengerId, phaseId }) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const pid = (phaseId || getActivePhaseId() || "ida").trim();
  const pRef = doc(db, "events", STATE.event.id, "eventPassengers", passengerId);

  await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(pRef);
    if (!pSnap.exists()) return;
    const pMeta = normalizePassengerMeta(pSnap.data() || {});
    const prevDriver = (pMeta.assigned && pMeta.assigned[pid]) ? pMeta.assigned[pid] : "";
    if (prevDriver){
      const prevRef = doc(db, "events", STATE.event.id, "assignments", assignmentDocId(pid, prevDriver));
      const prevSnap = await tx.get(prevRef);
      if (prevSnap.exists()){
        const cur = prevSnap.data()?.passengerIds || [];
        const next = Array.isArray(cur) ? cur.filter(x => x !== passengerId) : [];
        if (next.length) tx.set(prevRef, { passengerIds: next, phaseId: pid, driverId: prevDriver, updatedAt: serverTimestamp() }, { merge:true });
        else tx.delete(prevRef);
      }
    }

    const assigned = { ...(pMeta.assigned || {}) };
    delete assigned[pid];

    const statusByPhase = { ...(pMeta.statusByPhase || {}) };
    statusByPhase[pid] = "Pendiente";

    const trackingByPhase = { ...(pMeta.trackingByPhase || {}) };
    if (!trackingByPhase[pid]) trackingByPhase[pid] = { trackingStatus:"Pendiente", note:"" };

    tx.set(pRef, {
      assigned,
      statusByPhase,
      trackingByPhase,
      updatedAt: serverTimestamp(),
      assignedUpdatedAt: serverTimestamp(),
      assignedUpdatedBy: STATE.auth.user?.email || ""
    }, { merge:true });
  });
}

// Backward compat (ida)
export async function assignPassengerToDriver({ passengerId, driverId }) {
  return assignPassengerToDriverPhase({ passengerId, driverId, phaseId: "ida" });
}
export async function unassignPassenger({ passengerId, driverId }) {
  // driverId ignored; compat only
  return unassignPassengerPhase({ passengerId, phaseId: "ida" });
}

export async function copyAssignmentsPhase({ fromPhaseId, toPhaseId, onlyIfEmpty = true }){
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const fromId = (fromPhaseId || "").trim();
  const toId = (toPhaseId || "").trim();
  if (!fromId || !toId) throw new Error("Falta fase origen/destino");
  if (fromId === toId) throw new Error("La fase destino debe ser distinta");

  // cargar contexto para estar al día (por si algo cambió)
  await loadEventContext(STATE.event.id);

  const drivers = driversInEvent();
  const passengers = passengersInEvent();

  // Para cada pasajero: copiar assigned[from] -> assigned[to]
  for (const p of passengers){
    const meta = p._event || {};
    const assigned = meta.assigned || {};
    const fromDriver = assigned[fromId] || "";
    const toDriver = assigned[toId] || "";

    if (!fromDriver) continue;
    if (onlyIfEmpty && toDriver) continue;

    await assignPassengerToDriverPhase({ passengerId: p.id, driverId: fromDriver, phaseId: toId });
  }
}

/* -------------------------
 * Tracking por chofer (por fase)
 * ------------------------- */
export async function updateTrackingAsDriverPhase({ passengerId, phaseId, trackingStatus, trackingNote }) {
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");
  const driver = STATE.auth.driver;
  if (!driver) throw new Error("No sos chofer en el sistema");

  const pid = (phaseId || getActivePhaseId() || "ida").trim();

  // Validación: pasajero tiene que estar asignado a este chofer en esa fase
  const assignedTo = assignedDriverIdForPassengerPhase(passengerId, pid);
  if (assignedTo !== driver.id) throw new Error("Ese pasajero no está asignado a vos en esta fase");

  const pRef = doc(db, "events", STATE.event.id, "eventPassengers", passengerId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(pRef);
    const meta = snap.exists() ? normalizePassengerMeta(snap.data() || {}) : {};
    const trackingByPhase = { ...(meta.trackingByPhase || {}) };
    trackingByPhase[pid] = {
      trackingStatus: trackingStatus || "Pendiente",
      note: (trackingNote || "").trim()
    };

    tx.set(pRef, {
      trackingByPhase,
      updatedAt: serverTimestamp(),
      trackingUpdatedAt: serverTimestamp(),
      trackingUpdatedBy: STATE.auth.user?.email || ""
    }, { merge:true });
  });
}

// Backward compat
export async function updateTrackingAsDriver({ passengerId, trackingStatus, trackingNote }) {
  return updateTrackingAsDriverPhase({ passengerId, phaseId: "ida", trackingStatus, trackingNote });
}

/* -------------------------
 * init común por página
 * ------------------------- */
export async function initCorePage({ page }) {
  // auth buttons (si existen)
  $("btnLogin")?.addEventListener("click", async () => {
    try { await loginGoogle(); } catch (e) { console.error(e); toast(e.message || String(e)); }
  });

  $("btnLogout")?.addEventListener("click", async () => {
    try{
      const ok = confirm("¿Querés cerrar sesión?");
      if (!ok) return;
      await logout();
      // refrescar para limpiar estado visual
      location.reload();
    }catch (e) {
      console.error(e); toast(e.message || String(e));
    }
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
  if (getSelectedEventId()){
    await loadEventContext(getSelectedEventId());
    // avisar fase actual
    document.dispatchEvent(new CustomEvent("phaseChanged", { detail: { phaseId: getActivePhaseId() }}));
  }

  // home: solo muestra hint
  if (page === "home") {
    const hint = $("eventHint");
    if (hint) hint.textContent = getSelectedEventId() ? `Evento activo: ${getSelectedEventId()}` : "No hay evento seleccionado";
  }
}
