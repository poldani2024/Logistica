import { initCorePage, STATE, $, toast, escapeHtml, loadMasterDrivers, loadEventContext, saveDriverPhase, getDriverCapacityForPhase } from "./core.js";

(async function init(){
  await initCorePage({ page: "driversByPhase" });

  // ✅ Asegurar contenedor UI (algunas versiones de core.js no lo traen)
  if (!STATE.ui) STATE.ui = { activePhase: null };

  await loadMasterDrivers();

  const eventId = STATE.event?.id;
  if (!eventId) {
    toast("Seleccioná un evento.");
    renderPhases();
    renderDrivers();
    return;
  }

  await loadEventContext(eventId);

  renderPhases();
  renderDrivers();

  $("phaseSelect")?.addEventListener("change", () => {
    if (!STATE.ui) STATE.ui = { activePhase: null };
    STATE.ui.activePhase = $("phaseSelect").value || null;
    renderDrivers();
  });

  $("btnAllOn")?.addEventListener("click", () => setAll(true));
  $("btnAllOff")?.addEventListener("click", () => setAll(false));
  $("btnSave")?.addEventListener("click", onSave);

  // Cuando cambia el evento desde el header (core dispara este evento)
  document.addEventListener("eventChanged", async (ev) => {
    const id = ev?.detail?.eventId;
    if (!id) return;
    await loadEventContext(id);
    renderPhases();
    renderDrivers();
  });
})().catch((e)=>{
  console.error("INIT ERROR choferes-x-fase", e);
  toast(e?.message || String(e));
});

function renderPhases(){
  const sel = $("phaseSelect");
  const hint = $("phaseHint");
  if (!sel) return;

  const phases = (STATE.event?.phases || []);
  if (!phases.length){
    sel.innerHTML = '<option value="">(sin fases)</option>';
    if (hint) hint.textContent = "Primero definí fases en Eventos.";
    return;
  }

  sel.innerHTML = phases.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`).join("");

  // fase activa: la actual o la primera
  if (!STATE.ui) STATE.ui = { activePhase: null };
  if (!STATE.ui.activePhase || !phases.some(p => p.id === STATE.ui.activePhase)){
    STATE.ui.activePhase = phases[0].id;
  }
  sel.value = STATE.ui.activePhase;

  if (hint) hint.textContent = `Fase activa: ${phases.find(p=>p.id===STATE.ui.activePhase)?.name || STATE.ui.activePhase}`;
}

function driverName(d){
  return `${d.lastName || ""} ${d.firstName || ""}`.trim() || d.name || d.email || d.id;
}

function renderDrivers(){
  const box = $("driversBox");
  if (!box) return;

  const drivers = (STATE.master?.drivers || []);
  const phaseId = STATE.ui?.activePhase;

  if (!drivers.length){
    box.innerHTML = '<div class="emptyBox">No hay choferes cargados.</div>';
    return;
  }
  if (!phaseId){
    box.innerHTML = '<div class="emptyBox">Seleccioná una fase.</div>';
    return;
  }

  const dp = STATE.event?.driverPhases || new Map();

  box.innerHTML = drivers.map(d=>{
    const phasesObj = dp.get(d.id) || {};
    const checked = !!phasesObj[phaseId];
    // Capacidad: per-phase override primero, sino la del master driver
    const perPhaseCap = getDriverCapacityForPhase(d.id, phaseId);
    const displayCap = perPhaseCap !== null ? perPhaseCap : (d.capacity ?? "");
    const masterCap = d.capacity ? ` (general: ${d.capacity})` : "";
    return `
      <div class="row" style="justify-content:space-between; gap:10px; padding:10px 12px; border:1px solid rgba(255,255,255,.08); border-radius:14px; flex-wrap:wrap;">
        <label class="row" style="gap:10px; flex:1; min-width:0; cursor:pointer;">
          <input type="checkbox" class="box" data-driver="${escapeHtml(d.id)}" ${checked ? "checked" : ""} />
          <div>
            <div style="font-weight:700">${escapeHtml(driverName(d))}</div>
            <div class="hint">${escapeHtml(d.email || d.localidad || "")}</div>
          </div>
        </label>
        <div class="row" style="gap:6px; align-items:center; flex-shrink:0;">
          <label style="font-size:12px; color:rgba(234,241,255,.7);">Cap. fase:</label>
          <input
            type="number"
            min="1" max="99"
            data-cap-driver="${escapeHtml(d.id)}"
            value="${escapeHtml(String(displayCap))}"
            placeholder="${escapeHtml(String(d.capacity || 4))}"
            title="Capacidad para esta fase${masterCap}"
            style="width:60px; padding:4px 6px; border-radius:8px; text-align:center;"
          />
          <span class="hint" style="font-size:11px;">${masterCap ? escapeHtml(masterCap) : ""}</span>
        </div>
      </div>
    `;
  }).join("");

  box.querySelectorAll('input[type="checkbox"][data-driver]').forEach(chk=>{
    chk.addEventListener("change", ()=>{
      const driverId = chk.dataset.driver;
      if (!driverId) return;
      const map = STATE.event.driverPhases;
      if (!map.has(driverId)) map.set(driverId, {});
      map.get(driverId)[phaseId] = chk.checked;
    });
  });
}

function setAll(val){
  const phaseId = STATE.ui?.activePhase;
  if (!phaseId) return;

  const map = STATE.event.driverPhases;
  const drivers = (STATE.master?.drivers || []);

  drivers.forEach(d=>{
    if (!map.has(d.id)) map.set(d.id, {});
    map.get(d.id)[phaseId] = !!val;
  });

  // refrescar UI
  document.querySelectorAll('input[type="checkbox"][data-driver]').forEach(chk=>{
    chk.checked = !!val;
  });
}

async function onSave(){
  const phaseId = STATE.ui?.activePhase;
  const eventId = STATE.event?.id;
  if (!eventId) return toast("Seleccioná un evento.");
  if (!phaseId) return toast("Seleccioná una fase.");

  const map = STATE.event.driverPhases;
  const drivers = (STATE.master?.drivers || []);

  for (const d of drivers){
    const phasesObj = map.get(d.id) || {};
    const isAvailable = !!phasesObj[phaseId];

    // Leer capacidad del input si existe
    const capInput = document.querySelector(`input[data-cap-driver="${d.id}"]`);
    const capVal = capInput ? Number(capInput.value) : NaN;
    const capacity = Number.isFinite(capVal) && capVal > 0 ? capVal : null;

    await saveDriverPhase(d.id, phaseId, isAvailable, capacity);
  }

  toast("Disponibilidad y capacidad guardadas");
}
