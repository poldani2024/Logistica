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
  wireDatePicker("evDateStart", "btnPickEvDateStart", "evDateStartPicker");
  wireDatePicker("evDateEnd", "btnPickEvDateEnd", "evDateEndPicker");

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
  return formatDateDDMMYYYY(iso);
}

function formatDateDDMMYYYY(raw){
  if (!raw) return "";
  try {
    const s = String(raw).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;

    // Evitar corrimiento por zona horaria cuando llega YYYY-MM-DD
    // (new Date('YYYY-MM-DD') se interpreta como UTC en varios engines)
    const isoDateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) {
      const [, yyyy, mm, dd] = isoDateOnly;
      return `${dd}/${mm}/${yyyy}`;
    }

    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(raw);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${day}/${m}/${y}`;
  } catch {
    return String(raw);
  }
}

function toISODate(raw){
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new Error("Usá formato de fecha DD/MM/YYYY.");
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function slugify(s){
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildEventId({ name, dateStart }){
  const base = slugify(name) || "evento";
  const d = toPickerValue(dateStart) || new Date().toISOString().slice(0,10);
  return `${base}-${d}`;
}

function toPickerValue(raw){
  try { return toISODate(raw); } catch { return ""; }
}

function wireDatePicker(textId, btnId, pickerId){
  const txt = $(textId);
  const btn = $(btnId);
  const picker = $(pickerId);
  if (!txt || !btn || !picker) return;

  btn.addEventListener("click", () => {
    picker.value = toPickerValue(txt.value);
    if (typeof picker.showPicker === "function") picker.showPicker();
    else picker.click();
  });

  picker.addEventListener("change", () => {
    txt.value = formatDateDDMMYYYY(picker.value);
  });
}

function findEventById(id){
  return (STATE.events || []).find(x => x.id === id) || null;
}

function fillEventForm(ev){
  const isEdit = !!ev?.id;
  $("evId").value = ev?.id || "";
  $("evName").value = ev?.name || ev?.title || "";
  $("evStatus").value = ev?.status || "Nuevo";
  $("evDateStart").value = formatDateDDMMYYYY(ev?.dateStart || ev?.startDate || "");
  $("evDateEnd").value = formatDateDDMMYYYY(ev?.dateEnd || ev?.endDate || "");
  $("evAddress").value = ev?.address || "";
  $("evLocalidad").value = ev?.localidad || "";
  $("eventFormHint").textContent = isEdit
    ? `Editando evento: ${ev?.name || "(sin nombre)"}`
    : "Creando nuevo evento.";
}

function resetEventForm(){
  fillEventForm(null);
}

function readEventForm(){
  const id = String($("evId")?.value || "").trim();
  const name = String($("evName")?.value || "").trim();
  const status = String($("evStatus")?.value || "").trim() || "Nuevo";
  const dateStartRaw = String($("evDateStart")?.value || "").trim();
  const dateEndRaw = String($("evDateEnd")?.value || "").trim();
  const address = String($("evAddress")?.value || "").trim();
  const localidad = String($("evLocalidad")?.value || "").trim();

  if (!name) throw new Error("El nombre del evento es obligatorio.");
  const dateStart = dateStartRaw ? toISODate(dateStartRaw) : "";
  const dateEnd = dateEndRaw ? toISODate(dateEndRaw) : "";

  if (dateStart && dateEnd && new Date(dateStart) > new Date(dateEnd)) {
    throw new Error("La fecha de inicio no puede ser mayor a la fecha de fin.");
  }

  const finalId = id || buildEventId({ name, dateStart });

  return { id: finalId, name, status, dateStart, dateEnd, address, localidad };
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
    const label = escapeHtml(ev.name || ev.title || "Evento sin nombre");
    const d1 = formatDate(ev.dateStart || ev.startDate);
    const d2 = formatDate(ev.dateEnd || ev.endDate);
    const status = escapeHtml(ev.status || "Nuevo");
    const active = (id === getSelectedEventId());
    const rowStyle = active
      ? 'cursor:pointer; background: rgba(255,255,255,.10);'
      : 'cursor:pointer;';
    return `
      <tr data-id="${escapeHtml(id)}" style="${rowStyle}">
        <td><strong>${label}</strong></td>
        <td>${escapeHtml(d1 || "-")}</td>
        <td>${escapeHtml(d2 || "-")}</td>
        <td>${status}</td>
        <td>${escapeHtml(ev.address || "-")}</td>
        <td>${escapeHtml(ev.localidad || "-")}</td>
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
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  host.querySelectorAll("tbody tr[data-id]").forEach(row => {
    row.addEventListener("click", async (ev) => {
      if (ev.target.closest("button")) return;
      const id = row.dataset.id;
      if (!id) return;
      await selectEventAndRefresh(id);
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

  const ev = findEventById(id);
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
    fillEventForm(findEventById(payload.id) || { id: payload.id, ...payload });

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
    const date = escapeHtml(formatDateDDMMYYYY(p.date || ""));
    const pickerDate = escapeHtml(toPickerValue(p.date || ""));
    const time = escapeHtml(p.time || "");
    return `
      <div class="row" style="justify-content:space-between; align-items:flex-start; gap:10px; padding:10px 12px; border:1px solid rgba(255,255,255,.08); border-radius:14px;">
        <div style="flex:1; min-width:220px;">
          <div style="font-weight:700">${name}</div>
          <div class="hint">${escapeHtml(p.id)}</div>

          <div class="row" style="gap:8px; flex-wrap:wrap; margin-top:8px;">
            <input class="input" style="min-width:220px" data-field="address" data-idx="${idx}" placeholder="Domicilio" value="${address}">
            <input class="input" style="min-width:160px" data-field="localidad" data-idx="${idx}" placeholder="Localidad" value="${localidad}">
            <input class="input" style="min-width:150px" data-field="date" data-idx="${idx}" type="text" placeholder="DD/MM/YYYY" value="${date}">
            <button class="btn" data-action="pick-date" data-idx="${idx}" type="button" title="Seleccionar fecha">📅</button>
            <input type="date" data-picker-date="${idx}" value="${pickerDate}" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;" tabindex="-1">
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
        STATE.event.phases[idx].date = formatDateDDMMYYYY(ev.dateStart || ev.startDate || "");
        renderPhases();
        return;
      }
      if (action === "pick-date"){
        const picker = host.querySelector(`input[data-picker-date='${idx}']`);
        if (!picker) return;
        picker.value = toPickerValue(STATE.event.phases[idx].date || "");
        if (typeof picker.showPicker === "function") picker.showPicker();
        else picker.click();
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

  host.querySelectorAll("input[data-picker-date]").forEach(picker => {
    picker.addEventListener("change", () => {
      const idx = Number(picker.dataset.pickerDate);
      ensurePhases();
      if (!STATE.event.phases[idx]) return;
      STATE.event.phases[idx].date = formatDateDDMMYYYY(picker.value);
      renderPhases();
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
      date: formatDateDDMMYYYY(String(p.date || "").trim()),
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
