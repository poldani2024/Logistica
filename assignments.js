// assignments.js (filtra choferes por fase)
import { $, STATE, ensureAuth, loadEventContext, driversForPhase, getActivePhaseId } from "./core.js";

(async function(){
  await ensureAuth();
  await loadEventContext(STATE.event.id);
  render();
})();

function render(){
  const phase = getActivePhase();
  const drivers = driversForPhase(phase);
  $("drivers").innerHTML = drivers.map(d=>`<div>${d.lastName}</div>`).join("");
}
