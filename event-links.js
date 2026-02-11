import { db } from "./firebase-init.js";
import { initAuthAndEvents, STATE, toast, escapeHtml, loadEvents, renderEventSelect } from "./core-auth.js";

import {
  collection, doc, getDocs, query, orderBy,
  writeBatch, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
let DRIVERS = [];
let PASSENGERS = [];
let LINKED_DRIVER_IDS = new Set();
let LINKED_PASSENGER_IDS = new Set();

function fullName(x){ return `${x.lastName||""} ${x.firstName||""}`.trim(); }

async function loadDriversAll(){
  const snap = await getDocs(query(collection(db,"drivers"), orderBy("lastName","asc")));
  DRIVERS = snap.docs.map(d=>({id:d.id, ...d.data()}));
}
async function loadPassengersAll(){
  const snap = await getDocs(query(collection(db,"passengers"), orderBy("lastName","asc")));
  PASSENGERS = snap.docs.map(d=>({id:d.id, ...d.data()}));
}

async function loadEventLinks(){
  LINKED_DRIVER_IDS = new Set();
  LINKED_PASSENGER_IDS = new Set();
  if(!STATE.eventId) return;

  const dSnap = await getDocs(collection(db,"events",STATE.eventId,"eventDrivers"));
  dSnap.forEach(x => LINKED_DRIVER_IDS.add(x.id));

  const pSnap = await getDocs(collection(db,"events",STATE.eventId,"eventPassengers"));
  pSnap.forEach(x => LINKED_PASSENGER_IDS.add(x.id));
}

function renderDrivers(){
  const qtxt = ($("driverSearch2").value||"").toLowerCase();
  const rows = DRIVERS
    .filter(d=>{
      const hay = `${fullName(d)} ${d.phone||""} ${d.email||""} ${d.zone||""}`.toLowerCase();
      return !qtxt || hay.includes(qtxt);
    })
    .map(d=>{
      const inEvent = LINKED_DRIVER_IDS.has(d.id);
      return `
        <tr>
          <td><input type="checkbox" data-pick-driver="${escapeHtml(d.id)}"></td>
          <td><strong>${escapeHtml(fullName(d))}</strong><div class="muted">${escapeHtml(d.email||"")}</div></td>
          <td>${escapeHtml(d.phone||"")}</td>
          <td><span class="tag">${escapeHtml(d.zone||"")}</span></td>
          <td class="muted">${inEvent ? "✅ en evento" : "—"}</td>
          <td>
            ${inEvent
              ? `<button class="btnDanger" data-remove-driver="${escapeHtml(d.id)}">Sacar</button>`
              : `<button class="btn" data-assign-driver="${escapeHtml(d.id)}">Asociar</button>`
            }
          </td>
        </tr>
      `;
    }).join("");

  $("driversTable2").innerHTML = `
    <table>
      <thead><tr><th></th><th>Chofer</th><th>Tel</th><th>Zona</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="muted">No hay choferes</td></tr>`}</tbody>
    </table>
  `;

  $("driversTable2").querySelectorAll("button[data-assign-driver]").forEach(b=>{
    b.addEventListener("click", ()=> linkDrivers([b.dataset.assignDriver], true));
  });
  $("driversTable2").querySelectorAll("button[data-remove-driver]").forEach(b=>{
    b.addEventListener("click", ()=> linkDrivers([b.dataset.removeDriver], false));
  });
}

function renderPassengers(){
  const qtxt = ($("passSearch2").value||"").toLowerCase();
  const rows = PASSENGERS
    .filter(p=>{
      const hay = `${fullName(p)} ${p.phone||""} ${p.address||""} ${p.zone||""}`.toLowerCase();
      return !qtxt || hay.includes(qtxt);
    })
    .map(p=>{
      const inEvent = LINKED_PASSENGER_IDS.has(p.id);
      return `
        <tr>
          <td><input type="checkbox" data-pick-pass="${escapeHtml(p.id)}"></td>
          <td><strong>${escapeHtml(fullName(p))}</strong><div class="muted">${escapeHtml(p.phone||"")}</div></td>
          <td>${escapeHtml(p.address||"")}</td>
          <td><span class="tag">${escapeHtml(p.zone||"")}</span></td>
          <td class="muted">${inEvent ? "✅ en evento" : "—"}</td>
          <td>
            ${inEvent
              ? `<button class="btnDanger" data-remove-pass="${escapeHtml(p.id)}">Sacar</button>`
              : `<button class="btn" data-assign-pass="${escapeHtml(p.id)}">Asociar</button>`
            }
          </td>
        </tr>
      `;
    }).join("");

  $("passengersTable2").innerHTML = `
    <table>
      <thead><tr><th></th><th>Joven</th><th>Dirección</th><th>Zona</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="muted">No hay pasajeros</td></tr>`}</tbody>
    </table>
  `;

  $("passengersTable2").querySelectorAll("button[data-assign-pass]").forEach(b=>{
    b.addEventListener("click", ()=> linkPassengers([b.dataset.assignPass], true));
  });
  $("passengersTable2").querySelectorAll("button[data-remove-pass]").forEach(b=>{
    b.addEventListener("click", ()=> linkPassengers([b.dataset.removePass], false));
  });
}

function pickedIds(attr){
  return Array.from(document.querySelectorAll(`input[${attr}]:checked`)).map(x=>x.getAttribute(attr));
}

async function linkDrivers(ids, add){
  if(!STATE.eventId) return alert("Seleccioná un evento");
  if(!ids.length) return toast("No hay seleccionados");

  const batch = writeBatch(db);
  for(const driverId of ids){
    const ref = doc(db,"events",STATE.eventId,"eventDrivers",driverId);
    if(add){
      batch.set(ref, { driverId, createdAt: serverTimestamp(), active:true }, { merge:true });
    } else {
      batch.delete(ref);
      // (opcional) también podrías borrar assignment del chofer en este evento
      // batch.delete(doc(db,"events",STATE.eventId,"assignments",driverId));
    }
  }
  await batch.commit();
  toast(add ? "Chofer(es) asociados" : "Chofer(es) quitados");
  await loadEventLinks();
  renderDrivers();
}

async function linkPassengers(ids, add){
  if(!STATE.eventId) return alert("Seleccioná un evento");
  if(!ids.length) return toast("No hay seleccionados");

  const batch = writeBatch(db);
  for(const passengerId of ids){
    const ref = doc(db,"events",STATE.eventId,"eventPassengers",passengerId);
    if(add){
      batch.set(ref, { passengerId, createdAt: serverTimestamp(), status:"unassigned", assignedDriverId:null }, { merge:true });
    } else {
      batch.delete(ref);
      // (opcional) también habría que sacarlo de assignments si estaba asignado
    }
  }
  await batch.commit();
  toast(add ? "Pasajero(s) asociados" : "Pasajero(s) quitados");
  await loadEventLinks();
  renderPassengers();
}

async function refreshAll(){
  await loadEvents();
  renderEventSelect();
  await Promise.all([loadDriversAll(), loadPassengersAll()]);
  await loadEventLinks();
  renderDrivers();
  renderPassengers();
}

(async function init(){
  await initAuthAndEvents({ adminEmail: "pedro.l.oldani@gmail.com" });

  $("btnReloadEvents").addEventListener("click", refreshAll);
  $("btnReloadDrivers").addEventListener("click", async ()=>{ await loadDriversAll(); renderDrivers(); });
  $("btnReloadPassengers").addEventListener("click", async ()=>{ await loadPassengersAll(); renderPassengers(); });

  $("driverSearch2").addEventListener("input", renderDrivers);
  $("passSearch2").addEventListener("input", renderPassengers);

  $("btnAssignDriversBulk").addEventListener("click", ()=> linkDrivers(pickedIds("data-pick-driver"), true));
  $("btnRemoveDriversBulk").addEventListener("click", ()=> linkDrivers(pickedIds("data-pick-driver"), false));

  $("btnAssignPassengersBulk").addEventListener("click", ()=> linkPassengers(pickedIds("data-pick-pass"), true));
  $("btnRemovePassengersBulk").addEventListener("click", ()=> linkPassengers(pickedIds("data-pick-pass"), false));

  document.addEventListener("eventChanged", refreshAll);
  await refreshAll();
})();
