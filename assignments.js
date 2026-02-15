// assignments.js — Asignar chofer ↔ pasajero por fase (Ida/Vuelta/...)
import {
  initCorePage,
  STATE,
  $,
  toast,
  escapeHtml,
  loadMasterPassengers,
  loadEventContext,
  driversForPhase,
  getActivePhaseId,
} from "./core.js";

import { db } from "./firebase-init.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

let clicksWired = false;

(async function init(){
  await initCorePage({ page: "assignments" });

  if (!STATE.ui) STATE.ui = { activePhase: null };
  if (STATE.ui.passFilter == null) STATE.ui.passFilter = "pending";
  if (STATE.ui.activeDriverId == null) STATE.ui.activeDriverId = null;

  await loadMasterPassengers();

  if (STATE.event?.id) {
    await loadEventContext(STATE.event.id);
  }

  wireOnce();
  renderAll();

  document.addEventListener("eventChanged", async (ev) => {
    const id = ev?.detail?.eventId;
    if (!id) return;
    await loadEventContext(id);
    STATE.ui.activeDriverId = null;
    renderAll();
  });
})().catch((e)=>{
  console.error("INIT ERROR assignments", e);
  toast(e?.message || String(e));
});

function wireOnce(){
  if (clicksWired) return;
  clicksWired = true;

  $("btnRefresh")?.addEventListener("click", async ()=>{
    if (!STATE.event?.id) return toast("Seleccioná un evento arriba.");
    await loadEventContext(STATE.event.id);
    renderAll();
    toast("Actualizado");
  });

  $("passSearch")?.addEventListener("input", ()=>renderPassengers());

  // Filtros (chips) — usa data-filter: pending | assigned | all
  $("passFilter")?.addEventListener("click", (ev)=>{
    const chip = ev.target.closest(".chip[data-filter]");
    if (!chip) return;
    if (!STATE.ui) STATE.ui = {};
    STATE.ui.passFilter = chip.dataset.filter || "pending";
    markPassengerFilterButtons();
    renderPassengers();
  });

  // Delegación: fase, chofer, asignar/quitar
  document.addEventListener("click", async (ev)=>{
    // 1) Fases (chips)
    const phaseChip = ev.target.closest(".chip[data-phase]");
    if (phaseChip){
      if (!STATE.ui) STATE.ui = {};
      STATE.ui.activePhase = phaseChip.dataset.phase || null;
      renderAll();
      return;
    }

    // 2) Selección de chofer: permitimos click en cualquier cosa dentro de la card
    const driverCard = ev.target.closest("[data-driver]");
    if (driverCard && driverCard.closest("#driversList")){
      if (!STATE.ui) STATE.ui = {};
      STATE.ui.activeDriverId = driverCard.dataset.driver || null;
      renderDrivers();
      renderActiveDriverPill();
      renderPassengers();
      return;
    }

    // 3) Asignar / Quitar pasajero
    const passBtn = ev.target.closest("button[data-passenger]");
    if (passBtn){
      const pid = passBtn.dataset.passenger;
      const driverId = STATE.ui?.activeDriverId;
      if (!driverId) return toast("Primero seleccioná un chofer (izquierda).");
      const phaseId = getActivePhaseId();
      if (!phaseId) return toast("Seleccioná una fase.");

      passBtn.disabled = true;
      try{
        const updatedIds = await toggleAssign(driverId, pid, phaseId);

        // ✅ Update local state even if core.js no carga assignments
        applyLocalAssignment(driverId, phaseId, updatedIds);

        // Si tu core.js ya carga assignments, esto lo confirma; si no, no molesta.
        try { await loadEventContext(STATE.event.id); } catch (_) {}

        renderDrivers();
        renderPassengers();

        toast("Asignación actualizada");
      }catch(err){
        console.error("ASSIGN ERROR", err);
        toast(err?.message || String(err));
      }finally{
        passBtn.disabled = false;
      }
      return;
    }
  }, true);
}

function renderAll(){
  renderPhaseBar();
  renderDrivers();
  renderPassengers();
  renderActiveDriverPill();
  markPassengerFilterButtons();
}

function renderPhaseBar(){
  const host = $("phaseBar");
  if (!host) return;

  const phases = STATE.event?.phases || [];
  if (!phases.length){
    host.innerHTML = '<div class="emptyBox">No hay fases. Definilas en <b>Eventos</b>.</div>';
    return;
  }

  const current = getActivePhaseId() || phases[0].id;
  if (!STATE.ui) STATE.ui = {};
  STATE.ui.activePhase = current;

  host.innerHTML = phases.map(p=>{
    const active = p.id === current;
    return `<div class="chip ${active ? "active" : ""}" data-phase="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</div>`;
  }).join("");
}

function renderActiveDriverPill(){
  const pill = $("activeDriverBadge");
  if (!pill) return;

  const id = STATE.ui?.activeDriverId;
  if (!id){
    pill.textContent = "Chofer activo: —";
    return;
  }
  const d = (STATE.master?.drivers || []).find(x=>x.id===id);
  pill.textContent = `Chofer activo: ${driverLabel(d || { id })}`;
}

function driverLabel(d){
  return `${d.lastName || ""} ${d.firstName || ""}`.trim() || d.name || d.email || d.id;
}
function passengerLabel(p){
  return `${p.lastName || ""} ${p.firstName || ""}`.trim() || p.name || p.email || p.id;
}

function renderDrivers(){
  const host = $("driversList");
  if (!host) return;

  const eventId = STATE.event?.id;
  const phaseId = getActivePhaseId();

  if (!eventId){
    host.innerHTML = '<div class="emptyBox">Seleccioná un evento.</div>';
    return;
  }
  if (!phaseId){
    host.innerHTML = '<div class="emptyBox">Seleccioná una fase.</div>';
    return;
  }

  const drivers = driversForPhase(phaseId) || [];
  if (!drivers.length){
    host.innerHTML = '<div class="emptyBox">No hay choferes disponibles para esta fase (ver Choferes x Fase).</div>';
    return;
  }

  const active = STATE.ui.activeDriverId;

  host.innerHTML = drivers.map(d=>{
    const isActive = d.id === active;
    return `
      <div class="driverCard ${isActive ? "active" : ""}" data-driver="${escapeHtml(d.id)}">
        <div class="rowBetween">
          <div>
            <div style="font-weight:900">${escapeHtml(driverLabel(d))}</div>
            <div class="muted2">${escapeHtml(d.email || "")}</div>
          </div>
          <div class="badge">${isActive ? "Activo" : "Ver"}</div>
        </div>
      </div>
    `;
  }).join("");

}


function ensureAssignmentsMap(){
  const a = STATE.event?.assignments;
  if (a instanceof Map) return a;

  const m = new Map();
  // compat: si viniera como objeto {driverId: data}
  if (a && typeof a === "object"){
    for (const [k,v] of Object.entries(a)) m.set(k, v);
  }
  if (!STATE.event) STATE.event = {};
  STATE.event.assignments = m;
  return m;
}

function applyLocalAssignment(driverId, phaseId, passengerIds){
  const m = ensureAssignmentsMap();
  const current = m.get(driverId) || {};
  if (!current.phases || typeof current.phases !== "object") current.phases = {};
  current.phases[phaseId] = Array.isArray(passengerIds) ? passengerIds : [];
  m.set(driverId, current);
}

function getPhaseAssignments(){
  const phaseId = getActivePhaseId();
  const byDriver = new Map();
  const assignedAll = new Set();
  const map = STATE.event?.assignments || new Map();

  for (const [driverId, a] of map.entries()){
    let ids = [];
    if (a?.phases && phaseId){
      ids = Array.isArray(a.phases[phaseId]) ? a.phases[phaseId] : [];
    } else if (Array.isArray(a?.passengerIds)) {
      if (!phaseId || phaseId === "ida") ids = a.passengerIds;
    }

    const set = new Set(ids.filter(Boolean));
    byDriver.set(driverId, set);
    for (const pid of set) assignedAll.add(pid);
  }
  return { byDriver, assignedAll };
}

function markPassengerFilterButtons(){
  const filter = (STATE.ui?.passFilter || "pending");
  const host = $("passFilter");
  if (!host) return;
  host.querySelectorAll(".chip[data-filter]").forEach(chip=>{
    chip.classList.toggle("active", (chip.dataset.filter || "") === filter);
  });
}

function renderPassengers(){
  const host = $("passengersList");
  if (!host) return;

  const eventId = STATE.event?.id;
  const phaseId = getActivePhaseId();

  if (!eventId){
    host.innerHTML = '<div class="emptyBox">Seleccioná un evento.</div>';
    return;
  }
  if (!phaseId){
    host.innerHTML = '<div class="emptyBox">Seleccioná una fase.</div>';
    return;
  }

  const { byDriver, assignedAll } = getPhaseAssignments();
  const activeDriverId = STATE.ui?.activeDriverId || null;
  const assignedToActive = activeDriverId ? (byDriver.get(activeDriverId) || new Set()) : new Set();

  const eventPassengerIds = Array.from(STATE.event?.passengersIds || []);
  const master = STATE.master?.passengers || [];
  const byId = new Map(master.map(p => [p.id, p]));
  let list = eventPassengerIds.map(id => byId.get(id) || { id });

  const q = (($("passSearch") || $("passengerSearch"))?.value || "").trim().toLowerCase();
  if (q) list = list.filter(p => passengerLabel(p).toLowerCase().includes(q));

  const filter = (STATE.ui?.passFilter || "pending").toLowerCase();
  if (filter === "pending") list = list.filter(p => !assignedAll.has(p.id));
  if (filter === "assigned") list = list.filter(p => assignedAll.has(p.id));
  // all no filtra

  if (!list.length){
    host.innerHTML = '<div class="emptyBox">Sin resultados.</div>';
    return;
  }

  host.innerHTML = list.map(p=>{
    const pid = p.id;
    const isAssignedAny = assignedAll.has(pid);
    const isAssignedActive = assignedToActive.has(pid);
    const status = isAssignedActive ? "Asignado a este chofer" : (isAssignedAny ? "Asignado" : "Pendiente");
    const actionLabel = activeDriverId ? (isAssignedActive ? "Quitar" : "Asignar") : "Asignar";
    return `
      <div class="row" style="justify-content:space-between; gap:10px; padding:12px; border:1px solid rgba(255,255,255,.08); border-radius:16px;">
        <div>
          <div style="font-weight:800">${escapeHtml(passengerLabel(p))}</div>
          <div class="hint">${escapeHtml(status)} — Fase: ${escapeHtml(phaseId)}</div>
        </div>
        <button class="btn btnSm ${isAssignedActive ? "danger" : ""}" data-passenger="${escapeHtml(pid)}" type="button">${actionLabel}</button>
      </div>
    `;
  }).join("");
}

async function toggleAssign(driverId, passengerId, phaseId){
  const eventId = STATE.event?.id;
  if (!eventId) throw new Error("No hay evento seleccionado");
  if (!phaseId) throw new Error("No hay fase activa");

  const ref = doc(db, "events", eventId, "assignments", driverId);
  const snap = await getDoc(ref);

  let data = snap.exists() ? (snap.data() || {}) : {};
  if (!data.phases || typeof data.phases !== "object") data.phases = {};

  const arr = Array.isArray(data.phases[phaseId]) ? data.phases[phaseId].slice() : [];
  const i = arr.indexOf(passengerId);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(passengerId);

  data.phases[phaseId] = Array.from(new Set(arr.filter(Boolean)));
  data.updatedAt = serverTimestamp();

  await setDoc(ref, data, { merge: true });
  return data.phases[phaseId];
}

