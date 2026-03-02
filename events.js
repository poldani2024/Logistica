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
  resetEventForm();

  $("btnNewEvent")?.addEventListener("click", onNewEvent);
  $("btnSaveEvent")?.addEventListener("click", onSaveEventForm);
  $("btnCancelEventEdit")?.addEventListener("click", resetEventForm);
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

function toDateInputValue(iso){
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return "";
  }
}

function getEventById(id){
  return (STATE.events || []).find(x => x.id === id) || null;
}

function fillEventForm(ev){
  const isEdit = !!ev?.id;
  $("evId").value = ev?.id || "";
  $("evName").value = ev?.name || ev?.title || "";
  $("evStatus").value = ev?.status || "Nuevo";
  $("evDateStart").value = toDateInputValue(ev?.dateStart || ev?.startDate || "");
  $("evDateEnd").value = toDateInputValue(ev?.dateEnd || ev?.endDate || "");
  $("evAddress").value = ev?.address || "";
  $("evLocalidad").value = ev?.localidad || "";
  $("evId").readOnly = isEdit;
  $("eventFormHint").textContent = isEdit
    ? `Editando evento: ${ev.id}`
    : "Creando nuevo evento.";
}

function resetEventForm(){
  fillEventForm(null);
}

function readEventForm(){
  const id = String($("evId")?.value || "").trim();
  const name = String($("evName")?.value || "").trim();
  const status = String($("evStatus")?.value || "").trim() || "Nuevo";
  const dateStart = String($("evDateStart")?.value || "").trim();
  const dateEnd = String($("evDateEnd")?.value || "").trim();
  const address = String($("evAddress")?.value || "").trim();
  const localidad = String($("evLocalidad")?.value || "").trim();

  if (!id) throw new Error("El ID del evento es obligatorio.");
  if (id.includes(" ")) throw new Error("El ID del evento no debe contener espacios.");
  if (!name) throw new Error("El nombre del evento es obligatorio.");
  if (dateStart && dateEnd && new Date(dateStart) > new Date(dateEnd)) {
    throw new Error("La fecha de inicio no puede ser mayor a la fecha de fin.");
  }

  return { id, name, status, dateStart, dateEnd, address, localidad };
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
    const status = escapeHtml(ev.status || "Nuevo");
    const active = (id === getSelectedEventId());
    return `
      <tr data-id="${escapeHtml(id)}" style="cursor:pointer;">
        <td><strong>${label}</strong><div class="muted">${escapeHtml(id)}</div></td>
        <td>${escapeHtml(d1 || "-")}</td>
        <td>${escapeHtml(d2 || "-")}</td>
        <td>${status}</td>
        <td>${escapeHtml(ev.address || "-")}</td>
        <td>${escapeHtml(ev.localidad || "-")}</td>
        <td>
          <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end;">
            <button class="btn ${active ? "primary" : ""}" data-action="select" data-id="${escapeHtml(id)}" type="button">${active ? "Activo" : "Seleccionar"}</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Evento</th>
          <th>Inicio</th>
          <th>Fin</th>
          <th>Estado</th>
          <th>Dirección</th>
          <th>Localidad</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  host.querySelectorAll("button[data-action]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!id) return;

      if (action === "select"){
        await selectEventAndRefresh(id);
        return;
      }
    });
  });

  host.querySelectorAll("tbody tr[data-id]").forEach(row => {
    row.addEventListener("click", async (ev) => {
      if (ev.target.closest("button")) return;
      const id = row.dataset.id;
      if (!id) return;
      await selectEventAndRefresh(id);
      editEvent(id);
    });
  });
}

async function selectEventAndRefresh(id){
  if (!id) return;
  setSelectedEventId(id);
  renderEventSelect();
  document.dispatchEvent(new CustomEvent("eventChanged", { detail: { eventId: id }}));
}

function onNewEvent(){
  if (!STATE.auth?.isAdmin) return toast("Solo Admin puede crear eventos.");
  resetEventForm();
  $("evId")?.focus();
}

function editEvent(id){
  if (!STATE.auth?.isAdmin) return toast("Solo Admin puede editar eventos.");

  const ev = getEventById(id);
  fillEventForm(ev || { id });
  $("evName")?.focus();
}

async function onSaveEventForm(){
  if (!STATE.auth?.isAdmin) return toast("Solo Admin puede guardar eventos.");

  try {
    const payload = readEventForm();
    await saveEvent(payload);
    await loadEvents();
    renderEventSelect();
    renderEventsList();

    setSelectedEventId(payload.id);
    await loadEventContext(payload.id);
    renderPhases();
    fillEventForm(getEventById(payload.id) || { id: payload.id, ...payload });

    toast("Evento guardado");
  } catch (e) {
    toast(e?.message || String(e));
  }
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
    const date = escapeHtml(p.date || "");
    const time = escapeHtml(p.time || "");
    return `
      <div class="row" style="justify-content:space-between; align-items:flex-start; gap:10px; padding:10px 12px; border:1px solid rgba(255,255,255,.08); border-radius:14px;">
        <div style="flex:1; min-width:220px;">
          <div style="font-weight:700">${name}</div>
          <div class="hint">${escapeHtml(p.id)}</div>

          <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:8px;">
            <input class="input" style="min-width:220px" data-field="address" data-idx="${idx}" placeholder="Domicilio" value="${address}">
            <input class="input" style="min-width:160px" data-field="localidad" data-idx="${idx}" placeholder="Localidad" value="${localidad}">
            <input class="input" style="min-width:170px" data-field="date" data-idx="${idx}" type="date" value="${date}">
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
        STATE.event.phases[idx].date = toDateInputValue(ev.dateStart || ev.startDate || "");
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
  STATE.event.phases.push({ id, name, address: "", localidad: "", date: "", time: "" });
  renderPhases();
}

function onSeedDefault(){
  const eventId = STATE.event?.id;
  if (!eventId) return toast("Seleccioná un evento.");
  ensurePhases();
  if (STATE.event.phases.length) return toast("Ya hay fases. Borrá primero si querés resetear.");

  STATE.event.phases = [
    { id: "ida", name: "Ida", address: "", localidad: "", date: "", time: "" },
    { id: "vuelta", name: "Vuelta", address: "", localidad: "", date: "", time: "" },
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
      date: String(p.date || "").trim(),
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
