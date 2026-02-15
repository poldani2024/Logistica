// events.js - Lista de eventos + gestión de fases (disponibilidad movida a Choferes x Fase)
import {
  $,
  STATE,
  initCorePage,
  loadEvents,
  renderEventSelect,
  loadEventContext,
  loadMasterDrivers,
  getSelectedEventId,
  setSelectedEventId,
  toast,
  escapeHtml,
  saveEvent,
} from "./core.js";

import { db } from "./firebase-init.js";
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

(async function init(){
  await initCorePage({ page: "events" });

  // Asegurar ui
  if (!STATE.ui) STATE.ui = { activePhase: null };

  // Drivers master (no para disponibilidad acá, pero lo dejamos porque otras pantallas lo usan y ya era parte del flujo)
  await loadMasterDrivers();

  await loadEvents();
  renderEventSelect();
  renderEventsList();

  const eid = getSelectedEventId() || STATE.events?.[0]?.id || "";
  if (eid) {
    setSelectedEventId(eid);
    await loadEventContext(eid);
  }

  renderPhases();

  $("btnNewEvent")?.addEventListener("click", onNewEvent);
  $("btnAddPhase")?.addEventListener("click", onAddPhase);
  $("btnSeedDefault")?.addEventListener("click", onSeedDefault);
  $("btnSavePhases")?.addEventListener("click", onSavePhases);

  // cuando cambia evento desde header
  document.addEventListener("eventChanged", async (ev)=>{
    const id = ev?.detail?.eventId;
    if (!id) return;
    await loadEventContext(id);
    renderEventsList();
    renderPhases();
  });
})().catch(e=>{
  console.error("INIT ERROR events.js", e);
  toast(e?.message || String(e));
});

function formatDate(iso){
  if (!iso) return "";
  try{
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("es-AR");
  }catch{ return String(iso); }
}

function renderEventsList(){
  const host = $("eventsListBox");
  if (!host) return;

  const events = STATE.events || [];
  if (!events.length){
    host.innerHTML = '<div class="emptyBox">No hay eventos cargados (o no hay permisos de lectura).</div>';
    return;
  }

  const rows = events.map(ev=>{
    const id = ev.id;
    const label = escapeHtml(ev.name || ev.title || id);
    const d1 = formatDate(ev.dateStart || ev.startDate);
    const d2 = formatDate(ev.dateEnd || ev.endDate);
    const active = (id === getSelectedEventId());
    return `
      <div class="row" style="justify-content:space-between; align-items:flex-start; gap:10px;">
        <div style="min-width:220px;">
          <div style="font-weight:700;">${label}</div>
          <div class="hint">${escapeHtml(id)}${(d1||d2) ? ` — ${escapeHtml(d1)}${d2 ? ` → ${escapeHtml(d2)}` : ""}` : ""}</div>
        </div>
        <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end;">
          <button class="btn ${active ? "primary" : ""}" data-action="select" data-id="${escapeHtml(id)}" type="button">${active ? "Activo" : "Seleccionar"}</button>
          <button class="btn" data-action="edit" data-id="${escapeHtml(id)}" type="button">Editar</button>
        </div>
      </div>
      <div class="divider"></div>
    `;
  }).join("");

  host.innerHTML = `<div class="stack">${rows}</div>`;

  host.querySelectorAll("button[data-action]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!id) return;

      if (action === "select"){
        setSelectedEventId(id);
        renderEventSelect();
        document.dispatchEvent(new CustomEvent("eventChanged", { detail: { eventId: id }}));
        return;
      }

      if (action === "edit"){
        await editEvent(id);
      }
    });
  });
}

async function onNewEvent(){
  if (!STATE.auth?.isAdmin) return toast("Solo Admin puede crear eventos.");

  const id = prompt("ID del evento (sin espacios, ej: coro-kaneco-2026-02):");
  if (!id) return;

  const name = prompt("Nombre del evento:", "");
  if (name === null) return;

  const dateStart = prompt("Fecha inicio (YYYY-MM-DD) — opcional:", "");
  if (dateStart === null) return;

  const dateEnd = prompt("Fecha fin (YYYY-MM-DD) — opcional:", "");
  if (dateEnd === null) return;

  const address = prompt("Dirección (opcional):", "");
  if (address === null) return;

  const localidad = prompt("Localidad (opcional):", "");
  if (localidad === null) return;

  await saveEvent({ id, name, dateStart, dateEnd, address, localidad });
  await loadEvents();
  renderEventSelect();
  renderEventsList();
  toast("Evento creado");
}

async function editEvent(id){
  if (!STATE.auth?.isAdmin) return toast("Solo Admin puede editar eventos.");

  const ev = (STATE.events || []).find(x => x.id === id) || { id };

  const name = prompt("Nombre del evento:", ev.name || ev.title || "");
  if (name === null) return;

  const dateStart = prompt("Fecha inicio (YYYY-MM-DD) — opcional:", (ev.dateStart || ev.startDate || "").slice(0,10));
  if (dateStart === null) return;

  const dateEnd = prompt("Fecha fin (YYYY-MM-DD) — opcional:", (ev.dateEnd || ev.endDate || "").slice(0,10));
  if (dateEnd === null) return;

  const address = prompt("Dirección (opcional):", ev.address || "");
  if (address === null) return;

  const localidad = prompt("Localidad (opcional):", ev.localidad || "");
  if (localidad === null) return;

  await saveEvent({ id, name, dateStart, dateEnd, address, localidad });
  await loadEvents();
  renderEventSelect();
  renderEventsList();
  toast("Evento guardado");
}

function slugPhaseId(name){
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "");
}

function ensurePhases(){
  if (!Array.isArray(STATE.event.phases)) STATE.event.phases = [];
}

function renderPhases(){
  const host = $("phasesBox");
  if (!host) return;

  const eventId = STATE.event?.id;
  if (!eventId){
    host.innerHTML = '<div class="emptyBox">Seleccioná un evento.</div>';
    return;
  }

  ensurePhases();
  const phases = STATE.event.phases;

  if (!phases.length){
    host.innerHTML = '<div class="emptyBox">No hay fases. Creá “Ida/Vuelta” o agregá una fase.</div>';
    return;
  }

  host.innerHTML = phases.map((p, idx)=>{
    const name = escapeHtml(p.name || p.id);
    const address = escapeHtml(p.address || "");
    const localidad = escapeHtml(p.localidad || "");
    const time = escapeHtml(p.time || "");
    return `
      <div class="row" style="justify-content:space-between; align-items:flex-start; gap:10px; padding:10px 12px; border:1px solid rgba(255,255,255,.08); border-radius:14px;">
        <div style="flex:1; min-width:220px;">
          <div style="font-weight:700">${name}</div>
          <div class="hint">${escapeHtml(p.id)}</div>

          <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:8px;">
            <input class="input" style="min-width:220px" data-field="address" data-idx="${idx}" placeholder="Domicilio" value="${address}">
            <input class="input" style="min-width:160px" data-field="localidad" data-idx="${idx}" placeholder="Localidad" value="${localidad}">
            <input class="input" style="min-width:140px" data-field="time" data-idx="${idx}" placeholder="Horario (HH:MM)" value="${time}">
          </div>
        </div>

        <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end;">
          <button class="btn" data-action="copy" data-idx="${idx}" type="button">Copiar del evento</button>
          <button class="btn" data-action="up" data-idx="${idx}" type="button">↑</button>
          <button class="btn" data-action="down" data-idx="${idx}" type="button">↓</button>
          <button class="btn danger" data-action="del" data-idx="${idx}" type="button">Borrar</button>
        </div>
      </div>
    `;
  }).join("");

  host.querySelectorAll('input[data-idx][data-field]').forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const idx = Number(inp.dataset.idx);
      const field = inp.dataset.field;
      ensurePhases();
      if (!STATE.event.phases[idx]) return;
      STATE.event.phases[idx][field] = inp.value;
    });
  });

  host.querySelectorAll('button[data-action][data-idx]').forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const idx = Number(btn.dataset.idx);
      const action = btn.dataset.action;
      ensurePhases();

      if (action === "copy"){
        const ev = (STATE.events || []).find(x => x.id === STATE.event.id) || {};
        STATE.event.phases[idx].address = ev.address || "";
        STATE.event.phases[idx].localidad = ev.localidad || "";
        renderPhases();
        return;
      }
      if (action === "up" && idx > 0){
        const tmp = STATE.event.phases[idx-1];
        STATE.event.phases[idx-1] = STATE.event.phases[idx];
        STATE.event.phases[idx] = tmp;
        renderPhases();
        return;
      }
      if (action === "down" && idx < STATE.event.phases.length - 1){
        const tmp = STATE.event.phases[idx+1];
        STATE.event.phases[idx+1] = STATE.event.phases[idx];
        STATE.event.phases[idx] = tmp;
        renderPhases();
        return;
      }
      if (action === "del"){
        STATE.event.phases.splice(idx,1);
        renderPhases();
      }
    });
  });
}

function onAddPhase(){
  const eventId = STATE.event?.id;
  if (!eventId) return toast("Seleccioná un evento.");

  const name = prompt("Nombre de la fase (ej: Ida, Vuelta, Tramo 2):");
  if (!name) return;

  ensurePhases();
  const id = slugPhaseId(name) || `fase-${STATE.event.phases.length+1}`;
  STATE.event.phases.push({ id, name, address: "", localidad: "", time: "" });
  renderPhases();
}

function onSeedDefault(){
  const eventId = STATE.event?.id;
  if (!eventId) return toast("Seleccioná un evento.");
  ensurePhases();
  if (STATE.event.phases.length) return toast("Ya hay fases. Borrá primero si querés resetear.");

  STATE.event.phases = [
    { id: "ida", name: "Ida", address: "", localidad: "", time: "" },
    { id: "vuelta", name: "Vuelta", address: "", localidad: "", time: "" },
  ];
  renderPhases();
}

async function onSavePhases(){
  const eventId = STATE.event?.id;
  if (!eventId) return toast("Seleccioná un evento.");
  ensurePhases();

  // Limpieza mínima
  const phases = STATE.event.phases
    .map(p => ({
      id: String(p.id || "").trim(),
      name: String(p.name || p.id || "").trim(),
      address: String(p.address || "").trim(),
      localidad: String(p.localidad || "").trim(),
      time: String(p.time || "").trim(),
    }))
    .filter(p => p.id);

  await updateDoc(doc(db, "events", eventId), {
    phases,
    updatedAt: serverTimestamp(),
  });

  // refrescar contexto desde Firestore para confirmar persistencia
  await loadEventContext(eventId);
  renderPhases();
  toast("Fases guardadas");
}
