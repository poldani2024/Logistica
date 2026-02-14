// events.js – Gestión de choferes por fase (FINAL, alineado)

import {
  $,
  STATE,
  initCorePage,
  loadMasterDrivers,
  loadEvents,
  loadEventContext,
  saveDriverPhase,
  getSelectedEventId
} from "./core.js";

async function init(){
  // Header, auth, selector de evento → TODO lo hace core.js
  await initCorePage({ page: "events" });

  if (!STATE.auth.user) return;

  // Master data
  await loadMasterDrivers();

  // Eventos
  await loadEvents();

  const eventId = getSelectedEventId();
  if (!eventId){
    const wrap = $("eventDetail");
    if (wrap) wrap.innerHTML = "<p>No hay evento seleccionado.</p>";
    return;
  }

  await loadEventContext(eventId);

  render();
}

function render(){
  const wrap = $("eventDetail");
  if (!wrap) return;

  const phases = STATE.event.phases || [];
  if (!phases.length){
    wrap.innerHTML = "<p>El evento no tiene fases definidas.</p>";
    return;
  }

  const drivers = STATE.master.drivers || [];

  wrap.innerHTML = phases.map(phase => `
    <div class="card" style="margin-bottom:16px">
      <h3>${phase.name}</h3>

      ${drivers.map(d => {
        const enabled =
          STATE.event.driverPhases?.get(d.id)?.[phase.id] === true;

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

// Expuesto para los checkboxes
window.toggleDriverPhase = async function(driverId, phaseId, enabled){
  try{
    await saveDriverPhase(driverId, phaseId, enabled);
  }catch(e){
    console.error(e);
    alert(e.message || String(e));
  }
};

init().catch(err => {
  console.error("INIT ERROR events.js", err);
});
