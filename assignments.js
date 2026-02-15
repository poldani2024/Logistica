// assignments.js (filtra choferes por fase)
import { $, STATE, ensureAuth, loadEventContext, driversForPhase, getActivePhaseId } from "./core.js";

(async function(){
  await ensureAuth();
  await loadEventContext(STATE.event.id);
  render();
})();

function render() {
  const host = $("driversList"); // 👈 ESTE id debe existir en assignments.html
  if (!host) {
    console.warn("[assignments] Falta #driversList en el HTML");
    return;
  }

  host.innerHTML = "...";
}
