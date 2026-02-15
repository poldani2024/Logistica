
import { db } from "./firebase-init.js";
import { startAuth, ensureHeader, loadMasterData, loadEvents, loadEventContext, STATE, requireEventId, saveEventPhases, upsertEventDriverPhase } from "./core.js";
import { collection, addDoc, serverTimestamp, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

function renderPhases(){
  const box = document.getElementById("phasesList");
  if(!STATE.event?.id){
    box.innerHTML = `<span class="status-warn">Seleccioná un evento arriba.</span>`;
    return;
  }
  if(!STATE.event.phases.length){
    box.innerHTML = `<span class="muted">Sin fases aún.</span>`;
    return;
  }
  box.innerHTML = STATE.event.phases.map((p,i)=> `<span class="pill">${i+1}. <b>${p.name}</b> <span class="muted">(${p.id})</span></span>`).join(" ");
}

function renderDriversPhaseGrid(){
  const host = document.getElementById("driversPhaseGrid");
  if(!STATE.event?.id){
    host.innerHTML = `<span class="status-warn">Seleccioná un evento arriba.</span>`;
    return;
  }
  if(!STATE.event.phases.length){
    host.innerHTML = `<span class="status-warn">Primero definí fases.</span>`;
    return;
  }
  const phases = STATE.event.phases;
  const drivers = STATE.master.drivers;

  let html = `<table class="table"><thead><tr><th>Chofer</th>`;
  html += phases.map(p=> `<th>${p.name}</th>`).join("");
  html += `</tr></thead><tbody>`;

  for(const d of drivers){
    html += `<tr><td><b>${d.name || d.id}</b><div class="small muted">${d.phone||""}</div></td>`;
    for(const p of phases){
      const checked = !!(STATE.event.driverPhases?.get(d.id)?.[p.id]);
      html += `<td><input type="checkbox" data-driver="${d.id}" data-phase="${p.id}" ${checked ? "checked":""} /></td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  host.innerHTML = html;

  host.querySelectorAll("input[type=checkbox]").forEach(cb=>{
    cb.addEventListener("change", async (e)=>{
      const driverId = e.target.dataset.driver;
      const phaseId = e.target.dataset.phase;
      const value = e.target.checked;
      await upsertEventDriverPhase(requireEventId(), driverId, phaseId, value);
      // update STATE locally
      const current = STATE.event.driverPhases.get(driverId) || {};
      current[phaseId] = value;
      STATE.event.driverPhases.set(driverId, current);
    });
  });
}

async function createEvent(){
  const title = document.getElementById("newEventTitle").value.trim();
  const start = document.getElementById("newEventStart").value || null;
  const end = document.getElementById("newEventEnd").value || null;
  if(!title) return alert("Poné un título.");

  const ref = await addDoc(collection(db,"events"), {
    title,
    startDate: start,
    endDate: end,
    phases: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  alert("Evento creado.");
  document.getElementById("newEventTitle").value = "";
  await loadEvents();
  location.reload();
}

function addPhaseLocal(id, name){
  id = (id||"").trim();
  name = (name||id||"").trim();
  if(!id) return;
  // evitar duplicados
  if(STATE.event.phases.some(p=>p.id===id)) return;
  STATE.event.phases.push({id, name});
}

async function savePhases(){
  requireEventId();
  await saveEventPhases(STATE.event.id, STATE.event.phases);
  alert("Fases guardadas.");
}

(async function init(){
  await startAuth();
  await ensureHeader();
  await loadMasterData();

  const eventId = localStorage.getItem("eventId") || "";
  if(eventId) await loadEventContext(eventId);

  renderPhases();
  renderDriversPhaseGrid();

  document.getElementById("btnCreateEvent").onclick = createEvent;

  document.getElementById("btnAddPhase").onclick = ()=>{
    try{ requireEventId(); } catch(err){ return alert(err.message); }
    const id = document.getElementById("phaseId").value;
    const name = document.getElementById("phaseName").value;
    addPhaseLocal(id,name);
    document.getElementById("phaseId").value="";
    document.getElementById("phaseName").value="";
    renderPhases();
    renderDriversPhaseGrid();
  };

  document.getElementById("btnAddIdaVuelta").onclick = ()=>{
    try{ requireEventId(); } catch(err){ return alert(err.message); }
    addPhaseLocal("ida","Ida");
    addPhaseLocal("vuelta","Vuelta");
    renderPhases();
    renderDriversPhaseGrid();
  };

  document.getElementById("btnSavePhases").onclick = savePhases;
})();
