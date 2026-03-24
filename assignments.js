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
  console.log("WIRE ONCE EJECUTADO");
  $("btnRefresh")?.addEventListener("click", async ()=>{
    if (!STATE.event?.id) return toast("Seleccioná un evento arriba.");
    await loadEventContext(STATE.event.id);
    renderAll();
    toast("Actualizado");
    console.log("Botón Refesh Ok");
  
  });

  $("btnExportList")?.addEventListener("click", ()=>{
    try{
      exportPhaseListToExcel();
    }catch(e){
      console.error(e);
      toast(e?.message || String(e));
    }
  });

  ($("passSearch") || $("passengerSearch"))?.addEventListener("input", ()=>renderPassengers());

  // Delegación global: filtros (chips), fases, chofer activo, asignar/quitar
  document.addEventListener("click", async (ev) => {
    // 1) Filtros pasajeros (chips en #passFilter)
    const chip = ev.target.closest("#passFilter .chip[data-filter]");
    if (chip){
      STATE.ui.passFilter = chip.dataset.filter || "pending";
      markPassengerFilterButtons();
      renderPassengers();
      return;
    }

    const el = ev.target.closest("[data-passenger],[data-driver],[data-driver-pdf],[data-phase],button");
    if (!el) return;

    // 2) ✅ Asignar / Quitar pasajero (PRIMERO para que no lo “robe” data-driver)
    const passBtn = el.closest("[data-passenger]");
    
    if (passBtn) {
      console.log("Botón Asignar Pasajero Ok");
      const pid = passBtn.dataset.passenger;
      if (!pid) return;

      const driverId = STATE.ui.activeDriverId;
      if (!driverId) return toast("Primero seleccioná un chofer (izquierda).");

      const phaseId = getActivePhaseId();
      if (!phaseId) return toast("Seleccioná una fase.");

      try{
        await toggleAssign(driverId, pid, phaseId);
        
        await loadEventContext(STATE.event.id);
        renderDrivers();
        renderPassengers();
        toast("Asignación guardada");   // 👈 acá
      }catch(err){
        console.error("ASSIGN ERROR", err);
        toast(err?.message || String(err));
      }
      return;
    }

    // 3) PDF por chofer (fase activa)
    const pdfBtn = el.closest("[data-driver-pdf]");
    if (pdfBtn){
      const driverId = pdfBtn.dataset.driverPdf || "";
      if (!driverId) return;
      const printWin = window.open("", "_blank");
      if (!printWin){
        toast("El navegador bloqueó la ventana emergente del PDF.");
        return;
      }
      try{
        generateDriverPdfReport(driverId, printWin);
      }catch(err){
        console.error("PDF ERROR", err);
        toast(err?.message || String(err));
        try { printWin.close(); } catch {}
      }
      return;
    }

    // 4) Selección de chofer
    const drvBtn = el.closest("[data-driver]");
    if (drvBtn) {
      STATE.ui.activeDriverId = drvBtn.dataset.driver || null;
      renderDrivers();
      renderActiveDriverPill();
      renderPassengers();
      console.log("Botón Selección Chofer Ok");
      return;
    }

    // 5) Cambio de fase
    const phaseBtn = el.closest("[data-phase]");
    if (phaseBtn) {
      STATE.ui.activePhase = phaseBtn.dataset.phase || null;
      renderAll();
      console.log("Botón Cambio Fase Ok");
      return;
    }
  }, true); // capture=true por si algún contenedor frena bubbling
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
  STATE.ui.activePhase = current;

  host.innerHTML = phases.map(p=>{
    const active = p.id === current;
    return `<button class="btn ${active ? "primary" : ""}" data-phase="${escapeHtml(p.id)}" type="button">${escapeHtml(p.name || p.id)}</button>`;
  }).join(" ");
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

function passengerLocationLabel(p){
  const domicilio = (p?.address || "").trim() || "—";
  const localidad = (p?.localidad || "").trim() || "—";
  return `Domicilio: ${domicilio} · Localidad: ${localidad}`;
}

function passengerDivisionVipLabel(p){
  const div = (p?.division || "").trim() || "—";
  return `División: ${div}${p?.vip ? " · VIP" : ""}`;
}

function passengerTimeForPhase(meta, phaseId){
  const m = (meta && typeof meta === "object") ? meta : {};
  return String(((m.timeByPhase && m.timeByPhase[phaseId]) || m.time || "")).trim();
}

function comparePassengersByTimeThenName(a, b){
  const ta = parseClockToMinutes(a._phaseTime || "");
  const tb = parseClockToMinutes(b._phaseTime || "");
  if (ta !== tb) return ta - tb;
  return passengerLabel(a).localeCompare(passengerLabel(b), "es", { sensitivity: "base" });
}

function driverCapacity(d){
  const cap = Number(d?.capacity ?? 4);
  return Number.isFinite(cap) && cap > 0 ? cap : 4;
}

function passengerRequiresTransportForPhase(passengerId, phaseId){
  const meta = STATE.event?.passengersMeta?.get(passengerId) || {};
  const allPhases = meta?.allPhases;
  if (allPhases === undefined || allPhases === null || allPhases === true) return true;

  const byPhase = (meta?.transportByPhase && typeof meta.transportByPhase === "object") ? meta.transportByPhase : {};
  if (!phaseId) return true;
  if (Object.prototype.hasOwnProperty.call(byPhase, phaseId)) return !!byPhase[phaseId];

  // Compat: si no está definido explícitamente, asumir que requiere transporte
  return true;
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
  const { byDriver } = getPhaseAssignments();

  host.innerHTML = drivers.map(d=>{
    const isActive = d.id === active;
    const assigned = (byDriver.get(d.id) || new Set()).size;
    const capacity = driverCapacity(d);
    const free = Math.max(capacity - assigned, 0);
    return `
      <div class="row" style="justify-content:space-between; gap:10px; padding:12px; border:1px solid rgba(255,255,255,.08); border-radius:16px;">
        <div>
          <div style="font-weight:800">${escapeHtml(driverLabel(d))} <span class="hint" style="font-weight:600; margin-left:6px;">${escapeHtml(`${assigned}/${capacity}`)}</span></div>
          <div class="hint">${escapeHtml(d.email || "")} · Disponible: ${escapeHtml(String(free))}</div>
        </div>
        <div class="row" style="gap:8px; flex-shrink:0;">
          <button class="btn" data-driver-pdf="${escapeHtml(d.id)}" type="button" title="Generar PDF para este chofer en la fase activa">PDF</button>
          <button class="btn ${isActive ? "primary" : ""}" data-driver="${escapeHtml(d.id)}" type="button" style="min-width:84px;">${isActive ? "Activo" : "Ver"}</button>
        </div>
      </div>
    `;
  }).join("");
}

function getPhaseAssignments(){
  const phaseId = getActivePhaseId();
  const byDriver = new Map();
  const assignedAll = new Set();
  const map = STATE.event?.assignments || new Map();
  const passengersInEvent = STATE.event?.passengersIds || new Set();

  for (const [driverId, a] of map.entries()){
    let ids = [];

    const hasPhases = a?.phases && typeof a.phases === "object";
    if (hasPhases && phaseId){
      // prefer phases[phaseId]
      const arr = Array.isArray(a.phases[phaseId]) ? a.phases[phaseId] : [];
      // compat: si estamos en "ida" y no hay phases.ida pero existe passengerIds, usarlo
      if (phaseId === "ida" && (!arr || arr.length === 0) && Array.isArray(a?.passengerIds) && a.passengerIds.length){
        ids = a.passengerIds;
      } else {
        ids = arr;
      }
    } else if (Array.isArray(a?.passengerIds)) {
      // formato viejo: lo tratamos como "ida"
      if (!phaseId || phaseId === "ida") ids = a.passengerIds;
    }

    const set = new Set((ids || []).filter(pid => Boolean(pid) && passengersInEvent.has(pid)));
    byDriver.set(driverId, set);
    for (const pid of set) assignedAll.add(pid);
  }
  return { byDriver, assignedAll };
}

function markPassengerFilterButtons(){
  const filter = (STATE.ui?.passFilter || "pending").toLowerCase();
  const host = $("passFilter");
  if (!host) return;
  host.querySelectorAll(".chip[data-filter]").forEach(ch=>{
    ch.classList.toggle("active", (ch.dataset.filter || "").toLowerCase() === filter);
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
  const metaById = STATE.event?.passengersMeta || new Map();
  let list = eventPassengerIds.map(id => {
    const base = byId.get(id) || { id };
    const meta = metaById.get(id) || {};
    return {
      ...base,
      _phaseTime: passengerTimeForPhase(meta, phaseId),
      address: (meta.address || base.address || ""),
      localidad: (meta.localidad || base.localidad || "")
    };
  });

  list = list.filter(p => passengerRequiresTransportForPhase(p.id, phaseId));

  const q = (($("passSearch") || $("passengerSearch"))?.value || "").trim().toLowerCase();
  if (q) list = list.filter(p => passengerLabel(p).toLowerCase().includes(q));

  const filter = (STATE.ui?.passFilter || "pendientes").toLowerCase();
  if (filter === "pendientes" || filter === "pending") list = list.filter(p => !assignedAll.has(p.id));
  if (filter === "asignados" || filter === "assigned") {
    list = activeDriverId
      ? list.filter(p => assignedToActive.has(p.id))
      : list.filter(p => assignedAll.has(p.id));
  }
  // todos/all no filtra

  list.sort(comparePassengersByTimeThenName);

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
          <div class="hint">${escapeHtml(passengerLocationLabel(p))}</div>
          <div class="hint">${escapeHtml(passengerDivisionVipLabel(p))}</div>
          <div class="hint">Horario: ${escapeHtml(p._phaseTime || "—")}</div>
          <div class="hint">${escapeHtml(status)} — Fase: ${escapeHtml(phaseId)}</div>
        </div>
        <button class="btn ${isAssignedActive ? "danger" : ""}" data-passenger="${escapeHtml(pid)}" type="button">${actionLabel}</button>
      </div>
    `;
  }).join("");
}

function phaseLabelById(phaseId){
  const p = (STATE.event?.phases || []).find(x => x.id === phaseId);
  return p?.name || phaseId || "Fase";
}

function toDisplayDate(v){
  const raw = String(v || "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth()+1).padStart(2, "0")}/${d.getFullYear()}`;
}

function excelPhoneText(value){
  return String(value ?? "").trim();
}

function parseClockToMinutes(value){
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return Number.MAX_SAFE_INTEGER;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return Number.MAX_SAFE_INTEGER;
  return hh * 60 + mm;
}

function transportTypeForPhase(meta, phaseId){
  const m = (meta && typeof meta === "object") ? meta : {};
  const byPhase = (m.transportTypeByPhase && typeof m.transportTypeByPhase === "object") ? m.transportTypeByPhase : {};
  return String(byPhase[phaseId] || m.transportType || "Omnibus").trim() || "Omnibus";
}

function getExportRowsAllPhases(){
  const phases = STATE.event?.phases || [];
  const byDriverMaster = new Map((STATE.master?.drivers || []).map(d => [d.id, d]));
  const byPassengerMaster = new Map((STATE.master?.passengers || []).map(p => [p.id, p]));
  const metaByPassenger = STATE.event?.passengersMeta || new Map();
  const eventPassengerIds = Array.from(STATE.event?.passengersIds || []);

  const rows = [];

  for (const ph of phases){
    const phaseId = ph.id;
    if (!phaseId) continue;

    const { byDriver } = getPhaseAssignmentsFor(phaseId);
    const driverByPassenger = new Map();

    for (const [driverId, passengerSet] of byDriver.entries()){
      for (const pid of passengerSet){
        if (!passengerRequiresTransportForPhase(pid, phaseId)) continue;
        if (!driverByPassenger.has(pid)) driverByPassenger.set(pid, driverId);
      }
    }

    const passengersInPhase = eventPassengerIds.filter(pid => passengerRequiresTransportForPhase(pid, phaseId));
    passengersInPhase.forEach(pid => {
      const base = byPassengerMaster.get(pid) || { id: pid };
      const meta = metaByPassenger.get(pid) || {};
      const driverId = driverByPassenger.get(pid) || "";
      const drv = driverId ? (byDriverMaster.get(driverId) || { id: driverId, name: driverId }) : null;
      rows.push({
        driverName: drv ? driverLabel(drv) : "Sin chofer asignado",
        driverPhone: drv?.phone || "",
        phase: ph.name || phaseLabelById(phaseId),
        passenger: passengerLabel(base),
        passengerPhone: base.phone || "",
        division: base.division || "",
        vip: !!base.vip,
        originAddress: meta.address || base.address || "",
        originLocalidad: meta.localidad || base.localidad || "",
        time: ((meta.timeByPhase && meta.timeByPhase[phaseId]) || meta.time || ph.time || ""),
        transportType: transportTypeForPhase(meta, phaseId),
        destinationAddress: ph.destinationAddress || ph.address || STATE.event?.address || "",
        destinationLocalidad: ph.localidad || STATE.event?.localidad || "",
        notes: ((meta.notesByPhase && meta.notesByPhase[phaseId]) || meta.notes || "")
      });
    });
  }

  rows.sort((a, b) => {
    const byTime = parseClockToMinutes(a.time) - parseClockToMinutes(b.time);
    if (byTime !== 0) return byTime;

    const byDriver = String(a.driverName || "").localeCompare(String(b.driverName || ""), "es", { sensitivity: "base" });
    if (byDriver !== 0) return byDriver;

    return String(a.phase || "").localeCompare(String(b.phase || ""), "es", { sensitivity: "base" });
  });

  return rows;
}

function getPhaseAssignmentsFor(phaseId){
  const byDriver = new Map();
  const assignedAll = new Set();
  const map = STATE.event?.assignments || new Map();
  const passengersInEvent = STATE.event?.passengersIds || new Set();

  for (const [driverId, a] of map.entries()){
    let ids = [];

    const hasPhases = a?.phases && typeof a.phases === "object";
    if (hasPhases && phaseId){
      const arr = Array.isArray(a.phases[phaseId]) ? a.phases[phaseId] : [];
      if (phaseId === "ida" && (!arr || arr.length === 0) && Array.isArray(a?.passengerIds) && a.passengerIds.length){
        ids = a.passengerIds;
      } else {
        ids = arr;
      }
    } else if (Array.isArray(a?.passengerIds)) {
      if (!phaseId || phaseId === "ida") ids = a.passengerIds;
    }

    const set = new Set((ids || []).filter(pid => Boolean(pid) && passengersInEvent.has(pid)));
    byDriver.set(driverId, set);
    for (const pid of set) assignedAll.add(pid);
  }

  return { byDriver, assignedAll };
}

function exportPhaseListToExcel(){
  const eventId = STATE.event?.id;
  if (!eventId) return toast("Seleccioná un evento.");

  const eventData = (STATE.events || []).find(ev => ev.id === eventId) || {};
  const eventName = eventData.name || eventData.title || STATE.event?.name || STATE.event?.title || eventId;
  const eventDate = toDisplayDate(eventData.dateStart || eventData.startDate || "");

  const rows = getExportRowsAllPhases();

  const tableRows = rows.map((r, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(r.driverName)}</td>
      <td class="txt">${escapeHtml(excelPhoneText(r.driverPhone))}</td>
      <td>${escapeHtml(r.phase)}</td>
      <td>${escapeHtml(r.passenger)}</td>
      <td class="txt">${escapeHtml(excelPhoneText(r.passengerPhone))}</td>
      <td>${escapeHtml(r.division || "")}</td>
      <td>${r.vip ? "Sí" : ""}</td>
      <td>${escapeHtml(r.originAddress)}</td>
      <td>${escapeHtml(r.originLocalidad)}</td>
      <td>${escapeHtml(r.time)}</td>
      <td>${escapeHtml(r.transportType || "")}</td>
      <td>${escapeHtml(r.destinationAddress)}</td>
      <td>${escapeHtml(r.destinationLocalidad)}</td>
      <td>${escapeHtml(r.notes)}</td>
    </tr>`).join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  table{ border-collapse:collapse; width:100%; font-family:Arial, Helvetica, sans-serif; }
  td, th{ border:1px solid #93c5fd; padding:6px 8px; font-size:14px; }
  .meta td{ border:none; padding:4px 8px; font-size:18px; font-weight:700; }
  .hdr th{ background:#0f5f84; color:#fff; font-size:30px; }
  .body tr:nth-child(odd) td{ background:#dbeafe; }
  .txt{ mso-number-format:"\@"; }
</style>
</head>
<body>
  <table class="meta">
    <tr><td>Evento:</td><td>${escapeHtml(eventName)}</td></tr>
    <tr><td>Fecha Evento</td><td>${escapeHtml(eventDate)}</td></tr>
  </table>
  <br/>
  <table>
    <thead class="hdr">
      <tr>
        <th>#</th><th>Chofer</th><th>Teléfono</th><th>Fase</th><th>Pasajero</th><th>Teléfono2</th><th>División</th><th>VIP</th><th>Domicilio Origen</th><th>Localidad</th><th>Horario</th><th>Tipo Transporte</th><th>Domicilio Destino</th><th>Localidad2</th><th>Observaciones</th>
      </tr>
    </thead>
    <tbody class="body">${tableRows}</tbody>
  </table>
</body>
</html>`;

  const blob = new Blob(["﻿", html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `listado_${eventId}_todas_las_fases.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(a.href), 1200);

  toast("Listado exportado a Excel (todas las fases)");
}


function collectDriverReportRows(driverId, phaseId){
  const byPassengerMaster = new Map((STATE.master?.passengers || []).map(p => [p.id, p]));
  const metaByPassenger = STATE.event?.passengersMeta || new Map();
  const { byDriver } = getPhaseAssignments();
  const ids = Array.from(byDriver.get(driverId) || [])
    .filter(pid => passengerRequiresTransportForPhase(pid, phaseId));

  return ids.map(pid => {
    const base = byPassengerMaster.get(pid) || { id: pid };
    const meta = metaByPassenger.get(pid) || {};
    return {
      passenger: passengerLabel(base),
      phone: base.phone || "",
      division: base.division || "",
      vip: !!base.vip,
      address: meta.address || base.address || "",
      localidad: meta.localidad || base.localidad || "",
      time: ((meta.timeByPhase && meta.timeByPhase[phaseId]) || meta.time || ""),
      transportType: transportTypeForPhase(meta, phaseId),
      notes: ((meta.notesByPhase && meta.notesByPhase[phaseId]) || meta.notes || "")
    };
  });
}

function buildDriverReportHtml(driver, phaseId, rows){
  const eventId = STATE.event?.id || "";
  const eventData = (STATE.events || []).find(ev => ev.id === eventId) || {};
  const eventName = eventData.name || eventData.title || eventId;
  const phaseName = phaseLabelById(phaseId);

  const bodyRows = rows.length ? rows.map((r, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(r.passenger)}</td>
      <td>${escapeHtml(r.phone)}</td>
      <td>${escapeHtml(r.division)}${r.vip ? " · VIP" : ""}</td>
      <td>${escapeHtml(r.address)}</td>
      <td>${escapeHtml(r.localidad)}</td>
      <td>${escapeHtml(r.time)}</td>
      <td>${escapeHtml(r.transportType || "")}</td>
      <td>${escapeHtml(r.notes)}</td>
    </tr>
  `).join("") : '<tr><td colspan="9">Sin pasajeros asignados para este chofer en la fase activa.</td></tr>';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Hoja de ruta - ${escapeHtml(driverLabel(driver))}</title>
<style>
  body{ font-family: Arial, Helvetica, sans-serif; padding:16px; }
  h1{ margin:0 0 8px; font-size:22px; }
  .meta{ margin-bottom:10px; font-size:14px; }
  table{ width:100%; border-collapse:collapse; }
  th,td{ border:1px solid #334155; padding:6px; font-size:12px; text-align:left; vertical-align:top; }
  th{ background:#e2e8f0; }
</style>
</head>
<body>
  <h1>Listado por chofer</h1>
  <div class="meta"><b>Evento:</b> ${escapeHtml(eventName)} · <b>Fase:</b> ${escapeHtml(phaseName)} · <b>Chofer:</b> ${escapeHtml(driverLabel(driver))}</div>
  <table>
    <thead>
      <tr><th>#</th><th>Pasajero</th><th>Teléfono</th><th>División/VIP</th><th>Domicilio</th><th>Localidad</th><th>Horario</th><th>Tipo transporte</th><th>Observaciones</th></tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;
}

function generateDriverPdfReport(driverId, win){
  const phaseId = getActivePhaseId();
  if (!STATE.event?.id) throw new Error("Seleccioná un evento.");
  if (!phaseId) throw new Error("Seleccioná una fase.");

  const driver = (STATE.master?.drivers || []).find(d => d.id === driverId) || { id: driverId };
  const rows = collectDriverReportRows(driverId, phaseId);
  const html = buildDriverReportHtml(driver, phaseId, rows);

  const target = win || window.open("", "_blank");
  if (!target) throw new Error("El navegador bloqueó la ventana emergente del PDF.");

  target.document.open();
  target.document.write(html);
  target.document.close();
  target.focus();
  setTimeout(()=>{
    target.print();
  }, 250);
}

async function toggleAssign(driverId, passengerId, phaseId){
  const eventId = STATE.event?.id;
  if (!eventId) throw new Error("No hay evento seleccionado");
  if (!phaseId) throw new Error("No hay fase activa");
  
  console.log("Driver ID: " , driverId);
   console.log("passengerId: ", passengerId);
   console.log("phaseId:  " , phaseId);
  
  const ref = doc(db, "events", eventId, "assignments", driverId);
  const snap = await getDoc(ref);

  let data = snap.exists() ? (snap.data() || {}) : {};
  if (!data.phases || typeof data.phases !== "object") data.phases = {};

  // Compat: si estamos en "ida" y venimos del formato viejo, arrancamos desde passengerIds
let base = Array.isArray(data.phases[phaseId]) ? data.phases[phaseId].slice() : null;
if ((!base || base.length === 0) && phaseId === "ida" && Array.isArray(data.passengerIds) && data.passengerIds.length){
  base = data.passengerIds.slice();
}
const arr = base || [];

  const i = arr.indexOf(passengerId);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(passengerId);

  data.phases[phaseId] = Array.from(new Set(arr.filter(Boolean)));
  if (phaseId === "ida") data.passengerIds = data.phases[phaseId];
  data.updatedAt = serverTimestamp();

  await setDoc(ref, data, { merge: true });
  console.log("Grabó ok");
}
