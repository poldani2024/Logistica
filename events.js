// events.js - UI de fases en Eventos + choferes por fase
import {
  $,
  STATE,
  initCorePage,
  loadEvents,
  loadEventContext,
  loadMasterDrivers,
  getSelectedEventId,
  setSelectedEventId,
  toast,
  escapeHtml,
  ensureAuth,
} from "./core.js";

// Firestore directo (para actualizar el doc del evento)
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { db } from "./firebase-init.js";

function slugPhaseId(name){
  return String(name||"")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || ("fase-" + Math.random().toString(36).slice(2,7));
}

function ensureLocalPhases(){
  STATE.event.phases = Array.isArray(STATE.event.phases) ? STATE.event.phases : [];
  STATE.event.phases = STATE.event.phases
    .filter(p => p && (p.id || p.name))
    .map(p => ({ id: (p.id||slugPhaseId(p.name)), name: (p.name||p.id) }));
}

function renderPhases(){
  ensureLocalPhases();
  const box = $("phasesBox");
  if (!box) return;

  if (!STATE.event.phases.length){
    box.innerHTML = '<div class="emptyBox">No hay fases. Creá “Ida/Vuelta” o agregá una fase.</div>';
    return;
  }

  box.innerHTML = STATE.event.phases.map((p, idx) => `
    <div class="rowItem">
      <div class="rowMain">
        <div class="rowTitle">Fase</div>
        <input class="input" data-phase-idx="${idx}" value="${escapeHtml(p.name)}" placeholder="Nombre (ej. Ida)" />
        <div class="hint">id: <b>${escapeHtml(p.id)}</b></div>
      </div>
      <div class="rowActions">
        <button class="btn" data-move="up" data-idx="${idx}" ${idx===0?"disabled":""}>↑</button>
        <button class="btn" data-move="down" data-idx="${idx}" ${idx===STATE.event.phases.length-1?"disabled":""}>↓</button>
        <button class="btn danger" data-del="${idx}">Eliminar</button>
      </div>
    </div>
  `).join("");

  box.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-del"));
      STATE.event.phases.splice(i,1);
      renderPhases();
      if (document.getElementById('driversPhasesBox')) renderDriversPhases();
    });
  });
  box.querySelectorAll("[data-move]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-idx"));
      const dir = btn.getAttribute("data-move");
      const j = dir==="up" ? i-1 : i+1;
      if (j < 0 || j >= STATE.event.phases.length) return;
      const tmp = STATE.event.phases[i];
      STATE.event.phases[i] = STATE.event.phases[j];
      STATE.event.phases[j] = tmp;
      renderPhases();
      if (document.getElementById('driversPhasesBox')) renderDriversPhases();
    });
  });
}

function readPhaseEditsFromUI(){
  const box = $("phasesBox");
  if (!box) return;
  box.querySelectorAll("input[data-phase-idx]").forEach(inp => {
    const idx = Number(inp.getAttribute("data-phase-idx"));
    const name = String(inp.value||"").trim();
    if (!name) return;
    const prev = STATE.event.phases[idx];
    STATE.event.phases[idx] = { id: prev?.id || slugPhaseId(name), name };
  });
}

async function savePhasesToEvent(){
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin puede guardar fases");
  readPhaseEditsFromUI();
  ensureLocalPhases();

  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const ref = doc(db, "events", STATE.event.id);
  await updateDoc(ref, {
    phases: STATE.event.phases,
    updatedAt: serverTimestamp()
  });
  toast("Fases guardadas");
}

async function seedDefault(){
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  STATE.event.phases = [
    { id:"ida", name:"Ida" },
    { id:"vuelta", name:"Vuelta" }
  ];
  renderPhases();
  if (document.getElementById('driversPhasesBox')) renderDriversPhases();
  await savePhasesToEvent();
}

function renderDriversPhases(){
  const box = $("driversPhasesBox");
  const empty = $("driversEmpty");
  if (!box) return;

  ensureLocalPhases();
  if (!STATE.event.phases.length){
    if (empty) empty.style.display = "block";
    box.innerHTML = "";
    return;
  }
  if (empty) empty.style.display = "none";

  const phases = STATE.event.phases;
  const drivers = STATE.master.drivers || [];

  box.innerHTML = `
    <div class="table">
      <div class="trow thead">
        <div class="tcell tname">Chofer</div>
        ${phases.map(p=>`<div class="tcell tph">${escapeHtml(p.name)}</div>`).join("")}
      </div>
      ${drivers.map(d=>{
        const label = `${escapeHtml(d.lastName||"")} ${escapeHtml(d.firstName||"")}`.trim() || escapeHtml(d.id);
        return `
          <div class="trow">
            <div class="tcell tname">${label}</div>
            ${phases.map(p=>{
              const enabled = STATE.event.driverPhases?.get(d.id)?.[p.id] === true;
              const dis = !STATE.auth.isAdmin ? "disabled" : "";
              return `
                <div class="tcell tph">
                  <label class="chk">
                    <input type="checkbox" data-did="${escapeHtml(d.id)}" data-pid="${escapeHtml(p.id)}" ${enabled?"checked":""} ${dis}>
                    <span></span>
                  </label>
                </div>
              `;
            }).join("")}
          </div>
        `;
      }).join("")}
    </div>
  `;

  box.querySelectorAll("input[type=checkbox][data-did]").forEach(chk=>{
    chk.addEventListener("change", async ()=>{
      try{
        if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
        const driverId = chk.getAttribute("data-did");
        const phaseId = chk.getAttribute("data-pid");
        const enabled = chk.checked;

        STATE.event.driverPhases = STATE.event.driverPhases || new Map();
        const current = STATE.event.driverPhases.get(driverId) || {};
        current[phaseId] = !!enabled;
        STATE.event.driverPhases.set(driverId, current);

        const ref = doc(db, "events", STATE.event.id, "eventDrivers", driverId);
        await updateDoc(ref, {
          phases: current,
          updatedAt: serverTimestamp()
        });

        toast("Guardado");
      }catch(e){
        console.error(e);
        toast(e.message || String(e));
        chk.checked = !chk.checked;
      }
    });
  });
}

async function reloadAll(){
  await loadEvents();
  const eid = getSelectedEventId();
  if (eid) await loadEventContext(eid);
  await loadMasterDrivers();
  renderPhases();
  if (document.getElementById('driversPhasesBox')) renderDriversPhases();
}

async function init(){
  await initCorePage({ page: "events" });
  await ensureAuth();
  if (!STATE.auth.user) return;

  await loadMasterDrivers();
  await loadEvents();

  const eid = getSelectedEventId() || STATE.events[0]?.id || "";
  if (!eid){
    $("phasesBox").innerHTML = '<div class="emptyBox">No hay eventos.</div>';
    return;
  }
  setSelectedEventId(eid);
  await loadEventContext(eid);

  $("btnAddPhase")?.addEventListener("click", ()=>{
    ensureLocalPhases();
    const name = prompt("Nombre de la fase (ej. Ida, Vuelta, Tramo 2):");
    if (!name) return;
    STATE.event.phases.push({ id: slugPhaseId(name), name: String(name).trim() });
    renderPhases();
    if (document.getElementById('driversPhasesBox')) renderDriversPhases();
  });

  $("btnSeedDefault")?.addEventListener("click", async ()=>{
    try{ await seedDefault(); }catch(e){ console.error(e); toast(e.message||String(e)); }
  });

  $("btnSavePhases")?.addEventListener("click", async ()=>{
    try{ await savePhasesToEvent(); await reloadAll(); }catch(e){ console.error(e); toast(e.message||String(e)); }
  });

  $("btnReload")?.addEventListener("click", async ()=>{
    try{ await reloadAll(); toast("Recargado"); }catch(e){ console.error(e); toast(e.message||String(e)); }
  });

  document.addEventListener("eventChanged", async (ev)=>{
    const id = ev?.detail?.eventId || getSelectedEventId();
    if (!id) return;
    setSelectedEventId(id);
    await loadEventContext(id);
    renderPhases();
    if (document.getElementById('driversPhasesBox')) renderDriversPhases();
  });

  renderPhases();
  if (document.getElementById('driversPhasesBox')) renderDriversPhases();
}

init().catch(err=>console.error("INIT ERROR events.js", err));
