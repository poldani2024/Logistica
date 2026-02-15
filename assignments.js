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

(async function init(){
  await initCorePage({ page: "assignments" });

  // Compat: algunas versiones no traen ui
  if (!STATE.ui) STATE.ui = { activePhase: null };

  await loadMasterPassengers();

  if (STATE.event?.id) {
    await loadEventContext(STATE.event.id);
  }

  wireGlobal();
  renderAll();

  document.addEventListener("eventChanged", async (ev) => {
    const id = ev?.detail?.eventId;
    if (!id) return;
    await loadEventContext(id);
    // reset chofer activo al cambiar evento
    STATE.ui.activeDriverId = null;
    renderAll();
  });
})().catch((e)=>{
  console.error("INIT ERROR assignments", e);
  toast(e?.message || String(e));
});

function wireGlobal(){
  // Filtros pasajeros: delegación robusta por texto
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const t = (btn.textContent || "").trim().toLowerCase();
    const key = t.includes("pend") ? "pendientes" : (t.includes("asign") ? "asignados" : (t.includes("todo") ? "todos" : null));
    if (key){
      if (!STATE.ui) STATE.ui = { activePhase: null };
      STATE.ui.passFilter = t;
      markPassengerFilterButtons();
      renderPassengers();
    }
  });

  // botón actualizar (si existe)
  $("btnRefresh")?.addEventListener("click", async ()=>{
    if (!STATE.event?.id) return toast("Seleccioná un evento arriba.");
    await loadEventContext(STATE.event.id);
    renderAll();
    toast("Actualizado");
  });

  // buscador pasajeros (id más probable: passSearch)
  ($("passSearch") || $("passengerSearch"))?.addEventListener("input", ()=>renderPassengers());

  // filtros pasajeros: buscamos botones con texto Pendientes/Asignados/Todos
  const passPanel = $("passengersBox") || $("passengersPanel") || document;
  passPanel.querySelectorAll("button").forEach(btn=>{
    const t = (btn.textContent || "").trim().toLowerCase();
    const key = t.includes("pend") ? "pendientes" : (t.includes("asign") ? "asignados" : (t.includes("todo") ? "todos" : null));
    if (key){
      btn.addEventListener("click", ()=>{
        STATE.ui.passFilter = t; // "pendientes" | "asignados" | "todos"
        // marcar visualmente
        markPassengerFilterButtons();
        renderPassengers();
      });
    }
  });

  // fase tabs: renderPhaseBar() crea botones, pero por si tu HTML ya los tiene:
  const phaseHost = $("phaseBar") || document;
  phaseHost.querySelectorAll("button").forEach(btn=>{
    const t = (btn.textContent || "").trim().toLowerCase();
    if (t === "ida" || t === "vuelta"){
      btn.addEventListener("click", ()=>{
        if (!STATE.ui) STATE.ui = { activePhase: null };
        STATE.ui.activePhase = t; // usamos ids típicos
        renderDrivers();
        renderPassengers();
      });
    }
  });
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
    host.innerHTML = '<div class="hint">No hay fases. Definilas en <b>Eventos</b>.</div>';
    return;
  }

  const current = getActivePhaseId() || phases[0].id;
  if (!STATE.ui) STATE.ui = { activePhase: null };
  STATE.ui.activePhase = current;

  host.innerHTML = phases.map(p=>{
    const active = p.id === current;
    return `<button class="btn ${active ? "primary" : ""}" data-phase="${escapeHtml(p.id)}" type="button">${escapeHtml(p.name || p.id)}</button>`;
  }).join(" ");

  host.querySelectorAll("button[data-phase]").forEach(b=>{
    b.addEventListener("click", ()=>{
      if (!STATE.ui) STATE.ui = { activePhase: null };
      STATE.ui.activePhase = b.dataset.phase;
      renderDrivers();
      renderPassengers();
      renderPhaseBar(); // repintar activo
    });
  });
}

function renderActiveDriverPill(){
  const pill = $("activeDriverPill") || $("driverActivePill") || $("driverActive");
  if (!pill) return;
  const id = STATE.ui?.activeDriverId;
  if (!id){
    pill.textContent = "Chofer activo: —";
    return;
  }
  const d = (STATE.master?.drivers || []).find(x=>x.id===id);
  const name = driverLabel(d || { id });
  pill.textContent = `Chofer activo: ${name}`;
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

  const phaseId = getActivePhaseId();
  const eventId = STATE.event?.id;

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
    host.innerHTML = '<div class="emptyBox">No hay choferes disponibles para esta fase.</div>';
    return;
  }

  const activeDriverId = STATE.ui?.activeDriverId || null;

  host.innerHTML = drivers.map(d=>{
    const active = d.id === activeDriverId;
    return `
      <div class="row" style="justify-content:space-between; gap:10px; padding:12px; border:1px solid rgba(255,255,255,.08); border-radius:16px;">
        <div>
          <div style="font-weight:800">${escapeHtml(driverLabel(d))}</div>
          <div class="hint">${escapeHtml(d.email || "")}</div>
        </div>
        <button class="btn ${active ? "primary" : ""}" data-driver="${escapeHtml(d.id)}" type="button">${active ? "Activo" : "Ver"}</button>
      </div>
    `;
  }).join("");

  host.querySelectorAll("button[data-driver]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.driver;
      if (!id) return;
      if (!STATE.ui) STATE.ui = { activePhase: null };
      STATE.ui.activeDriverId = id;
      renderDrivers();
      renderPassengers();
      renderActiveDriverPill();
    });
  });
}

function getPhaseAssignments(){
  // Devuelve:
  // - byDriver: Map(driverId -> Set(passengerId))
  // - assignedAll: Set(passengerId)
  const phaseId = getActivePhaseId();
  const byDriver = new Map();
  const assignedAll = new Set();

  const map = STATE.event?.assignments || new Map();

  // compat:
  // a) formato nuevo: { phases: { ida:[], vuelta:[] } }
  // b) formato viejo: { passengerIds: [...] } (lo tratamos como "ida" si no hay fases)
  for (const [driverId, a] of map.entries()){
    let ids = [];
    if (a?.phases && phaseId){
      ids = Array.isArray(a.phases[phaseId]) ? a.phases[phaseId] : [];
    } else if (Array.isArray(a?.passengerIds)) {
      // fallback viejo: solo si la fase es "ida" o si no hay phases definidas
      if (!phaseId || phaseId === "ida") ids = a.passengerIds;
    }

    const set = new Set(ids.filter(Boolean));
    byDriver.set(driverId, set);
    for (const pid of set) assignedAll.add(pid);
  }

  return { byDriver, assignedAll };
}

function markPassengerFilterButtons(){
  const filter = (STATE.ui?.passFilter || "pendientes");
  const scope = $("passengersBox") || $("passengersPanel") || document;
  scope.querySelectorAll("button").forEach(btn=>{
    const t = (btn.textContent || "").trim().toLowerCase();
    const key = t.includes("pend") ? "pendientes" : (t.includes("asign") ? "asignados" : (t.includes("todo") ? "todos" : null));
    if (key){
      btn.classList.toggle("primary", key === filter);
    }
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

  const activeDriverId = STATE.ui?.activeDriverId || null;

  const { byDriver, assignedAll } = getPhaseAssignments();
  const assignedToActive = activeDriverId ? (byDriver.get(activeDriverId) || new Set()) : new Set();

  // pasajeros vinculados al evento
  const eventPassengerIds = Array.from(STATE.event?.passengersIds || []);
  const master = STATE.master?.passengers || [];
  const byId = new Map(master.map(p => [p.id, p]));
  let list = eventPassengerIds.map(id => byId.get(id) || { id });

  const q = (($("passSearch") || $("passengerSearch"))?.value || "").trim().toLowerCase();
  if (q){
    list = list.filter(p => passengerLabel(p).toLowerCase().includes(q));
  }

  const filter = (STATE.ui?.passFilter || "pendientes").toLowerCase();
  if (filter === "pendientes" || filter === "pending") list = list.filter(p => !assignedAll.has(p.id));
  if (filter === "asignados" || filter === "assigned") list = list.filter(p => assignedAll.has(p.id));
  // "todos"/"all" no filtra

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
    // siempre habilitado; si no hay chofer activo mostramos toast al click

    return `
      <div class="row" style="justify-content:space-between; gap:10px; padding:12px; border:1px solid rgba(255,255,255,.08); border-radius:16px;">
        <div>
          <div style="font-weight:800">${escapeHtml(passengerLabel(p))}</div>
          <div class="hint">${escapeHtml(status)} — Fase: ${escapeHtml(phaseId)}</div>
        </div>
        <button class="btn ${isAssignedActive ? "danger" : ""}" data-passenger="${escapeHtml(pid)}" type="button">${actionLabel}</button>
      </div>
    `;
  }).join("");

  // click asignar/quitar (delegación, así no se pierde por re-render)
  host.onclick = async (e) => {
    const btn = e.target.closest('button[data-passenger]');
    if (!btn) return;
    const pid = btn.dataset.passenger;
    if (!pid) return;

    const driverId = STATE.ui?.activeDriverId;
    if (!driverId) return toast("Primero seleccioná un chofer (izquierda).");

    const phaseIdNow = getActivePhaseId();
    try{
      await toggleAssign(driverId, pid, phaseIdNow);
      await loadEventContext(STATE.event.id); // refrescar desde Firestore
      renderPassengers();
      renderDrivers();
    }catch(err){
      console.error("ASSIGN ERROR", err);
      toast(err?.message || String(err));
    }
  };
}

async function toggleAssign(driverId, passengerId, phaseId){
  const eventId = STATE.event?.id;
  if (!eventId) throw new Error("No hay evento seleccionado");
  if (!phaseId) throw new Error("No hay fase activa");

  // Leer doc actual (evita pisar otras fases)
  const ref = doc(db, "events", eventId, "assignments", driverId);
  const snap = await getDoc(ref);

  let data = snap.exists() ? (snap.data() || {}) : {};
  if (!data.phases || typeof data.phases !== "object") data.phases = {};

  const arr = Array.isArray(data.phases[phaseId]) ? data.phases[phaseId].slice() : [];
  const i = arr.indexOf(passengerId);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(passengerId);

  // dedupe + limpieza
  const uniq = Array.from(new Set(arr.filter(Boolean)));

  data.phases[phaseId] = uniq;
  data.updatedAt = serverTimestamp();

  await setDoc(ref, data, { merge: true });
}
