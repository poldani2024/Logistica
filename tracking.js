
import { startAuth, ensureHeader, loadMasterData, loadEventContext, STATE, getSelectedEventId, driverName, passengerName } from "./core.js";

function render(){
  const host = document.getElementById("trackingBox");

  if(!STATE.event?.id){
    host.innerHTML = `<span class="status-warn">Seleccioná un evento arriba.</span>`;
    return;
  }

  const rows = Array.from(STATE.event.assignments.entries()).map(([driverId, a])=>{
    const names = (a.passengerIds || []).map(pid => passengerName(pid)).join(", ");
    return `<tr><td><b>${driverName(driverId)}</b></td><td>${names || "<span class='muted'>—</span>"}</td></tr>`;
  }).join("");

  host.innerHTML = `
    <table class="table">
      <thead><tr><th>Chofer</th><th>Pasajeros</th></tr></thead>
      <tbody>${rows || ""}</tbody>
    </table>
  `;
}

(async function(){
  await startAuth();
  await ensureHeader();
  await loadMasterData();
  const eventId = getSelectedEventId();
  if(eventId) await loadEventContext(eventId);
  render();
})();
