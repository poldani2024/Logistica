// events.js (gestión de fases y choferes por fase)
import { $, STATE, ensureAuth, loadEvents, loadEventContext, saveDriverPhase } from "./core.js";

(async function(){
  await ensureAuth();
  await loadEvents();
  const ev = STATE.events[0];
  await loadEventContext(ev.id);

  const wrap = $("eventDetail");
  wrap.innerHTML = STATE.event.phases.map(p=>`
    <h3>${p.name}</h3>
    ${STATE.master.drivers.map(d=>`
      <label>
        <input type="checkbox"
          ${STATE.event.driverPhases.get(d.id)?.[p.id]?"checked":""}
          onchange="toggle('${d.id}','${p.id}',this.checked)">
        ${d.lastName} ${d.firstName}
      </label><br>
    `).join("")}
  `).join("");
})();

window.toggle = async (d,p,v)=>{
  await saveDriverPhase(d,p,v);
};
