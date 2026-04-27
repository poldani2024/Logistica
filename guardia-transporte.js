import { initCorePage, STATE, $, toast, escapeHtml } from "./core.js";
import { db } from "./firebase-init.js";
import { collection, getDocs, setDoc, doc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 8..20
const SHIFT_DEFS = [
  { id: "morning", label: "Mañana", from: 8, to: 11, color: "rgba(59,130,246,.28)" },
  { id: "noon", label: "Mediodía", from: 12, to: 15, color: "rgba(168,85,247,.28)" },
  { id: "afternoon", label: "Tarde", from: 16, to: 20, color: "rgba(249,115,22,.28)" }
];

const UI = {
  guards: new Map(),
  guardPeriods: [],
  search: ""
};

(async function init(){
  await initCorePage({ page: "assignments" });
  wire();
  seedDates();
  if (STATE.event?.id) {
    await Promise.all([
      loadGuards(STATE.event.id),
      loadGuardPeriods(STATE.event.id)
    ]);
  }
  renderAll();

  document.addEventListener("eventChanged", async (ev) => {
    const id = ev?.detail?.eventId;
    if (!id) return;
    await Promise.all([
      loadGuards(id),
      loadGuardPeriods(id)
    ]);
    renderAll();
  });
})().catch((e) => {
  console.error("INIT ERROR guardia-transporte", e);
  toast(e?.message || String(e));
});

function wire(){
  $("btnRefreshGuards")?.addEventListener("click", async () => {
    if (!STATE.event?.id) return toast("Seleccioná un evento arriba.");
    await loadGuards(STATE.event.id);
    renderAll();
    toast("Guardias actualizadas");
  });

  $("btnApplyTemplate")?.addEventListener("click", async () => {
    try {
      await applyTemplateRange();
      await Promise.all([
        loadGuards(STATE.event.id),
        loadGuardPeriods(STATE.event.id)
      ]);
      renderGuardPeriods();
      renderCalendar();
      toast("Turnos creados en calendario");
    } catch (e) {
      toast(e?.message || String(e));
    }
  });

  $("btnSavePeriod")?.addEventListener("click", async () => {
    try {
      await saveCurrentGuardPeriod();
      await loadGuardPeriods(STATE.event.id);
      renderGuardPeriods();
      toast("Período guardado");
    } catch (e) {
      toast(e?.message || String(e));
    }
  });

  $("driverSearch")?.addEventListener("input", (ev) => {
    UI.search = String(ev?.target?.value || "").trim().toLowerCase();
    renderDriversPool();
  });

  $("btnSendWhatsApp")?.addEventListener("click", sendWhatsAppInvites);

  document.addEventListener("dragstart", onDragStart);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("drop", onDrop);
  document.addEventListener("dragend", clearDropHover);

  document.addEventListener("click", async (ev) => {
    const removeBtn = ev.target.closest("[data-remove-driver]");
    if (!removeBtn) return;

    const date = removeBtn.dataset.date;
    const hour = Number(removeBtn.dataset.hour || NaN);
    const driverId = removeBtn.dataset.removeDriver || "";
    if (!date || !Number.isFinite(hour) || !driverId) return;

    await removeDriverFromSlot(date, hour, driverId);
    await loadGuards(STATE.event.id);
    renderCalendar();
  });

  document.addEventListener("click", (ev) => {
    const useBtn = ev.target.closest("[data-use-guard-period]");
    if (!useBtn) return;
    const periodId = String(useBtn.dataset.useGuardPeriod || "");
    if (!periodId) return;
    applyGuardPeriodSelection(periodId);
  });
}

function seedDates(){
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const iso = `${y}-${m}-${d}`;
  $("guardFrom").value = iso;

  const plus6 = new Date(today);
  plus6.setDate(today.getDate() + 6);
  const y2 = plus6.getFullYear();
  const m2 = String(plus6.getMonth() + 1).padStart(2, "0");
  const d2 = String(plus6.getDate()).padStart(2, "0");
  $("guardTo").value = `${y2}-${m2}-${d2}`;
}

async function loadGuards(eventId){
  UI.guards.clear();
  if (!eventId) return;
  const snap = await getDocs(collection(db, "events", eventId, "transportGuards"));
  snap.forEach((row) => {
    const data = row.data() || {};
    const date = String(data.date || "");
    const hour = Number(data.hour);
    if (!date || !Number.isFinite(hour)) return;
    UI.guards.set(slotKey(date, hour), {
      date,
      hour,
      shift: inferShift(hour),
      driverIds: Array.isArray(data.driverIds) ? data.driverIds.filter(Boolean) : []
    });
  });
}

async function loadGuardPeriods(eventId){
  UI.guardPeriods = [];
  if (!eventId) return;

  const snap = await getDocs(collection(db, "events", eventId, "transportGuardPeriods"));
  const rows = [];
  snap.forEach((row) => {
    const data = row.data() || {};
    const from = String(data.from || "");
    const to = String(data.to || "");
    if (!from || !to) return;
    const shiftIds = Array.isArray(data.shiftIds) ? data.shiftIds.filter(Boolean) : [];
    rows.push({
      id: row.id,
      from,
      to,
      shiftIds,
      createdAtMs: Number(data.createdAtMs || 0)
    });
  });

  UI.guardPeriods = rows.sort((a, b) => {
    const byCreated = (b.createdAtMs || 0) - (a.createdAtMs || 0);
    if (byCreated !== 0) return byCreated;
    if (a.from !== b.from) return String(b.from).localeCompare(String(a.from));
    return String(b.to).localeCompare(String(a.to));
  });
}

function renderAll(){
  renderDriversPool();
  renderGuardPeriods();
  renderCalendar();
}

function renderGuardPeriods(){
  const host = $("guardPeriodsList");
  if (!host) return;

  if (!UI.guardPeriods.length){
    host.innerHTML = '<div class="periodRow"><span class="periodMeta">Sin períodos guardados.</span></div>';
    return;
  }

  host.innerHTML = UI.guardPeriods.map((p) => `
    <div class="periodRow">
      <div>
        <div><strong>${escapeHtml(p.from)} → ${escapeHtml(p.to)}</strong></div>
        <div class="periodMeta">${escapeHtml(periodShiftLabels(p.shiftIds))}</div>
      </div>
      <button class="btn" type="button" data-use-guard-period="${escapeHtml(p.id)}">Usar</button>
    </div>
  `).join("");
}

function renderDriversPool(){
  const host = $("driversPool");
  if (!host) return;

  const drivers = (STATE.master?.drivers || [])
    .filter((d) => driverLabel(d).toLowerCase().includes(UI.search))
    .sort((a, b) => driverLabel(a).localeCompare(driverLabel(b), "es", { sensitivity: "base" }));

  if (!drivers.length){
    host.innerHTML = '<div class="hint">No hay choferes para mostrar.</div>';
    return;
  }

  host.innerHTML = drivers.map((d) => `
    <div class="driverItem">
      <label style="display:flex; align-items:center; gap:8px; flex:1;">
        <input type="checkbox" data-driver-select="${escapeHtml(d.id)}" />
        <span>${escapeHtml(driverLabel(d))}</span>
      </label>
      <div class="driverCard" draggable="true" data-drag-type="driver" data-driver-id="${escapeHtml(d.id)}">
        Arrastrar
        <small>${escapeHtml(d.phone || d.email || "Sin teléfono")}</small>
      </div>
    </div>
  `).join("");
}

function renderCalendar(){
  const table = $("guardCalendar");
  if (!table) return;

  const dates = buildDateRange($("guardFrom")?.value, $("guardTo")?.value);
  if (!dates.length){
    table.innerHTML = "<tr><td>Definí rango de fechas.</td></tr>";
    return;
  }

  const head = `
    <thead>
      <tr>
        <th class="timeCol">Hora</th>
        ${dates.map((iso) => `<th>${escapeHtml(formatHeaderDate(iso))}</th>`).join("")}
      </tr>
    </thead>
  `;

  const bodyRows = HOURS.map((hour) => {
    const hourLabel = `${String(hour).padStart(2, "0")}:00`;
    const cells = dates.map((date) => {
      const key = slotKey(date, hour);
      const slot = UI.guards.get(key);
      const shift = slot?.shift || inferShift(hour);
      const shiftDef = SHIFT_DEFS.find((x) => x.id === shift);
      const bg = shiftDef ? shiftDef.color : "rgba(255,255,255,.02)";
      const assigned = (slot?.driverIds || []).map((driverId) => {
        const drv = (STATE.master?.drivers || []).find((x) => x.id === driverId) || { id: driverId };
        return `<div class="tag"><span>${escapeHtml(driverLabel(drv))}</span><button type="button" data-remove-driver="${escapeHtml(driverId)}" data-date="${escapeHtml(date)}" data-hour="${hour}" title="Quitar">×</button></div>`;
      }).join("");

      return `
        <td class="slot" style="background:${bg};" data-drop-zone="slot" data-date="${escapeHtml(date)}" data-hour="${hour}">
          <span class="pillShift">${escapeHtml(shiftDef?.label || "Sin turno")}</span>
          ${assigned || ""}
        </td>
      `;
    }).join("");

    return `<tr><td class="timeCol">${hourLabel}</td>${cells}</tr>`;
  }).join("");

  table.innerHTML = `${head}<tbody>${bodyRows}</tbody>`;
}

function onDragStart(ev){
  const item = ev.target.closest("[data-drag-type='driver']");
  if (!item) return;

  const payload = { driverId: item.dataset.driverId || "" };
  ev.dataTransfer?.setData("application/json", JSON.stringify(payload));
  ev.dataTransfer.effectAllowed = "copyMove";
}

function onDragOver(ev){
  const zone = ev.target.closest("[data-drop-zone='slot']");
  if (!zone) return;
  ev.preventDefault();
  zone.classList.add("dropHover");
}

async function onDrop(ev){
  const zone = ev.target.closest("[data-drop-zone='slot']");
  if (!zone) return;
  ev.preventDefault();
  clearDropHover();

  const raw = ev.dataTransfer?.getData("application/json");
  if (!raw) return;

  let payload;
  try { payload = JSON.parse(raw); } catch { return; }

  const date = String(zone.dataset.date || "");
  const hour = Number(zone.dataset.hour || NaN);
  const driverId = String(payload?.driverId || "");
  if (!date || !Number.isFinite(hour) || !driverId) return;

  await addDriverToSlot(date, hour, driverId);
  await loadGuards(STATE.event.id);
  renderCalendar();
}

function clearDropHover(){
  document.querySelectorAll(".slot.dropHover").forEach((el) => el.classList.remove("dropHover"));
}

async function applyTemplateRange(){
  if (!STATE.event?.id) throw new Error("Seleccioná un evento.");
  const from = $("guardFrom")?.value || "";
  const to = $("guardTo")?.value || "";
  const dates = buildDateRange(from, to);
  if (!dates.length) throw new Error("Rango de fechas inválido.");

  const shifts = selectedShiftIds();
  if (!shifts.length) throw new Error("Seleccioná al menos un turno.");
  await saveCurrentGuardPeriod({ from, to, shiftIds: shifts });

  const promises = [];
  dates.forEach((date) => {
    HOURS.forEach((hour) => {
      const shift = inferShift(hour);
      if (!shifts.includes(shift)) return;
      const ref = doc(db, "events", STATE.event.id, "transportGuards", slotKey(date, hour));
      promises.push(setDoc(ref, {
        date,
        hour,
        shift,
        driverIds: [],
        updatedAt: serverTimestamp(),
        updatedBy: STATE.auth?.user?.email || ""
      }, { merge: true }));
    });
  });
  await Promise.all(promises);
}

async function saveCurrentGuardPeriod(opts = {}){
  if (!STATE.event?.id) throw new Error("Seleccioná un evento.");
  const from = String(opts.from || $("guardFrom")?.value || "");
  const to = String(opts.to || $("guardTo")?.value || "");
  const shiftIds = Array.isArray(opts.shiftIds) && opts.shiftIds.length
    ? opts.shiftIds
    : selectedShiftIds();

  const dates = buildDateRange(from, to);
  if (!dates.length) throw new Error("Rango de fechas inválido.");
  if (!shiftIds.length) throw new Error("Seleccioná al menos un turno.");

  const periodId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(doc(db, "events", STATE.event.id, "transportGuardPeriods", periodId), {
    from,
    to,
    shiftIds,
    createdAtMs: Date.now(),
    createdAt: serverTimestamp(),
    createdBy: STATE.auth?.user?.email || ""
  });
}

async function addDriverToSlot(date, hour, driverId){
  if (!STATE.event?.id) return;
  const key = slotKey(date, hour);
  const current = UI.guards.get(key) || { date, hour, shift: inferShift(hour), driverIds: [] };
  const nextIds = Array.from(new Set([...(current.driverIds || []), driverId]));

  await setDoc(doc(db, "events", STATE.event.id, "transportGuards", key), {
    date,
    hour,
    shift: current.shift || inferShift(hour),
    driverIds: nextIds,
    updatedAt: serverTimestamp(),
    updatedBy: STATE.auth?.user?.email || ""
  }, { merge: true });
}

async function removeDriverFromSlot(date, hour, driverId){
  if (!STATE.event?.id) return;
  const key = slotKey(date, hour);
  const current = UI.guards.get(key);
  if (!current) return;

  const nextIds = (current.driverIds || []).filter((id) => id !== driverId);
  if (nextIds.length === 0) {
    await deleteDoc(doc(db, "events", STATE.event.id, "transportGuards", key));
    return;
  }

  await setDoc(doc(db, "events", STATE.event.id, "transportGuards", key), {
    driverIds: nextIds,
    updatedAt: serverTimestamp(),
    updatedBy: STATE.auth?.user?.email || ""
  }, { merge: true });
}

function sendWhatsAppInvites(){
  const selected = Array.from(document.querySelectorAll("[data-driver-select]:checked"))
    .map((input) => input.getAttribute("data-driver-select") || "")
    .filter(Boolean);

  if (!selected.length) return toast("Seleccioná al menos un chofer.");

  const eventName = activeEventName();
  const dates = `${$("guardFrom")?.value || ""} al ${$("guardTo")?.value || ""}`;
  const shiftText = buildShiftWhatsappText(selectedShiftIds());
  const template = $("waTemplate")?.value || "";
  const icons = buildWhatsAppIcons();

  selected.forEach((driverId, idx) => {
    const driver = (STATE.master?.drivers || []).find((d) => d.id === driverId) || { id: driverId };
    const phone = normalizeWhatsAppPhone(driver.phone);
    if (!phone) return;

    const message = template
      .replaceAll("{{chofer}}", driverFirstName(driver))
      .replaceAll("{{evento}}", eventName)
      .replaceAll("{{fechas}}", dates)
      .replaceAll("{{turnos}}", shiftText)
      .replaceAll("{{iconos_autos}}", icons.cars)
      .replaceAll("{{icono_fechas}}", icons.dates)
      .replaceAll("{{icono_turnos}}", icons.turns)
      .replaceAll("{{icono_loto}}", icons.lotus);

    setTimeout(() => {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
    }, idx * 180);
  });

  toast("Abriendo WhatsApp para choferes seleccionados");
}

function selectedShiftIds(){
  const ids = [];
  if ($("shiftMorning")?.checked) ids.push("morning");
  if ($("shiftNoon")?.checked) ids.push("noon");
  if ($("shiftAfternoon")?.checked) ids.push("afternoon");
  return ids;
}

function inferShift(hour){
  if (hour <= 11) return "morning";
  if (hour <= 15) return "noon";
  return "afternoon";
}

function buildDateRange(from, to){
  if (!from || !to) return [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const out = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
    if (out.length > 45) break;
  }
  return out;
}

function formatHeaderDate(iso){
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function slotKey(date, hour){
  return `${date}_${String(hour).padStart(2, "0")}`;
}

function driverLabel(d){
  return `${d.lastName || ""} ${d.firstName || ""}`.trim() || d.name || d.email || d.id;
}

function driverFirstName(d){
  const firstName = String(d?.firstName || "").trim();
  if (firstName) return firstName;

  const fullName = String(d?.name || "").trim();
  if (fullName) return fullName.split(/\s+/)[0] || fullName;

  const fallback = driverLabel(d);
  return String(fallback).split(/\s+/)[0] || fallback;
}

function activeEventName(){
  const id = STATE.event?.id || "";
  const ev = (STATE.events || []).find((x) => x.id === id) || {};
  return ev.name || ev.title || id || "evento";
}

function normalizeWhatsAppPhone(raw){
  let digits = String(raw || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("54")) digits = `54${digits}`;
  return digits;
}

function buildShiftWhatsappText(shiftIds){
  const enabled = Array.isArray(shiftIds) ? shiftIds : [];
  const defaults = {
    morning: "• Mañana: 8 a 12",
    noon: "• Mediodía: 14 a 18",
    afternoon: "• Tarde: 18 a 20"
  };
  const lines = enabled
    .map((id) => defaults[id])
    .filter(Boolean);

  if (lines.length) return lines.join("\n");
  return Object.values(defaults).join("\n");
}

function buildWhatsAppIcons(){
  return {
    cars: String.fromCodePoint(0x1F697, 0x1F695, 0x1F699),
    dates: String.fromCodePoint(0x1F4C6),
    turns: String.fromCodePoint(0x1F55C),
    lotus: String.fromCodePoint(0x1FAB7)
  };
}

function applyGuardPeriodSelection(periodId){
  const period = UI.guardPeriods.find((x) => x.id === periodId);
  if (!period) return;

  $("guardFrom").value = period.from || "";
  $("guardTo").value = period.to || "";

  const set = new Set(Array.isArray(period.shiftIds) ? period.shiftIds : []);
  $("shiftMorning").checked = set.has("morning");
  $("shiftNoon").checked = set.has("noon");
  $("shiftAfternoon").checked = set.has("afternoon");
  renderCalendar();
}

function periodShiftLabels(shiftIds){
  const labels = (Array.isArray(shiftIds) ? shiftIds : [])
    .map((id) => SHIFT_DEFS.find((x) => x.id === id)?.label)
    .filter(Boolean);
  return labels.length ? labels.join(", ") : "Sin turnos";
}
