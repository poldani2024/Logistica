import {
  initCorePage,
  STATE,
  $,
  toast,
  escapeHtml,
  loadMasterPassengers,
  loadEventContext,
  driversForPhase,
  getActivePhaseId,
} from "./core.js";

import { db } from "./firebase-init.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

const UI = {
  vehicleDriver: new Map(),
  saving: false,
  search: ""
};

(async function init(){
  await initCorePage({ page: "assignments" });
  if (!STATE.ui) STATE.ui = { activePhase: null };

  await loadMasterPassengers();
  if (STATE.event?.id) await loadEventContext(STATE.event.id);

  wire();
  buildVehicleMapFromAssignments();
  render();

  document.addEventListener("eventChanged", async (ev) => {
    const id = ev?.detail?.eventId;
    if (!id) return;
    await loadEventContext(id);
    buildVehicleMapFromAssignments();
    render();
  });
})().catch((e) => {
  console.error("INIT ERROR map-assignments", e);
  toast(e?.message || String(e));
});

function wire(){
  $("btnRefresh")?.addEventListener("click", async () => {
    if (!STATE.event?.id) return toast("Seleccioná un evento.");
    await loadEventContext(STATE.event.id);
    buildVehicleMapFromAssignments();
    render();
    toast("Actualizado");
  });

  $("passengerSearch")?.addEventListener("input", (ev) => {
    UI.search = String(ev?.target?.value || "").trim().toLowerCase();
    renderPassengerPool();
  });

  document.addEventListener("dragstart", onDragStart);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("drop", onDrop);
  document.addEventListener("dragend", clearDropHover);

  document.addEventListener("click", (ev) => {
    const phaseBtn = ev.target.closest("[data-phase]");
    if (!phaseBtn) return;
    STATE.ui.activePhase = phaseBtn.dataset.phase || null;
    buildVehicleMapFromAssignments();
    render();
  });
}

function render(){
  renderPhaseBar();
  renderVehicles();
  renderDriverPool();
  renderPassengerPool();
}

function renderPhaseBar(){
  const host = $("phaseBar");
  if (!host) return;

  const phases = STATE.event?.phases || [];
  if (!phases.length){
    host.innerHTML = '<div class="emptyHint">No hay fases definidas en este evento.</div>';
    return;
  }

  const current = getActivePhaseId() || phases[0].id;
  STATE.ui.activePhase = current;

  host.innerHTML = phases.map(p => {
    const active = p.id === current;
    return `<button class="btn ${active ? "primary" : ""}" data-phase="${escapeHtml(p.id)}" type="button">${escapeHtml(p.name || p.id)}</button>`;
  }).join(" ");
}

function getDrivers(){
  return driversForPhase(getActivePhaseId()) || [];
}

function getPassengersInPhase(){
  const phaseId = getActivePhaseId();
  const ids = Array.from(STATE.event?.passengersIds || []);
  const byId = new Map((STATE.master?.passengers || []).map(p => [p.id, p]));
  const metaById = STATE.event?.passengersMeta || new Map();

  return ids
    .filter(pid => passengerRequiresTransportForPhase(pid, phaseId))
    .map(pid => {
      const base = byId.get(pid) || { id: pid };
      const meta = metaById.get(pid) || {};
      return {
        ...base,
        id: pid,
        _time: passengerTimeForPhase(meta, phaseId)
      };
    })
    .sort((a, b) => passengerLabel(a).localeCompare(passengerLabel(b), "es", { sensitivity: "base" }));
}

function getAssignmentsByDriver(){
  const phaseId = getActivePhaseId();
  const byDriver = new Map();

  (STATE.event?.assignments || new Map()).forEach((a, driverId) => {
    const phases = (a?.phases && typeof a.phases === "object") ? a.phases : {};
    let ids = Array.isArray(phases[phaseId]) ? phases[phaseId] : [];
    if ((!ids || !ids.length) && phaseId === "ida" && Array.isArray(a?.passengerIds)) ids = a.passengerIds;
    byDriver.set(driverId, new Set((ids || []).filter(Boolean)));
  });

  return byDriver;
}

function buildVehicleMapFromAssignments(){
  const drivers = getDrivers();
  const maxVehicles = drivers.length;
  const byDriver = getAssignmentsByDriver();

  const usedDrivers = drivers
    .filter(d => (byDriver.get(d.id)?.size || 0) > 0)
    .map(d => d.id);

  const next = new Map();
  for (let i = 1; i <= maxVehicles; i++){
    const key = String(i);
    const existing = UI.vehicleDriver.get(key);
    if (existing && drivers.find(d => d.id === existing) && !Array.from(next.values()).includes(existing)) {
      next.set(key, existing);
      continue;
    }

    const pick = usedDrivers.find(id => !Array.from(next.values()).includes(id));
    next.set(key, pick || null);
  }

  UI.vehicleDriver = next;
}

function renderVehicles(){
  const host = $("vehiclesGrid");
  if (!host) return;
  const drivers = getDrivers();

  if (!STATE.event?.id) {
    host.innerHTML = '<div class="emptyHint">Seleccioná un evento.</div>';
    return;
  }

  if (!drivers.length){
    host.innerHTML = '<div class="emptyHint">No hay choferes para esta fase (ver Choferes x Fase).</div>';
    return;
  }

  const byDriver = getAssignmentsByDriver();
  const usedPassengers = new Set();

  host.innerHTML = Array.from(UI.vehicleDriver.entries()).map(([vehicleNo, driverId]) => {
    const drv = drivers.find(d => d.id === driverId) || null;
    const cap = driverCapacity(drv);
    const passengerIds = drv ? Array.from(byDriver.get(drv.id) || []) : [];
    passengerIds.forEach(pid => usedPassengers.add(pid));

    const passengers = passengerIds
      .map(pid => passengerById(pid))
      .filter(Boolean)
      .map(p => `<div class="dragItem passenger" draggable="true" data-drag-type="passenger" data-passenger-id="${escapeHtml(p.id)}">${escapeHtml(passengerLabel(p))}</div>`)
      .join("");

    return `
      <article class="vehicleCard">
        <div class="vehicleHead">
          <span>Móvil ${escapeHtml(vehicleNo)}</span>
          <small>${drv ? `Pasajeros: ${passengerIds.length}/${cap}` : "Sin chofer"}</small>
        </div>
        <div class="vehicleBody">
          <div class="driverSlot ${drv ? "filled" : ""}" data-drop-zone="vehicle-driver" data-vehicle="${escapeHtml(vehicleNo)}">
            ${drv
              ? `<div class="dragItem driver" draggable="true" data-drag-type="driver-assigned" data-vehicle="${escapeHtml(vehicleNo)}" data-driver-id="${escapeHtml(drv.id)}">${escapeHtml(driverLabel(drv))}<small>Puestos: ${cap}</small></div>`
              : "Soltá un chofer aquí"}
          </div>

          <div class="passengersZone" data-drop-zone="vehicle-passengers" data-vehicle="${escapeHtml(vehicleNo)}">
            ${passengers || '<span class="hint">Sin pasajeros asignados</span>'}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderDriverPool(){
  const host = $("driversPool");
  const count = $("driversCount");
  if (!host) return;

  const drivers = getDrivers();
  const assigned = new Set(Array.from(UI.vehicleDriver.values()).filter(Boolean));
  const free = drivers.filter(d => !assigned.has(d.id));

  if (count) count.textContent = `${drivers.length}`;

  host.innerHTML = free.length
    ? free.map(d => `<div class="dragItem driver" draggable="true" data-drag-type="driver-pool" data-driver-id="${escapeHtml(d.id)}">${escapeHtml(driverLabel(d))}<small>Puestos: ${driverCapacity(d)}</small></div>`).join("")
    : '<div class="emptyHint">Todos los choferes ya están en un móvil.</div>';
}

function renderPassengerPool(){
  const host = $("passengersPool");
  const count = $("passengersCount");
  if (!host) return;

  const all = getPassengersInPhase();
  const byDriver = getAssignmentsByDriver();
  const assignedPassengers = new Set(Array.from(byDriver.values()).flatMap(set => Array.from(set)));

  const pending = all
    .filter(p => !assignedPassengers.has(p.id))
    .filter(p => !UI.search || passengerLabel(p).toLowerCase().includes(UI.search));

  if (count) count.textContent = `${all.length}`;

  host.innerHTML = pending.length
    ? pending.map(p => `<div class="dragItem passenger" draggable="true" data-drag-type="passenger" data-passenger-id="${escapeHtml(p.id)}">${escapeHtml(passengerLabel(p))}<small>Horario: ${escapeHtml(p._time || "—")}</small></div>`).join("")
    : '<div class="emptyHint">No hay pasajeros pendientes para esta fase.</div>';
}

function onDragStart(ev){
  const item = ev.target.closest("[data-drag-type]");
  if (!item) return;

  const payload = {
    type: item.dataset.dragType,
    driverId: item.dataset.driverId || null,
    passengerId: item.dataset.passengerId || null,
    fromVehicle: item.dataset.vehicle || null,
  };

  ev.dataTransfer?.setData("application/json", JSON.stringify(payload));
  ev.dataTransfer.effectAllowed = "move";
}

function onDragOver(ev){
  const zone = ev.target.closest("[data-drop-zone]");
  if (!zone) return;
  ev.preventDefault();
  zone.classList.add("dropHover");
}

async function onDrop(ev){
  const zone = ev.target.closest("[data-drop-zone]");
  if (!zone) return;

  ev.preventDefault();
  clearDropHover();

  const raw = ev.dataTransfer?.getData("application/json");
  if (!raw) return;

  let payload = null;
  try { payload = JSON.parse(raw); } catch { return; }

  if (payload.type === "driver-pool" || payload.type === "driver-assigned") {
    await handleDriverDrop(payload, zone);
    return;
  }

  if (payload.type === "passenger") {
    await handlePassengerDrop(payload, zone);
  }
}

function clearDropHover(){
  document.querySelectorAll(".dropHover").forEach(el => el.classList.remove("dropHover"));
}

async function handleDriverDrop(payload, zone){
  const zoneType = zone.dataset.dropZone;
  const driverId = payload.driverId;
  const fromVehicle = payload.fromVehicle;
  if (!driverId) return;

  if (zoneType === "driversPool") {
    if (!fromVehicle) return;
    const currentPassengers = getPassengersForVehicle(fromVehicle);
    if (currentPassengers.length) {
      toast("No podés retirar el chofer si el móvil tiene pasajeros.");
      return;
    }
    UI.vehicleDriver.set(String(fromVehicle), null);
    render();
    return;
  }

  if (zoneType !== "vehicle-driver") return;

  const targetVehicle = String(zone.dataset.vehicle || "");
  if (!targetVehicle) return;

  const alreadyVehicle = vehicleOfDriver(driverId);
  const displaced = UI.vehicleDriver.get(targetVehicle);
  if (displaced && displaced !== driverId) {
    const displacedPassengers = getAssignmentsByDriver().get(displaced);
    if ((displacedPassengers?.size || 0) > 0) {
      toast("No podés reemplazar un chofer que tiene pasajeros asignados.");
      return;
    }
  }

  if (alreadyVehicle && alreadyVehicle !== targetVehicle) {
    UI.vehicleDriver.set(alreadyVehicle, null);
  }

  UI.vehicleDriver.set(targetVehicle, driverId);

  if (fromVehicle && fromVehicle !== targetVehicle) {
    const fromPassengers = getPassengersForVehicle(fromVehicle);
    if (!fromPassengers.length) UI.vehicleDriver.set(String(fromVehicle), null);
  }

  render();
}

async function handlePassengerDrop(payload, zone){
  const passengerId = payload.passengerId;
  if (!passengerId) return;

  const zoneType = zone.dataset.dropZone;
  const phaseId = getActivePhaseId();
  if (!phaseId) return;

  if (zoneType === "passengersPool") {
    const current = currentDriverOfPassenger(passengerId);
    if (!current) return;
    await persistMovePassenger(passengerId, current, null);
    await reloadAndRender("Pasajero retirado del móvil");
    return;
  }

  if (zoneType !== "vehicle-passengers") return;

  const vehicle = String(zone.dataset.vehicle || "");
  const driverId = UI.vehicleDriver.get(vehicle);
  if (!driverId) {
    toast("Primero tenés que asignar un chofer al móvil.");
    return;
  }

  const driver = (getDrivers() || []).find(d => d.id === driverId);
  const capacity = driverCapacity(driver);

  const byDriver = getAssignmentsByDriver();
  const targetSet = new Set(Array.from(byDriver.get(driverId) || []));
  const sourceDriver = currentDriverOfPassenger(passengerId);

  if (!targetSet.has(passengerId) && targetSet.size >= capacity){
    toast(`El móvil llegó al máximo (${capacity}). Quitá un pasajero para continuar.`);
    return;
  }

  if (sourceDriver === driverId) return;

  await persistMovePassenger(passengerId, sourceDriver, driverId);
  await reloadAndRender("Asignación actualizada");
}

async function persistMovePassenger(passengerId, sourceDriverId, targetDriverId){
  if (UI.saving) return;
  UI.saving = true;
  try {
    const phaseId = getActivePhaseId();

    if (sourceDriverId) {
      const current = Array.from(getAssignmentsByDriver().get(sourceDriverId) || []);
      const next = current.filter(id => id !== passengerId);
      await persistDriverPassengers(sourceDriverId, phaseId, next);
    }

    if (targetDriverId) {
      const current = Array.from(getAssignmentsByDriver().get(targetDriverId) || []);
      if (!current.includes(passengerId)) current.push(passengerId);
      await persistDriverPassengers(targetDriverId, phaseId, current);
    }
  } finally {
    UI.saving = false;
  }
}

async function persistDriverPassengers(driverId, phaseId, passengerIds){
  const eventId = STATE.event?.id;
  const ref = doc(db, "events", eventId, "assignments", driverId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() || {}) : {};

  if (!data.phases || typeof data.phases !== "object") data.phases = {};
  data.phases[phaseId] = Array.from(new Set((passengerIds || []).filter(Boolean)));
  if (phaseId === "ida") data.passengerIds = data.phases[phaseId];
  data.updatedAt = serverTimestamp();

  await setDoc(ref, data, { merge: true });
}

async function reloadAndRender(msg){
  await loadEventContext(STATE.event.id);
  buildVehicleMapFromAssignments();
  render();
  toast(msg);
}

function getPassengersForVehicle(vehicleNo){
  const driverId = UI.vehicleDriver.get(String(vehicleNo));
  if (!driverId) return [];
  return Array.from(getAssignmentsByDriver().get(driverId) || []);
}

function vehicleOfDriver(driverId){
  for (const [vehicleNo, id] of UI.vehicleDriver.entries()) {
    if (id === driverId) return vehicleNo;
  }
  return null;
}

function currentDriverOfPassenger(passengerId){
  const byDriver = getAssignmentsByDriver();
  for (const [driverId, set] of byDriver.entries()) {
    if (set.has(passengerId)) return driverId;
  }
  return null;
}

function driverLabel(d){
  return `${d?.lastName || ""} ${d?.firstName || ""}`.trim() || d?.name || d?.email || d?.id || "Chofer";
}

function passengerLabel(p){
  return `${p?.lastName || ""} ${p?.firstName || ""}`.trim() || p?.name || p?.email || p?.id || "Pasajero";
}

function passengerById(id){
  return (STATE.master?.passengers || []).find(p => p.id === id) || null;
}

function driverCapacity(d){
  const cap = Number(d?.capacity ?? 4);
  return Number.isFinite(cap) && cap > 0 ? cap : 4;
}

function passengerTimeForPhase(meta, phaseId){
  const m = (meta && typeof meta === "object") ? meta : {};
  return String(((m.timeByPhase && m.timeByPhase[phaseId]) || m.time || "")).trim();
}

function passengerRequiresTransportForPhase(passengerId, phaseId){
  const meta = STATE.event?.passengersMeta?.get(passengerId) || {};
  const allPhases = meta?.allPhases;
  if (allPhases === undefined || allPhases === null || allPhases === true) return true;

  const byPhase = (meta?.transportByPhase && typeof meta.transportByPhase === "object") ? meta.transportByPhase : {};
  if (!phaseId) return true;
  if (Object.prototype.hasOwnProperty.call(byPhase, phaseId)) return !!byPhase[phaseId];
  return true;
}
