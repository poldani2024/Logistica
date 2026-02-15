
import { startAuth, ensureHeader, loadMasterData, loadEventContext, STATE, getSelectedEventId } from "./core.js";

(async function(){
  await startAuth();
  await ensureHeader();
  await loadMasterData();

  const eventId = getSelectedEventId();
  if(eventId) await loadEventContext(eventId);

  const el = document.getElementById("homeStatus");
  const ev = STATE.events.find(e => e.id === eventId);
  const title = ev?.title || ev?.name || (eventId ? eventId : "Sin evento");
  el.innerHTML = `
    <div class="row">
      <span class="pill">Evento activo: <b>${title}</b></span>
      <span class="pill">Choferes master: <b>${STATE.master.drivers.length}</b></span>
      <span class="pill">Pasajeros master: <b>${STATE.master.passengers.length}</b></span>
    </div>
    <div class="hr"></div>
    <div class="small muted">
      Consejo: si ves “No hay evento seleccionado”, elegí uno arriba.
    </div>
  `;
})();
