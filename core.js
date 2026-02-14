// core.js (v2 - fases + choferes por fase)
import { app, db, auth } from "./firebase-init.js";
import {
  collection, doc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

export const ADMIN_EMAIL = "pedro.l.oldani@gmail.com";
export const $ = (id) => document.getElementById(id);

export const STATE = {
  auth: { user:null, isAdmin:false },
  events: [],
  master: { drivers:[], passengers:[] },
  event: {
    id:null,
    phases: [],
    driverPhases: new Map(), // driverId -> {phaseId:true}
    passengersMeta: new Map(),
    assignments: new Map()
  },
  ui: { activePhase:null }
};
window.STATE = STATE;

export async function ensureAuth(){
  return new Promise(res=>{
    onAuthStateChanged(auth, u=>{
      STATE.auth.user = u||null;
      STATE.auth.isAdmin = !!(u && u.email===ADMIN_EMAIL);
      res(u||null);
    });
  });
}
export async function loginGoogle(){
  await signInWithPopup(auth, new GoogleAuthProvider());
}
export async function logout(){ await signOut(auth); }

export async function loadEvents(){
  const snap = await getDocs(query(collection(db,"events"), orderBy("dateStart")));
  STATE.events = snap.docs.map(d=>({id:d.id, ...d.data()}));
  return STATE.events;
}

export function setActivePhase(pid){ STATE.ui.activePhase = pid; }
export function getActivePhase(){ return STATE.ui.activePhase; }
export function getSelectedEventId(){
  return localStorage.getItem("eventId") || "";
}

export function setSelectedEventId(id){
  localStorage.setItem("eventId", id || "");
  STATE.event.id = id || null;
}

export async function loadEventContext(eventId){
  STATE.event.id = eventId;
  STATE.event.driverPhases.clear();
  STATE.event.passengersMeta.clear();
  STATE.event.assignments.clear();

  const ev = STATE.events.find(e=>e.id===eventId);
  STATE.event.phases = ev?.phases || [];
  if (!STATE.ui.activePhase && STATE.event.phases.length){
    STATE.ui.activePhase = STATE.event.phases[0].id;
  }

  const dSnap = await getDocs(collection(db,"events",eventId,"eventDrivers"));
  dSnap.forEach(d=>STATE.event.driverPhases.set(d.id, d.data().phases||{}));

  const pSnap = await getDocs(collection(db,"events",eventId,"eventPassengers"));
  pSnap.forEach(p=>STATE.event.passengersMeta.set(p.id, p.data()));

  const aSnap = await getDocs(collection(db,"events",eventId,"assignments"));
  aSnap.forEach(a=>STATE.event.assignments.set(a.id, a.data()));
}

export function driversForPhase(phaseId){
  return STATE.master.drivers.filter(d=>STATE.event.driverPhases.get(d.id)?.[phaseId]);
}

export async function saveDriverPhase(driverId, phaseId, enabled){
  const ref = doc(db,"events",STATE.event.id,"eventDrivers",driverId);
  await setDoc(ref,{ phases:{ [phaseId]:enabled }, updatedAt:serverTimestamp() },{merge:true});
}
// ===== MASTER DATA =====

export async function loadMasterDrivers(){
  const snap = await getDocs(
    query(collection(db, "drivers"), orderBy("lastName"))
  );

  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  arr.sort((a,b) =>
    `${a.lastName||""} ${a.firstName||""}`
      .localeCompare(`${b.lastName||""} ${b.firstName||""}`)
  );

  STATE.master.drivers = arr;
  return arr;
}

export async function loadMasterPassengers(){
  const snap = await getDocs(
    query(collection(db, "passengers"), orderBy("lastName"))
  );

  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  arr.sort((a,b) =>
    `${a.lastName||""} ${a.firstName||""}`
      .localeCompare(`${b.lastName||""} ${b.firstName||""}`)
  );

  STATE.master.passengers = arr;
  return arr;
}
