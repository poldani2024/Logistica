// events.js – Gestión de fases y choferes por fase (FINAL FIX)

import {
  $,
  STATE,
  ensureAuth,
  loadEvents,
  loadEventContext,
  loadMasterDrivers,
  saveDriverPhase,
  getSelectedEventId,
  setSelectedEventId
} from "./core.js";

async function init(){
  await ensureAuth();
  if (!STATE.auth.user) return;

  // 1) Master data
  await loadMasterDrivers();

  // 2) Eventos
  await loadEvents();

  // 3) Determinar evento activo (y persistirlo)
  let eventId = getSelectedEventId();
  if (!eventId) {
    eventId = STATE.events[0]?.id || "";
  }

  if (!eventId){
    const wrap = $("eventDetail");
    if (wrap) wrap.innerHTML = "<p>No hay eventos disponibles.</p>";
    return;
  }

  setSelectedEventId(eventId);

  // 4) Contexto del evento (solo con ID válido)
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
          STATE.event.driverPhases.get(d.id)?.[phase.id] === true;

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
    alert(e.message || String(e));
  }
};

init().catch(err => {
  console.error("INIT ERROR events.js", err);
});
