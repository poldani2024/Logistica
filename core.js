
// core.js — estado global + auth + helpers + carga de contexto de evento
import { auth, provider, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

export const STATE = {
  auth: {
    user: null,
    isAdmin: false,
    driver: null
  },
  master: {
    drivers: [],
    passengers: []
  },
  events: [],
  event: {
    id: null,
    phases: [],
    driverPhases: new Map(),   // driverId -> {phaseId:true/false}
    driversIds: new Set(),
    passengersIds: new Set(),
    passengersMeta: new Map(),
    assignments: new Map()     // driverId -> {driverId, passengerIds:[]}
  },
  ui: {
    activePhase: null
  }
};

export function qs(sel){ return document.querySelector(sel); }
export function el(id){ return document.getElementById(id); }
export function safeEl(id){
  const x = el(id);
  if(!x) console.warn(`[core] Missing element #${id}`);
  return x;
}

export function requireEventId(){
  const id = (STATE.event?.id || getSelectedEventId() || "").trim();
  if(!id) throw new Error("No hay evento seleccionado");
  return id;
}

export function getSelectedEventId(){
  return localStorage.getItem("eventId") || "";
}
export function setSelectedEventId(eventId){
  localStorage.setItem("eventId", eventId || "");
}

export function getActivePhaseId(){
  if(!STATE.event?.phases?.length) return null;
  const active = String(STATE.ui?.activePhase || "").trim();
  const exists = STATE.event.phases.some(p => p.id === active);
  return exists ? active : (STATE.event.phases[0]?.id || null);
}

export function setActivePhaseId(phaseId){
  STATE.ui.activePhase = phaseId || null;
  localStorage.setItem("activePhase", STATE.ui.activePhase || "");
}

export function driversForPhase(phaseId){
  const pid = phaseId || getActivePhaseId();
  if(!pid) return [];
  const ids = Array.from(STATE.event.driversIds || []);
  return ids.filter(did => {
    const phases = STATE.event.driverPhases?.get(did) || {};
    return !!phases[pid];
  });
}

export async function loadMasterData(){
  // drivers
  const dSnap = await getDocs(collection(db, "drivers"));
  STATE.master.drivers = dSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b)=> (a.name||"").localeCompare(b.name||""));

  // passengers
  const pSnap = await getDocs(collection(db, "passengers"));
  STATE.master.passengers = pSnap.docs.map(p => ({ id: p.id, ...p.data() })).sort((a,b)=> (a.name||"").localeCompare(b.name||""));
}

export async function loadEvents(){
  const eSnap = await getDocs(collection(db, "events"));
  STATE.events = eSnap.docs.map(e => ({ id: e.id, ...e.data() })).sort((a,b)=> (a.title||"").localeCompare(b.title||""));
}

export async function loadEventContext(eventId){
  const id = (eventId || getSelectedEventId() || "").trim();
  STATE.event.id = id || null;

  // reset
  STATE.event.phases = [];
  STATE.event.driverPhases = new Map();
  STATE.event.driversIds = new Set();
  STATE.event.passengersIds = new Set();
  STATE.event.passengersMeta = new Map();
  STATE.event.assignments = new Map();

  if(!STATE.event.id) return;

  // phases desde el doc del evento
  const evSnap = await getDoc(doc(db, "events", STATE.event.id));
  if(evSnap.exists()){
    const ev = evSnap.data() || {};
    const phases = Array.isArray(ev.phases) ? ev.phases : [];
    STATE.event.phases = phases
      .map(p => ({ id: String(p.id||"").trim(), name: String(p.name||p.id||"").trim() }))
      .filter(p => p.id);
  }

  // activePhase: localStorage o primera
  const remembered = String(localStorage.getItem("activePhase") || "").trim();
  const valid = STATE.event.phases.some(p => p.id === remembered);
  STATE.ui.activePhase = valid ? remembered : (STATE.event.phases[0]?.id || null);

  // eventDrivers
  const dSnap = await getDocs(collection(db, "events", STATE.event.id, "eventDrivers"));
  dSnap.forEach(x => {
    STATE.event.driversIds.add(x.id);
    const data = x.data() || {};
    const phasesObj = (data.phases && typeof data.phases === "object") ? data.phases : {};
    STATE.event.driverPhases.set(x.id, phasesObj);
  });

  // eventPassengers
  const pSnap = await getDocs(collection(db, "events", STATE.event.id, "eventPassengers"));
  pSnap.forEach(x => {
    STATE.event.passengersIds.add(x.id);
    STATE.event.passengersMeta.set(x.id, x.data() || {});
  });

  // assignments (driverId como docId)
  const aSnap = await getDocs(collection(db, "events", STATE.event.id, "assignments"));
  aSnap.forEach(x => {
    const data = x.data() || {};
    STATE.event.assignments.set(x.id, {
      driverId: x.id,
      passengerIds: Array.isArray(data.passengerIds) ? data.passengerIds : []
    });
  });
}

export async function saveEventPhases(eventId, phases){
  const id = (eventId || requireEventId()).trim();
  await updateDoc(doc(db, "events", id), { phases });
}

export async function upsertEventDriverPhase(eventId, driverId, phaseId, value){
  const eid = (eventId || requireEventId()).trim();
  const ref = doc(db, "events", eid, "eventDrivers", driverId);
  // merge
  await setDoc(ref, { phases: { [phaseId]: !!value }, updatedAt: serverTimestamp() }, { merge: true });
}

export async function linkPassengerToEvent(eventId, passengerId, meta = {}){
  const eid = (eventId || requireEventId()).trim();
  const ref = doc(db, "events", eid, "eventPassengers", passengerId);
  await setDoc(ref, { ...meta, updatedAt: serverTimestamp() }, { merge: true });
}

export async function unlinkPassengerFromEvent(eventId, passengerId){
  const eid = (eventId || requireEventId()).trim();
  const ref = doc(db, "events", eid, "eventPassengers", passengerId);
  await deleteDoc(ref);
}

export async function setAssignment(eventId, driverId, passengerIds){
  const eid = (eventId || requireEventId()).trim();
  const ref = doc(db, "events", eid, "assignments", driverId);
  await setDoc(ref, { passengerIds: passengerIds || [], updatedAt: serverTimestamp() }, { merge: true });
}

export async function ensureHeader(){
  const host = safeEl("appHeader");
  if(!host) return;

  // events loaded?
  await loadEvents();

  const eventId = (getSelectedEventId() || "");
  const user = STATE.auth.user;

  host.innerHTML = `
  <div class="header">
    <div class="header-inner">
      <div class="brand">
        <div class="title">Gestión de Transporte Soka Gakkai</div>
        <div class="subtitle">Rosario / Gran Rosario</div>
      </div>

      <div class="row" style="gap:8px; margin-left:16px;">
        <span class="pill">Evento</span>
        <select id="eventSelect" aria-label="Evento activo"></select>
        <button id="btnHome" class="btn-primary">Home</button>
      </div>

      <div class="nav">
        <span class="badge" id="userBadge">${user ? (user.displayName || user.email) : "No logueado"}</span>
        <button id="btnLogin" class="btn-primary">${user ? "Cambiar cuenta" : "Ingresar"}</button>
        <button id="btnLogout" class="btn-danger">Salir</button>
      </div>
    </div>
  </div>
  `;

  // fill events
  const sel = safeEl("eventSelect");
  sel.innerHTML = `<option value="">— seleccionar —</option>` + STATE.events.map(e => {
    const title = (e.title || e.name || e.id);
    return `<option value="${e.id}">${title}</option>`;
  }).join("");

  sel.value = eventId;

  safeEl("btnHome").onclick = ()=> location.href = "./index.html";
  safeEl("btnLogin").onclick = async ()=> {
    await signInWithPopup(auth, provider);
  };
  safeEl("btnLogout").onclick = async ()=> {
    if(confirm("¿Querés salir?")){
      await signOut(auth);
      location.href = "./index.html";
    }
  };

  sel.onchange = async ()=>{
    setSelectedEventId(sel.value);
    await loadEventContext(sel.value);
    // refresh current page
    location.reload();
  };
}

export function requireAuth(){
  if(!STATE.auth.user) throw new Error("Debés iniciar sesión.");
}

export function startAuth(){
  return new Promise((resolve)=>{
    onAuthStateChanged(auth, async (user)=>{
      STATE.auth.user = user || null;
      // admin simple: por dominio o lista (ajustar si querés)
      const email = user?.email || "";
      STATE.auth.isAdmin = email.endsWith("@gmail.com") || email.endsWith("@cargill.com");
      resolve(user || null);
    });
  });
}

// Utilidad: nombre por id
export function driverName(driverId){
  const d = STATE.master.drivers.find(x => x.id === driverId);
  return d?.name || driverId;
}
export function passengerName(passengerId){
  const p = STATE.master.passengers.find(x => x.id === passengerId);
  return p?.name || passengerId;
}
