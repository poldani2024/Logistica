// event-links.js
import { db } from "./firebase-init.js";
import { initAuthAndEvents, STATE, toast, escapeHtml, loadEvents, renderEventSelect } from "./core-auth.js";

import {
  collection,
  getDocs,
  query,
  orderBy,
  writeBatch,
  doc,
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

let DRIVERS = [];
let PASSENGERS = [];

function fullName(x){ return `${x.lastName||""} ${x.firstName||""}`.trim(); }

async function loadDriversAll() {
  const snap = await getDocs(query(collection(db, "drivers"), orderBy("lastName","asc")));
  DRIVERS = snap.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function loadPassengersAll() {
  const snap = await getDocs(query(collection(db, "passengers"), orderBy("lastName","asc")));
  PASSENGERS = snap.docs.map(d => ({ id:d.id, ...d.data() }));
}

function renderDrivers() {
  const q = ($("driverSearch2").value||"").toLowerCase();
  const rows = DRIVERS
    .filter(d => {
      const hay = `${fullName(d)} ${d.phone||""} ${d.email||""} ${d.zone||""}`.toLowerCase();
      return !q || hay.includes(q);
    })
    .map(d => {
      const inEvent = (d.eventId === STATE.eventId);
      return `
        <tr>
          <td><input type="checkbox" data-pick-driver="${escapeHtml(d.id)}"></td>
          <td><strong>${escapeHtml(fullName(d))}</strong><div class="muted">${escapeHtml(d.email||"")}</div></td>
          <td>${escapeHtml(d.phone||"")}</td>
          <td><span class="tag">${escapeHtml(d.zone||"")}</span></td>
          <td class="muted">${escapeHtml(d.eventId||"(sin evento)")}</td>
          <td>
            ${inEvent
              ? `<button class="btnDanger" data-remove-driver="${escapeHtml(d.id)}">Sacar</button>`
              : `<button class="btn" data-assign-driver="${escapeHtml(d.id)}">Asignar</button>`
            }
          </td>
        </tr>
      `;
    }).join("");

  $("driversTable2").innerHTML = `
    <table>
      <thead><tr><th></th><th>Chofer</th><th>Tel</th><th>Zona</th><th>Evento</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="muted">No hay choferes</td></tr>`}</tbody>
    </table>
  `;

  $("driversTable2").querySelectorAll("button[data-assign-driver]").forEach(b=>{
    b.addEventListener("click", async ()=> bulkSetEventId("drivers", [b.dataset.assignDriver], STATE.eventId));
  });
  $("driversTable2").querySelectorAll("button[data-remove-driver]").forEach(b=>{
    b.addEventListener("click", async ()=> bulkSetEventId("drivers", [b.dataset.removeDriver], null));
  });
}

function renderPassengers() {
  const q = ($("passSearch2").value||"").toLowerCase();
  const rows = PASSENGERS
    .filter(p => {
      const hay = `${fullName(p)} ${p.phone||""} ${p.address||""} ${p.zone||""}`.toLowerCase();
      return !q || hay.includes(q);
    })
    .map(p => {
      const inEvent = (p.eventId === STATE.eventId);
      return `
        <tr>
          <td><input type="checkbox" data-pick-pass="${escapeHtml(p.id)}"></td>
          <td><strong>${escapeHtml(fullName(p))}</strong><div class="muted">${escapeHtml(p.phone||"")}</div></td>
          <td>${escapeHtml(p.address||"")}</td>
          <td><span class="tag">${escapeHtml(p.zone||"")}</span></td>
          <td class="muted">${escapeHtml(p.eventId||"(sin evento)")}</td>
          <td>
            ${inEvent
              ? `<button class="btnDanger" data-remove-pass="${escapeHtml(p.id)}">Sacar</button>`
              : `<button class="btn" data-assign-pass="${escapeHtml(p.id)}">Asignar</button>`
            }
          </td>
        </tr>
      `;
    }).join("");

  $("passengersTable2").innerHTML = `
    <table>
      <thead><tr><th></th><th>Joven</th><th>Dirección</th><th>Zona</th><th>Evento</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="muted">No hay pasajeros</td></tr>`}</tbody>
    </table>
  `;

  $("passengersTable2").querySelectorAll("button[data-assign-pass]").forEach(b=>{
    b.addEventListener("click", async ()=> bulkSetEventId("passengers", [b.dataset.assignPass], STATE.eventId));
  });
  $("passengersTable2").querySelectorAll("button[data-remove-pass]").forEach(b=>{
    b.addEventListener("click", async ()=> bulkSetEventId("passengers", [b.dataset.removePass], null));
  });
}

function pickedIds(selectorAttr) {
  return Array.from(document.querySelectorAll(`input[${selectorAttr}]:checked`))
    .map(x => x.getAttribute(selectorAttr));
}

async function bulkSetEventId(colName, ids, eventIdOrNull) {
  if (!STATE.eventId && eventIdOrNull) {
    alert("Seleccioná un evento primero");
    return;
  }
  if (!ids.length) {
    toast("No hay seleccionados");
    return;
  }

  const batch = writeBatch(db);
  for (const id of ids) {
    const ref = doc(db, colName, id);
    batch.update(ref, { eventId: eventIdOrNull || null });
  }
  await batch.commit();

  toast(eventIdOrNull ? "Asignados al evento" : "Quitados del evento");

  // refrescar memoria local
  if (colName === "drivers") {
    DRIVERS = DRIVERS.map(d => ids.includes(d.id) ? ({...d, eventId: eventIdOrNull||null}) : d);
    renderDrivers();
  } else {
    PASSENGERS = PASSENGERS.map(p => ids.includes(p.id) ? ({...p, eventId: eventIdOrNull||null}) : p);
    renderPassengers();
  }
}

async function refreshAll() {
  await loadEvents();
  renderEventSelect();
  await Promise.all([loadDriversAll(), loadPassengersAll()]);
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

  $("btnAssignDriversBulk").addEventListener("click", async ()=>{
    const ids = pickedIds("data-pick-driver");
    await bulkSetEventId("drivers", ids, STATE.eventId);
  });
  $("btnRemoveDriversBulk").addEventListener("click", async ()=>{
    const ids = pickedIds("data-pick-driver");
    await bulkSetEventId("drivers", ids, null);
  });

  $("btnAssignPassengersBulk").addEventListener("click", async ()=>{
    const ids = pickedIds("data-pick-pass");
    await bulkSetEventId("passengers", ids, STATE.eventId);
  });
  $("btnRemovePassengersBulk").addEventListener("click", async ()=>{
    const ids = pickedIds("data-pick-pass");
    await bulkSetEventId("passengers", ids, null);
  });

  document.addEventListener("eventChanged", () => {
    // solo repintar, porque el “enEvent” depende del eventId
    renderDrivers();
    renderPassengers();
  });

  await refreshAll();
})();
