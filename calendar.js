import {
  initCorePage,
  STATE,
  $,
  toast,
  escapeHtml,
  loadEventContext,
  driversForPhase
} from "./core.js";

const PHASE_COLORS = ["#0f5f84", "#6d28d9", "#0f766e", "#b45309", "#be123c", "#334155"];

(async function init(){
  await initCorePage({ page: "calendar" });

  if (!STATE.ui) STATE.ui = {};
  if (!STATE.ui.calendarPhaseFilter) STATE.ui.calendarPhaseFilter = "all";
  if (!STATE.ui.calendarDriverFilter) STATE.ui.calendarDriverFilter = "all";

  if (STATE.event?.id) {
    await loadEventContext(STATE.event.id);
  }

  wireOnce();
  renderCalendar();

  document.addEventListener("eventChanged", async (ev) => {
    const id = ev?.detail?.eventId;
    if (!id) return;
    await loadEventContext(id);
    STATE.ui.calendarPhaseFilter = "all";
    STATE.ui.calendarDriverFilter = "all";
    renderCalendar();
  });
})().catch((e)=>{
  console.error("INIT ERROR calendar", e);
  toast(e?.message || String(e));
});

function wireOnce(){
  $("btnRefreshCalendar")?.addEventListener("click", async ()=>{
    if (!STATE.event?.id) return toast("Seleccioná un evento arriba.");
    await loadEventContext(STATE.event.id);
    renderCalendar();
    toast("Calendario actualizado");
  });

  $("calendarPhaseFilter")?.addEventListener("change", (ev)=>{
    STATE.ui.calendarPhaseFilter = ev.target.value || "all";
    renderCalendar();
  });

  $("calendarDriverFilter")?.addEventListener("change", (ev)=>{
    STATE.ui.calendarDriverFilter = ev.target.value || "all";
    renderCalendar();
  });
}

function eventName(){
  const id = STATE.event?.id || "";
  const ev = (STATE.events || []).find(x => x.id === id) || {};
  return ev.name || ev.title || id || "Sin evento";
}

function eventDate(){
  const id = STATE.event?.id || "";
  const ev = (STATE.events || []).find(x => x.id === id) || {};
  return String(ev.dateStart || ev.startDate || "").trim();
}

function toISODateLike(raw){
  const txt = String(raw || "").trim();
  if (!txt) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(txt)) return txt.slice(0, 10);
  const d = new Date(txt);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateHeader(iso){
  if (!iso) return "Sin fecha";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth()+1).padStart(2, "0")}`;
}

function parseTimeToMinutes(raw){
  const txt = String(raw || "").trim();
  if (!txt) return null;
  const m = txt.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesToLabel(mins){
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function normalizeText(value){
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function statusInfo(meta, phaseId){
  const byPhase = (meta?.trackingByPhase && typeof meta.trackingByPhase === "object") ? meta.trackingByPhase : {};
  const phaseStatus = byPhase?.[phaseId]?.status;
  const raw = phaseStatus || meta?.trackingStatus || meta?.status || "planificado";
  const n = normalizeText(raw);

  if (n.includes("destino")) return { key: "destino", label: "En destino", icon: "✅" };
  if (n.includes("transito") || n.includes("transit")) return { key: "transito", label: "En tránsito", icon: "🚐" };
  if (n.includes("pendiente") || n.includes("pending")) return { key: "pendiente", label: "Pendiente", icon: "⏳" };
  return { key: "planificado", label: "Planificado", icon: "📌" };
}

function getAssignmentsForPhase(phaseId){
  const byDriver = new Map();
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

    byDriver.set(driverId, (ids || []).filter(pid => pid && passengersInEvent.has(pid)));
  }

  return byDriver;
}

function passengerLabel(p){
  return `${p.lastName || ""} ${p.firstName || ""}`.trim() || p.name || p.email || p.id;
}

function buildPassengerIndex(){
  const idx = new Map();
  (STATE.master?.passengers || []).forEach(p => {
    if (!p || typeof p !== "object") return;
    [p.id, p.uid, p.passengerId, p.userId].forEach(k => {
      const key = String(k || "").trim();
      if (key) idx.set(key, p);
    });
  });
  return idx;
}

function resolvePassengerBase(passengerId, meta, passengerIndex){
  const direct = passengerIndex.get(passengerId);
  if (direct) return direct;

  const keys = [
    meta?.passengerId,
    meta?.masterPassengerId,
    meta?.linkedPassengerId,
    meta?.userId,
    meta?.uid,
    meta?.id
  ].map(v => String(v || "").trim()).filter(Boolean);

  for (const key of keys){
    const hit = passengerIndex.get(key);
    if (hit) return hit;
  }

  const metaEmail = String(meta?.email || "").trim().toLowerCase();
  if (metaEmail){
    const byEmail = (STATE.master?.passengers || []).find(p => String(p?.email || "").trim().toLowerCase() === metaEmail);
    if (byEmail) return byEmail;
  }

  return { id: passengerId };
}

function passengerDisplayName(base, meta, passengerId){
  const fromMaster = passengerLabel(base || {});
  if (fromMaster && fromMaster !== passengerId) return fromMaster;

  const fromMetaFull = String(meta?.fullName || meta?.name || meta?.passengerName || "").trim();
  if (fromMetaFull) return fromMetaFull;

  const fromMetaSplit = `${meta?.lastName || ""} ${meta?.firstName || ""}`.trim();
  if (fromMetaSplit) return fromMetaSplit;

  return passengerId || "Pasajero";
}

function driverLabel(d){
  return `${d.lastName || ""} ${d.firstName || ""}`.trim() || d.name || d.email || d.id;
}

function passengerAddress(meta, base){
  const domicilio = (meta?.address || base?.address || "").trim();
  const localidad = (meta?.localidad || base?.localidad || "").trim();
  return [domicilio, localidad].filter(Boolean).join(" · ");
}

function buildEntries(){
  const phases = STATE.event?.phases || [];
  const passengerIndex = buildPassengerIndex();
  const drivers = new Map((STATE.master?.drivers || []).map(d => [d.id, d]));
  const metaByPassenger = STATE.event?.passengersMeta || new Map();
  const defaultDate = toISODateLike(eventDate());

  const entries = [];

  phases.forEach((phase, phaseIdx) => {
    const phaseId = phase.id;
    if (!phaseId) return;

    const byDriver = getAssignmentsForPhase(phaseId);
    const phaseDate = toISODateLike(phase.date) || defaultDate;

    byDriver.forEach((passengerIds, driverId) => {
      const driver = drivers.get(driverId) || (driversForPhase(phaseId) || []).find(d => d.id === driverId) || { id: driverId };
      passengerIds.forEach(pid => {
        const meta = metaByPassenger.get(pid) || {};
        const base = resolvePassengerBase(pid, meta, passengerIndex);
        const timeRaw = (meta.timeByPhase && meta.timeByPhase[phaseId]) || meta.time || phase.time || "";
        const mins = parseTimeToMinutes(timeRaw);
        if (!phaseDate) return;

        entries.push({
          phaseId,
          phaseName: phase.name || phaseId,
          color: PHASE_COLORS[phaseIdx % PHASE_COLORS.length],
          dateISO: phaseDate,
          mins: mins == null ? 480 : mins,
          hasExplicitTime: mins != null,
          passenger: passengerDisplayName(base, meta, pid),
          driver: driverLabel(driver),
          driverId,
          address: passengerAddress(meta, base),
          notes: ((meta.notesByPhase && meta.notesByPhase[phaseId]) || meta.notes || ""),
          status: statusInfo(meta, phaseId)
        });
      });
    });
  });

  return entries;
}

function renderLegend(entries){
  const host = $("calendarLegend");
  if (!host) return;
  const unique = new Map();
  entries.forEach(e => {
    if (!unique.has(e.phaseId)) unique.set(e.phaseId, { color: e.color, name: e.phaseName });
  });

  const statusLegend = [
    '<span class="legendItem">📌 Planificado</span>',
    '<span class="legendItem">⏳ Pendiente</span>',
    '<span class="legendItem">🚐 En tránsito</span>',
    '<span class="legendItem">✅ En destino</span>'
  ];

  const phaseLegend = Array.from(unique.values()).map(x =>
    `<span class="legendItem" style="background:${x.color};">${escapeHtml(x.name)}</span>`
  );

  host.innerHTML = [...phaseLegend, ...statusLegend].join(" ");
}

function renderFilters(entries){
  const phaseSel = $("calendarPhaseFilter");
  const driverSel = $("calendarDriverFilter");
  if (!phaseSel || !driverSel) return;

  const selectedPhase = STATE.ui?.calendarPhaseFilter || "all";
  const selectedDriver = STATE.ui?.calendarDriverFilter || "all";

  const phases = STATE.event?.phases || [];
  phaseSel.innerHTML = `<option value="all">Todas</option>` + phases.map(p =>
    `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`
  ).join("");

  const driverMap = new Map();
  entries.forEach(e => driverMap.set(e.driverId, e.driver));
  driverSel.innerHTML = `<option value="all">Todos</option>` + Array.from(driverMap.entries())
    .sort((a,b)=> String(a[1]).localeCompare(String(b[1]), "es", { sensitivity:"base" }))
    .map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`).join("");

  phaseSel.value = phaseSel.querySelector(`option[value="${selectedPhase}"]`) ? selectedPhase : "all";
  driverSel.value = driverSel.querySelector(`option[value="${selectedDriver}"]`) ? selectedDriver : "all";

  STATE.ui.calendarPhaseFilter = phaseSel.value;
  STATE.ui.calendarDriverFilter = driverSel.value;
}

function applyFilters(entries){
  const phase = STATE.ui?.calendarPhaseFilter || "all";
  const driver = STATE.ui?.calendarDriverFilter || "all";

  return entries.filter(e => {
    if (phase !== "all" && e.phaseId !== phase) return false;
    if (driver !== "all" && e.driverId !== driver) return false;
    return true;
  });
}

function renderCalendar(){
  const info = $("calendarEventInfo");
  const table = $("calendarTable");
  if (!table || !info) return;

  const eventId = STATE.event?.id;
  if (!eventId){
    info.textContent = "Seleccioná un evento para ver el calendario.";
    table.innerHTML = "<tbody><tr><td style='padding:12px;'>Sin evento seleccionado.</td></tr></tbody>";
    renderLegend([]);
    renderFilters([]);
    return;
  }

  const allEntries = buildEntries();
  renderFilters(allEntries);
  const entries = applyFilters(allEntries);
  renderLegend(entries);

  const dates = Array.from(new Set(entries.map(e => e.dateISO))).sort();
  info.innerHTML = `<b>${escapeHtml(eventName())}</b> · Registros filtrados: <b>${entries.length}</b> de <b>${allEntries.length}</b> · Días con agenda: <b>${dates.length}</b>`;

  if (!entries.length || !dates.length){
    table.innerHTML = "<tbody><tr><td style='padding:12px;'>No hay asignaciones para el filtro seleccionado.</td></tr></tbody>";
    return;
  }

  const minMins = Math.max(360, Math.min(...entries.map(e => e.mins)) - 30);
  const maxMins = Math.min(1380, Math.max(...entries.map(e => e.mins)) + 60);
  const start = Math.floor(minMins / 30) * 30;
  const end = Math.ceil(maxMins / 30) * 30;

  const bucket = new Map();
  entries.forEach(e => {
    const key = `${e.dateISO}|${e.mins}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(e);
  });

  const headDays = dates.map(d => `<th>${escapeHtml(formatDateHeader(d))}</th>`).join("");
  let body = "";

  for (let mins = start; mins <= end; mins += 30){
    const cells = dates.map(d => {
      const key = `${d}|${mins}`;
      const items = (bucket.get(key) || []).map(e => `
        <div class="entry" style="background:${e.color};">
          <div class="who">${e.status.icon} ${escapeHtml(e.passenger)}</div>
          <div class="meta">${escapeHtml(e.address || "Sin domicilio/localidad")}</div>
          <div class="meta">Chofer: ${escapeHtml(e.driver)}</div>
          <div class="meta">${escapeHtml(e.phaseName)}${e.hasExplicitTime ? "" : " · Horario sin definir"}</div>
          <div class="meta">Estado: ${escapeHtml(e.status.label)}</div>
          ${e.notes ? `<div class="meta">Obs: ${escapeHtml(e.notes)}</div>` : ""}
        </div>
      `).join("");
      return `<td class="calendarCell">${items}</td>`;
    }).join("");

    body += `<tr><td class="calendarTime">${minutesToLabel(mins)}</td>${cells}</tr>`;
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:74px;">Horario</th>
        ${headDays}
      </tr>
    </thead>
    <tbody>${body}</tbody>
  `;
}
