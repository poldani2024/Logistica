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
    const infoBtn = ev.target.closest("[data-passenger-info]");
    if (infoBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      openPassengerInfoModal(infoBtn.dataset.passengerInfo || "");
      return;
    }

    const phaseBtn = ev.target.closest("[data-phase]");
    if (!phaseBtn) return;
    STATE.ui.activePhase = phaseBtn.dataset.phase || null;
    buildVehicleMapFromAssignments();
    render();
  });

  document.addEventListener("mousedown", (ev) => {
    if (ev.target.closest("[data-passenger-info]")) ev.stopPropagation();
  });

  $("btnClosePassengerInfo")?.addEventListener("click", closePassengerInfoModal);
  $("passengerInfoModal")?.addEventListener("click", (ev) => {
    if (ev.target?.id === "passengerInfoModal") closePassengerInfoModal();
  });

  $("btnCopyAssignments")?.addEventListener("click", openCopyAssignmentsModal);
  $("btnCloseCopyAssignments")?.addEventListener("click", closeCopyAssignmentsModal);
  $("btnCancelCopyAssignments")?.addEventListener("click", closeCopyAssignmentsModal);
  $("btnConfirmCopyAssignments")?.addEventListener("click", copyAssignmentsBetweenPhases);
  $("copyAssignmentsModal")?.addEventListener("click", (ev) => {
    if (ev.target?.id === "copyAssignmentsModal") closeCopyAssignmentsModal();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    closePassengerInfoModal();
    closeCopyAssignmentsModal();
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


function openCopyAssignmentsModal(){
  if (!STATE.event?.id) return toast("Seleccioná un evento.");
  const phases = STATE.event?.phases || [];
  if (phases.length < 2) return toast("Necesitás al menos dos fases para copiar asignaciones.");

  renderCopyPhaseOptions();
  const modal = $("copyAssignmentsModal");
  modal?.classList.add("show");
  modal?.setAttribute("aria-hidden", "false");
}

function closeCopyAssignmentsModal(){
  const modal = $("copyAssignmentsModal");
  modal?.classList.remove("show");
  modal?.setAttribute("aria-hidden", "true");
}

function renderCopyPhaseOptions(){
  const phases = STATE.event?.phases || [];
  const active = getActivePhaseId() || phases[0]?.id || "";
  const firstDifferent = phases.find(ph => ph.id !== active)?.id || phases[1]?.id || "";
  const options = phases
    .map(ph => `<option value="${escapeHtml(ph.id)}">${escapeHtml(ph.name || ph.id)}</option>`)
    .join("");

  const source = $("copySourcePhase");
  const target = $("copyTargetPhase");
  if (source) {
    source.innerHTML = options;
    source.value = active;
  }
  if (target) {
    target.innerHTML = options;
    target.value = firstDifferent;
  }
}

async function copyAssignmentsBetweenPhases(){
  const sourcePhaseId = String($("copySourcePhase")?.value || "").trim();
  const targetPhaseId = String($("copyTargetPhase")?.value || "").trim();

  if (!STATE.event?.id) return toast("Seleccioná un evento.");
  if (!sourcePhaseId || !targetPhaseId) return toast("Seleccioná fase origen y destino.");
  if (sourcePhaseId === targetPhaseId) return toast("La fase origen y destino deben ser distintas.");

  const sourceName = phaseLabel(sourcePhaseId);
  const targetName = phaseLabel(targetPhaseId);
  const ok = window.confirm(`Esto va a sobrescribir las asignaciones de "${targetName}" con las de "${sourceName}". ¿Querés continuar?`);
  if (!ok) return;

  if (UI.saving) return;
  UI.saving = true;
  try {
    const writes = [];
    const copiedPassengerIds = new Set();

    (STATE.event?.assignments || new Map()).forEach((assignment, driverId) => {
      const sourcePassengerIds = passengerIdsFromAssignmentForPhase(assignment, sourcePhaseId);
      sourcePassengerIds.forEach(pid => copiedPassengerIds.add(pid));

      const phases = (assignment?.phases && typeof assignment.phases === "object") ? { ...assignment.phases } : {};
      phases[targetPhaseId] = sourcePassengerIds;

      const payload = {
        phases,
        updatedAt: serverTimestamp()
      };
      if (targetPhaseId === "ida") payload.passengerIds = sourcePassengerIds;

      writes.push(setDoc(doc(db, "events", STATE.event.id, "assignments", driverId), payload, { merge: true }));
    });

    copiedPassengerIds.forEach(passengerId => {
      writes.push(setDoc(
        doc(db, "events", STATE.event.id, "eventPassengers", passengerId),
        passengerPhaseAddressPayload(passengerId, sourcePhaseId, targetPhaseId),
        { merge: true }
      ));
    });

    await Promise.all(writes);
    closeCopyAssignmentsModal();
    STATE.ui.activePhase = targetPhaseId;
    await reloadAndRender(`Asignaciones copiadas de ${sourceName} a ${targetName}`);
  } finally {
    UI.saving = false;
  }
}

function passengerIdsFromAssignmentForPhase(assignment, phaseId){
  const phases = (assignment?.phases && typeof assignment.phases === "object") ? assignment.phases : {};
  const phasePassengerIds = Array.isArray(phases[phaseId]) ? phases[phaseId] : [];
  if (phasePassengerIds.length) return Array.from(new Set(phasePassengerIds.filter(Boolean)));
  if (phaseId === "ida" && Array.isArray(assignment?.passengerIds)) {
    return Array.from(new Set(assignment.passengerIds.filter(Boolean)));
  }
  return [];
}

function phaseLabel(phaseId){
  const phase = (STATE.event?.phases || []).find(ph => ph.id === phaseId);
  return phase?.name || phase?.id || phaseId || "fase";
}

function passengerPhaseAddressPayload(passengerId, sourcePhaseId, targetPhaseId){
  const passenger = passengerById(passengerId) || { id: passengerId };
  const meta = STATE.event?.passengersMeta?.get(passengerId) || {};
  const originAddress = phaseDestinationForPhase(sourcePhaseId);
  const destinationAddress = passengerDeclaredAddressForPhase(meta, targetPhaseId, passenger);

  const payload = {
    updatedAt: serverTimestamp()
  };

  if (originAddress) payload.originAddressByPhase = { [targetPhaseId]: originAddress };
  if (destinationAddress) payload.destinationAddressByPhase = { [targetPhaseId]: destinationAddress };

  return payload;
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
        _time: passengerTimeForPhase(meta, phaseId),
        _destination: passengerDestinationForPhase(meta, phaseId, base)
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
      .map(p => {
        const meta = STATE.event?.passengersMeta?.get(p.id) || {};
        const time = passengerTimeForPhase(meta, getActivePhaseId());
        const destination = passengerDestinationForPhase(meta, getActivePhaseId(), p);
        return passengerDragItemHtml(p, { time, destination });
      })
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
    ? pending.map(p => passengerDragItemHtml(p, { time: p._time, destination: p._destination })).join("")
    : '<div class="emptyHint">No hay pasajeros pendientes para esta fase.</div>';
}


function passengerDragItemHtml(p, { time = "", destination = "" } = {}){
  return `
    <div class="dragItem passenger passengerItem" draggable="true" data-drag-type="passenger" data-passenger-id="${escapeHtml(p.id)}">
      <div class="passengerItemHead">
        <span>${escapeHtml(passengerLabel(p))}</span>
        <button class="passengerInfoBtn" type="button" data-passenger-info="${escapeHtml(p.id)}" aria-label="Ver información de ${escapeHtml(passengerLabel(p))}" title="Ver información">☰</button>
      </div>
      <small>Horario: ${escapeHtml(time || "—")}</small>
      <small>Destino: ${escapeHtml(destination || "—")}</small>
    </div>
  `;
}

function openPassengerInfoModal(passengerId){
  const modal = $("passengerInfoModal");
  const title = $("passengerInfoTitle");
  const body = $("passengerInfoBody");
  if (!modal || !title || !body) return;

  const passenger = passengerById(passengerId);
  if (!passenger) {
    toast("No se encontró el pasajero.");
    return;
  }

  title.textContent = passengerLabel(passenger);
  body.innerHTML = passengerInfoHtml(passenger);
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function closePassengerInfoModal(){
  const modal = $("passengerInfoModal");
  modal?.classList.remove("show");
  modal?.setAttribute("aria-hidden", "true");
}

function passengerInfoHtml(passenger){
  const meta = STATE.event?.passengersMeta?.get(passenger.id) || {};
  const phases = STATE.event?.phases || [];
  const participating = phases.filter(ph => passengerRequiresTransportForPhase(passenger.id, ph.id));
  const address = String(meta.address || passenger.address || "").trim();
  const localidad = String(meta.localidad || passenger.localidad || "").trim();

  const phasesHtml = phases.length
    ? phases.map(ph => passengerPhaseInfoHtml(passenger, meta, ph)).join("")
    : '<div class="emptyHint">Este evento no tiene fases definidas.</div>';

  return `
    <div class="passengerInfoGrid">
      <div><span>Nombre</span><strong>${escapeHtml(passenger.firstName || "—")}</strong></div>
      <div><span>Apellido</span><strong>${escapeHtml(passenger.lastName || "—")}</strong></div>
      <div><span>Dirección</span><strong>${escapeHtml(address || "—")}</strong></div>
      <div><span>Localidad</span><strong>${escapeHtml(localidad || "—")}</strong></div>
      <div class="full"><span>Fases en las que participa</span><strong>${escapeHtml(participating.map(ph => ph.name || ph.id).join(", ") || "Ninguna")}</strong></div>
    </div>
    <div class="passengerInfoSectionTitle">Información por fase</div>
    <div class="passengerPhaseList">${phasesHtml}</div>
  `;
}

function passengerPhaseInfoHtml(passenger, meta, phase){
  const phaseId = phase.id;
  const passengerId = passenger?.id || "";
  const participates = passengerRequiresTransportForPhase(passengerId, phaseId);
  const note = passengerNoteForPhase(meta, phaseId);
  const transportType = passengerTransportTypeForPhase(meta, phaseId);
  const transportCompany = passengerTransportCompanyForPhase(meta, phaseId);
  const destination = passengerDestinationForPhase(meta, phaseId, passenger);
  const time = passengerTimeForPhase(meta, phaseId);
  const phaseDate = String(phase.date || "").trim();
  const origin = passengerOriginForPhase(meta, phaseId);

  return `
    <article class="passengerPhaseCard ${participates ? "" : "mutedPhase"}">
      <div class="rowBetween" style="gap:8px; align-items:flex-start;">
        <strong>${escapeHtml(phase.name || phaseId)}</strong>
        <span class="phaseStatus ${participates ? "yes" : "no"}">${participates ? "Participa" : "No participa"}</span>
      </div>
      <dl>
        <div><dt>Fecha</dt><dd>${escapeHtml(phaseDate || "—")}</dd></div>
        <div><dt>Horario</dt><dd>${escapeHtml(time || "—")}</dd></div>
        <div><dt>Origen</dt><dd>${escapeHtml(origin || "—")}</dd></div>
        <div><dt>Destino</dt><dd>${escapeHtml(destination || "—")}</dd></div>
        <div><dt>Tipo de transporte</dt><dd>${escapeHtml(transportType || "—")}</dd></div>
        <div><dt>Empresa</dt><dd>${escapeHtml(transportCompany || "—")}</dd></div>
        <div class="full"><dt>Observaciones</dt><dd>${escapeHtml(note || "—")}</dd></div>
      </dl>
    </article>
  `;
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
  const targetItem = ev.target.closest("[data-drag-type]");

  ev.preventDefault();
  clearDropHover();

  const raw = ev.dataTransfer?.getData("application/json");
  if (!raw) return;

  let payload = null;
  try { payload = JSON.parse(raw); } catch { return; }

  if ((payload.type === "driver-pool" || payload.type === "driver-assigned")
      && targetItem?.dataset?.dragType
      && String(targetItem.dataset.dragType).startsWith("driver")) {
    await handleDriverSwap(payload, targetItem);
    return;
  }

  if (payload.type === "driver-pool" || payload.type === "driver-assigned") {
    await handleDriverDrop(payload, zone);
    return;
  }

  if (payload.type === "passenger"
      && targetItem?.dataset?.dragType === "passenger"
      && targetItem?.dataset?.passengerId
      && targetItem.dataset.passengerId !== payload.passengerId) {
    await handlePassengerSwap(payload.passengerId, targetItem.dataset.passengerId);
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

async function handleDriverSwap(payload, targetItem){
  const sourceDriverId = payload.driverId;
  const targetDriverId = targetItem?.dataset?.driverId || null;
  if (!sourceDriverId || !targetDriverId || sourceDriverId === targetDriverId) return;

  const sourceVehicle = vehicleOfDriver(sourceDriverId);
  const targetVehicle = vehicleOfDriver(targetDriverId);
  if (!sourceVehicle && !targetVehicle) return;

  const byDriver = getAssignmentsByDriver();
  const sourcePassengers = Array.from(byDriver.get(sourceDriverId) || []);
  const targetPassengers = Array.from(byDriver.get(targetDriverId) || []);

  const sourceCapacity = driverCapacity((getDrivers() || []).find(d => d.id === sourceDriverId));
  const targetCapacity = driverCapacity((getDrivers() || []).find(d => d.id === targetDriverId));
  if (targetPassengers.length > sourceCapacity || sourcePassengers.length > targetCapacity) {
    toast("No se puede hacer enroque: la capacidad de alguno de los choferes queda excedida.");
    return;
  }

  await persistSwapDriverPassengerLoads(sourceDriverId, targetPassengers, targetDriverId, sourcePassengers);

  if (sourceVehicle) UI.vehicleDriver.set(sourceVehicle, targetDriverId);
  if (targetVehicle) UI.vehicleDriver.set(targetVehicle, sourceDriverId);

  await reloadAndRender("Choferes intercambiados");
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

  if (shouldConfirmScheduleDifference(passengerId, targetSet)) {
    const ok = window.confirm("Este móvil ya tiene pasajeros con más de 30 minutos de diferencia horaria. ¿Querés continuar igualmente?");
    if (!ok) return;
  }

  if (!targetSet.has(passengerId) && targetSet.size >= capacity){
    toast(`El móvil llegó al máximo (${capacity}). Quitá un pasajero para continuar.`);
    return;
  }

  if (sourceDriver === driverId) return;

  await persistMovePassenger(passengerId, sourceDriver, driverId);
  await reloadAndRender("Asignación actualizada");
}

async function handlePassengerSwap(sourcePassengerId, targetPassengerId){
  const sourceDriverId = currentDriverOfPassenger(sourcePassengerId);
  const targetDriverId = currentDriverOfPassenger(targetPassengerId);

  if (sourceDriverId === targetDriverId) return;

  const byDriver = getAssignmentsByDriver();
  if (targetDriverId) {
    const targetSet = new Set(Array.from(byDriver.get(targetDriverId) || []));
    if (shouldConfirmScheduleDifference(sourcePassengerId, targetSet, [targetPassengerId])) {
      const ok = window.confirm("El intercambio genera diferencia horaria mayor a 30 minutos en el móvil destino. ¿Querés continuar?");
      if (!ok) return;
    }
  }
  if (sourceDriverId) {
    const sourceSet = new Set(Array.from(byDriver.get(sourceDriverId) || []));
    if (shouldConfirmScheduleDifference(targetPassengerId, sourceSet, [sourcePassengerId])) {
      const ok = window.confirm("El intercambio genera diferencia horaria mayor a 30 minutos en el móvil destino. ¿Querés continuar?");
      if (!ok) return;
    }
  }

  await persistSwapPassengers(sourcePassengerId, sourceDriverId, targetPassengerId, targetDriverId);
  await reloadAndRender("Pasajeros intercambiados");
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

async function persistSwapPassengers(sourcePassengerId, sourceDriverId, targetPassengerId, targetDriverId){
  if (UI.saving) return;
  UI.saving = true;
  try {
    const phaseId = getActivePhaseId();
    const byDriver = getAssignmentsByDriver();
    const touched = new Set([sourceDriverId, targetDriverId].filter(Boolean));

    for (const driverId of touched){
      let arr = Array.from(byDriver.get(driverId) || []);
      if (driverId === sourceDriverId) {
        arr = arr.filter(id => id !== sourcePassengerId);
        if (targetPassengerId) arr.push(targetPassengerId);
      }
      if (driverId === targetDriverId) {
        arr = arr.filter(id => id !== targetPassengerId);
        if (sourcePassengerId) arr.push(sourcePassengerId);
      }
      arr = Array.from(new Set(arr.filter(Boolean)));
      await persistDriverPassengers(driverId, phaseId, arr);
    }
  } finally {
    UI.saving = false;
  }
}

async function persistSwapDriverPassengerLoads(sourceDriverId, sourcePassengersNext, targetDriverId, targetPassengersNext){
  if (UI.saving) return;
  UI.saving = true;
  try {
    const phaseId = getActivePhaseId();
    await persistDriverPassengers(sourceDriverId, phaseId, sourcePassengersNext);
    await persistDriverPassengers(targetDriverId, phaseId, targetPassengersNext);
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

function passengerDestinationForPhase(meta, phaseId, passenger = null){
  const m = (meta && typeof meta === "object") ? meta : {};
  const byPhase = (m.destinationAddressByPhase && typeof m.destinationAddressByPhase === "object") ? m.destinationAddressByPhase : {};
  return String(
    byPhase[phaseId]
    || m.destinationAddress
    || phaseDestinationForPhase(phaseId)
    || passengerDeclaredAddressForPhase(m, phaseId, passenger)
    || ""
  ).trim();
}

function passengerOriginForPhase(meta, phaseId){
  const m = (meta && typeof meta === "object") ? meta : {};
  const byPhase = (m.originAddressByPhase && typeof m.originAddressByPhase === "object") ? m.originAddressByPhase : {};
  const phase = (STATE.event?.phases || []).find(p => p.id === phaseId) || {};
  return String(byPhase[phaseId] || addressWithLocality(phase.originAddress, phase.localidad || STATE.event?.localidad) || "").trim();
}

function passengerDeclaredAddressForPhase(meta, phaseId, passenger = null){
  const m = (meta && typeof meta === "object") ? meta : {};
  const byPhase = (m.destinationAddressByPhase && typeof m.destinationAddressByPhase === "object") ? m.destinationAddressByPhase : {};
  return String(
    byPhase[phaseId]
    || m.destinationAddress
    || addressWithLocality(m.address, m.localidad)
    || addressWithLocality(passenger?.address, passenger?.localidad)
    || ""
  ).trim();
}

function addressWithLocality(address, locality){
  return [address, locality].map(v => String(v || "").trim()).filter(Boolean).join(" · ");
}

function passengerNoteForPhase(meta, phaseId){
  const m = (meta && typeof meta === "object") ? meta : {};
  const byPhase = (m.notesByPhase && typeof m.notesByPhase === "object") ? m.notesByPhase : {};
  return String(byPhase[phaseId] || m.notes || "").trim();
}

function passengerTransportTypeForPhase(meta, phaseId){
  const m = (meta && typeof meta === "object") ? meta : {};
  const byPhase = (m.transportTypeByPhase && typeof m.transportTypeByPhase === "object") ? m.transportTypeByPhase : {};
  return String(byPhase[phaseId] || m.transportType || "").trim();
}

function passengerTransportCompanyForPhase(meta, phaseId){
  const m = (meta && typeof meta === "object") ? meta : {};
  const byPhase = (m.transportCompanyByPhase && typeof m.transportCompanyByPhase === "object") ? m.transportCompanyByPhase : {};
  return String(byPhase[phaseId] || m.transportCompany || "").trim();
}


function passengerNoteForPhase(meta, phaseId){
  const m = (meta && typeof meta === "object") ? meta : {};
  const byPhase = (m.notesByPhase && typeof m.notesByPhase === "object") ? m.notesByPhase : {};
  return String(byPhase[phaseId] || m.notes || "").trim();
}

function passengerTransportTypeForPhase(meta, phaseId){
  const m = (meta && typeof meta === "object") ? meta : {};
  const byPhase = (m.transportTypeByPhase && typeof m.transportTypeByPhase === "object") ? m.transportTypeByPhase : {};
  return String(byPhase[phaseId] || m.transportType || "").trim();
}

function passengerTransportCompanyForPhase(meta, phaseId){
  const m = (meta && typeof meta === "object") ? meta : {};
  const byPhase = (m.transportCompanyByPhase && typeof m.transportCompanyByPhase === "object") ? m.transportCompanyByPhase : {};
  return String(byPhase[phaseId] || m.transportCompany || "").trim();
}

function phaseDestinationForPhase(phaseId){
  const phase = (STATE.event?.phases || []).find(p => p.id === phaseId) || {};
  return addressWithLocality(phase.destinationAddress || phase.address || STATE.event?.address, phase.localidad || STATE.event?.localidad);
}

function parseClockToMinutes(value){
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return Number.NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return Number.NaN;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return Number.NaN;
  return (hh * 60) + mm;
}

function shouldConfirmScheduleDifference(passengerId, targetSet, ignorePassengerIds = []){
  const phaseId = getActivePhaseId();
  const incomingMeta = STATE.event?.passengersMeta?.get(passengerId) || {};
  const incomingMin = parseClockToMinutes(passengerTimeForPhase(incomingMeta, phaseId));
  if (!Number.isFinite(incomingMin)) return false;
  const ignore = new Set((ignorePassengerIds || []).filter(Boolean));

  for (const pid of targetSet) {
    if (pid === passengerId) continue;
    if (ignore.has(pid)) continue;
    const meta = STATE.event?.passengersMeta?.get(pid) || {};
    const targetMin = parseClockToMinutes(passengerTimeForPhase(meta, phaseId));
    if (!Number.isFinite(targetMin)) continue;
    if (Math.abs(targetMin - incomingMin) > 30) return true;
  }
  return false;
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
