// events.js – Gestión de fases y choferes por fase (FIXED)

import {
  $,
  STATE,
  ensureAuth,
  loadEvents,
  loadEventContext,
  loadMasterDrivers,
  saveDriverPhase,
  getSelectedEventId
} from "./core.js";

async function init(){
  await ensureAuth();
  if (!STATE.auth.user) return;

  // 1) Cargar master data
  await loadMasterDrivers();

  // 2) Cargar eventos
  await loadEvents();

  // 3) Determinar evento activo
  const eventId = getSelectedEventId() || STATE.events[0]?.id;
  if (!eventId){
    $("eventDetail").innerHTML = "<p>No hay eventos.</p>";
    return;
  }

  // 4) Cargar contexto del evento
  await loadEventContext(eventId);

  render();
}

function render(){
  const wrap = $("eventDetail");
  if (!wrap) return;

  if (!STATE.event.phases || !STATE.event.phases.length){
    wrap.innerHTML = "<p>El evento no tiene fases definidas.</p>";
    return;
  }

  const drivers = STATE.master.drivers || [];

  wrap.innerHTML = STATE.event.phases.map(phase => `
    <div class="card" style="margin-bottom:16px">
      <h3>${phase.name}</h3>
      ${drivers.map(d => {
        const enabled = STATE.event.driverPhases.get(d.id)?.[phase.id] === true;
        return `
          <label style="display:block; margin:6px 0">
            <input type="checkbox"
              ${enabled ? "checked" : ""}
              onchange="toggleDriverPhase('${d.id}','${phase.id}', this.checked)">
            ${d.lastName || ""} ${d.firstName || ""}
          </label>
        `;
      }).join("")}
    </div>
  `).join("");
}

// expuesto para los checkboxes
window.toggleDriverPhase = async function(driverId, phaseId, enabled){
  try{
    await saveDriverPhase(driverId, phaseId, enabled);
  }catch(e){
    console.error(e);
    alert(e.message || e);
  }
};

init().catch(err => {
  console.error("INIT ERROR events.js", err);
});
