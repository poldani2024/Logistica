
import {
  startAuth, ensureHeader, loadMasterData, loadEventContext, STATE,
  getSelectedEventId, getActivePhaseId, setActivePhaseId,
  driversForPhase, setAssignment, passengerName, driverName
} from "./core.js";

let selectedDriverId = null;

function renderPhaseSelect(){
  const sel = document.getElementById("phaseSelect");
  const hint = document.getElementById("phaseHint");

  if(!STATE.event?.id){
    sel.innerHTML = `<option value="">—</option>`;
    hint.textContent = "Seleccioná un evento arriba.";
    return;
  }
  if(!STATE.event.phases.length){
    sel.innerHTML = `<option value="">—</option>`;
    hint.textContent = "Este evento no tiene fases todavía (crealas en Eventos).";
    return;
  }

  sel.innerHTML = STATE.event.phases.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
  const active = getActivePhaseId();
  sel.value = active || STATE.event.phases[0].id;
  hint.textContent = active ? `Fase activa: ${active}` : "Elegí una fase.";

  sel.onchange = ()=>{
    setActivePhaseId(sel.value);
    selectedDriverId = null;
    render();
  };
}

function assignedPassengersSet(){
  // Con el modelo actual, assignments es por chofer (para la fase activa).
  // Para simplificar: se guarda por fase en un doc distinto? (no)
  // Acá usamos el doc por chofer y lo interpretamos como “fase actual”.
  // Si querés multi-fase en asignaciones persistidas, se puede evolucionar a assignments/{phaseId}_{driverId}.
  const set = new Set();
  for(const a of STATE.event.assignments.values()){
    (a.passengerIds || []).forEach(pid => set.add(pid));
  }
  return set;
}

function renderDrivers(){
  const host = document.getElementById("driversBox");

  if(!STATE.event?.id){ host.innerHTML = `<span class="status-warn">Seleccioná un evento arriba.</span>`; return; }

  const phaseId = getActivePhaseId();
  if(!phaseId){ host.innerHTML = `<span class="status-warn">No hay fase activa.</span>`; return; }

  const driverIds = driversForPhase(phaseId);
  if(!driverIds.length){
    host.innerHTML = `<span class="status-warn">No hay choferes disponibles en esta fase.</span>`;
    return;
  }

  const html = driverIds.map(did => {
    const active = (did === selectedDriverId);
    const assigned = STATE.event.assignments.get(did)?.passengerIds?.length || 0;
    return `<div class="row" style="justify-content:space-between; margin:8px 0;">
      <button data-driver="${did}" class="${active ? "btn-primary" : ""}" style="flex:1 1 auto; text-align:left;">
        🚗 <b>${driverName(did)}</b>
        <span class="muted small">(${assigned} asignados)</span>
      </button>
    </div>`;
  }).join("");

  host.innerHTML = html;

  host.querySelectorAll("button[data-driver]").forEach(btn=>{
    btn.onclick = ()=>{
      selectedDriverId = btn.dataset.driver;
      renderAssignmentBox();
      renderPassengers(); // para que marque pendientes vs asignados
    };
  });
}

function renderPassengers(){
  const host = document.getElementById("passengersBox");
  if(!STATE.event?.id){ host.innerHTML = `<span class="status-warn">Seleccioná un evento arriba.</span>`; return; }

  const phaseId = getActivePhaseId();
  if(!phaseId){ host.innerHTML = `<span class="status-warn">No hay fase activa.</span>`; return; }

  const assigned = assignedPassengersSet();
  const all = Array.from(STATE.event.passengersIds || []);
  if(!all.length){
    host.innerHTML = `<span class="muted">No hay pasajeros vinculados al evento.</span>`;
    return;
  }

  // Pendientes = no asignados
  const pending = all.filter(pid => !assigned.has(pid));
  const html = pending.map(pid => `<div class="row" style="justify-content:space-between; margin:8px 0;">
      <span>👤 ${passengerName(pid)}</span>
      <span class="pill">pendiente</span>
    </div>`).join("");

  host.innerHTML = html || `<span class="status-ok">No hay pendientes 🎉</span>`;
}

function renderAssignmentBox(){
  const host = document.getElementById("assignmentBox");

  if(!STATE.event?.id){ host.innerHTML = `<span class="status-warn">Seleccioná un evento arriba.</span>`; return; }
  if(!selectedDriverId){ host.innerHTML = `<span class="muted">Seleccioná un chofer a la izquierda.</span>`; return; }

  const allPassengerIds = Array.from(STATE.event.passengersIds || []);
  const current = STATE.event.assignments.get(selectedDriverId)?.passengerIds || [];
  const currentSet = new Set(current);

  const rows = allPassengerIds.map(pid=>{
    const checked = currentSet.has(pid);
    return `<div class="row" style="justify-content:space-between; margin:6px 0;">
      <label class="row" style="gap:10px; cursor:pointer;">
        <input type="checkbox" data-pid="${pid}" ${checked ? "checked":""} />
        <span>👤 ${passengerName(pid)}</span>
      </label>
      <span class="small muted">${checked ? "asignado" : ""}</span>
    </div>`;
  }).join("");

  host.innerHTML = `
    <div class="row" style="justify-content:space-between;">
      <span class="pill">Chofer: <b>${driverName(selectedDriverId)}</b></span>
      <button id="btnSaveAssign" class="btn-primary">Guardar</button>
    </div>
    <div class="hr"></div>
    <div>${rows}</div>
    <div class="hr"></div>
    <div class="small muted">
      Nota: esta versión guarda asignaciones por chofer (documentId = driverId). Si querés que queden separadas por fase en Firestore, lo evolucionamos.
    </div>
  `;

  document.getElementById("btnSaveAssign").onclick = async ()=>{
    const checked = Array.from(host.querySelectorAll("input[type=checkbox][data-pid]"))
      .filter(x=>x.checked)
      .map(x=>x.dataset.pid);

    await setAssignment(STATE.event.id, selectedDriverId, checked);
    // update local state
    STATE.event.assignments.set(selectedDriverId, { driverId: selectedDriverId, passengerIds: checked });
    alert("Asignación guardada.");
    renderPassengers();
    renderDrivers();
  };
}

function render(){
  renderPhaseSelect();
  renderDrivers();
  renderPassengers();
  renderAssignmentBox();
}

(async function init(){
  await startAuth();
  await ensureHeader();
  await loadMasterData();

  const eventId = getSelectedEventId();
  if(eventId) await loadEventContext(eventId);

  render();
})();
