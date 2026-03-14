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

  if (STATE.event?.id) {
    await loadEventContext(STATE.event.id);
  }

  wireOnce();
  renderCalendar();

  document.addEventListener("eventChanged", async (ev) => {
    const id = ev?.detail?.eventId;
    if (!id) return;
    await loadEventContext(id);
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

function passengerDisplayName(base, meta, passengerId){
  const fromMaster = passengerLabel(base || {});
  if (fromMaster && fromMaster !== passengerId) return fromMaster;

  const fromMetaFull = String(meta?.fullName || meta?.name || "").trim();
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
  const passengers = new Map((STATE.master?.passengers || []).map(p => [p.id, p]));
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
        const base = passengers.get(pid) || { id: pid };
        const meta = metaByPassenger.get(pid) || {};
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
          address: passengerAddress(meta, base),
          notes: ((meta.notesByPhase && meta.notesByPhase[phaseId]) || meta.notes || "")
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

  if (!unique.size){
    host.innerHTML = "";
    return;
  }

  host.innerHTML = Array.from(unique.values()).map(x =>
    `<span class="legendItem" style="background:${x.color};">${escapeHtml(x.name)}</span>`
  ).join(" ");
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
    return;
  }

  const entries = buildEntries();
  renderLegend(entries);

  const dates = Array.from(new Set(entries.map(e => e.dateISO))).sort();
  info.innerHTML = `<b>${escapeHtml(eventName())}</b> · Pasajeros agendados: <b>${entries.length}</b> · Días con agenda: <b>${dates.length}</b>`;

  if (!entries.length || !dates.length){
    table.innerHTML = "<tbody><tr><td style='padding:12px;'>No hay pasajeros asignados con fecha/horario para mostrar en calendario.</td></tr></tbody>";
    return;
  }

  const minMins = Math.max(360, Math.min(...entries.map(e => e.mins)) - 30); // mínimo 06:00
  const maxMins = Math.min(1380, Math.max(...entries.map(e => e.mins)) + 60); // máximo 23:00
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
          <div class="who">${escapeHtml(e.passenger)}</div>
          <div class="meta">${escapeHtml(e.address || "Sin domicilio/localidad")}</div>
          <div class="meta">Chofer: ${escapeHtml(e.driver)}</div>
          <div class="meta">${escapeHtml(e.phaseName)}${e.hasExplicitTime ? "" : " · Horario sin definir"}</div>
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
