import { initCorePage, STATE, can, loadEventContext, escapeHtml } from "./core.js";

const PREF_KEYS = {
  theme: "uiThemeMode",
  fontScale: "uiFontScale"
};

function preferenceKey(baseKey){
  const uid = STATE.auth?.user?.uid || "anon";
  return `${baseKey}:${uid}`;
}

function applyTheme(theme){
  document.body.classList.toggle("theme-light", theme === "light");
}

function applyFontScale(scale){
  const valid = Number(scale);
  const finalScale = Number.isFinite(valid) && valid > 0 ? valid : 1;
  document.documentElement.style.setProperty("--font-scale", String(finalScale));
}

function setupAppearanceControls(){
  const themeDark = document.getElementById("themeModeDark");
  const themeLight = document.getElementById("themeModeLight");
  const fontScaleSelect = document.getElementById("fontScaleSelect");
  if (!themeDark || !themeLight || !fontScaleSelect) return;

  const savedTheme = localStorage.getItem(preferenceKey(PREF_KEYS.theme)) || "dark";
  const savedFontScale = localStorage.getItem(preferenceKey(PREF_KEYS.fontScale)) || "1";

  const selectedTheme = savedTheme === "light" ? "light" : "dark";
  themeDark.checked = selectedTheme === "dark";
  themeLight.checked = selectedTheme === "light";
  fontScaleSelect.value = ["0.9", "1", "1.1", "1.2"].includes(savedFontScale) ? savedFontScale : "1";

  applyTheme(selectedTheme);
  applyFontScale(fontScaleSelect.value);

  [themeDark, themeLight].forEach(input => input.addEventListener("change", () => {
    if (!input.checked) return;
    const value = input.value === "light" ? "light" : "dark";
    localStorage.setItem(preferenceKey(PREF_KEYS.theme), value);
    applyTheme(value);
  }));

  fontScaleSelect.addEventListener("change", () => {
    const value = ["0.9", "1", "1.1", "1.2"].includes(fontScaleSelect.value) ? fontScaleSelect.value : "1";
    localStorage.setItem(preferenceKey(PREF_KEYS.fontScale), value);
    applyFontScale(value);
  });
}

function applyPermissions(){
  document.querySelectorAll("[data-perm]").forEach(el => {
    const key = el.dataset.perm;
    el.style.display = can(key) ? "" : "none";
  });

  if (STATE.auth?.isActive === false && !STATE.auth?.isAdmin){
    document.querySelectorAll("main, .container, .nav, .modules, .grid, .cards").forEach(el=>{
      if (el) el.style.display = "none";
    });
    const msg = document.getElementById("homeStatus") || document.body;
    if (msg) {
      msg.innerHTML = "<div class='card'><b>Usuario inactivo</b><div class='muted'>Contactá a un administrador.</div></div>";
    }
  }
}

function normalizeStatus(s){
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function eventPassengerSet(){
  return STATE.event?.passengersIds || new Set();
}

function phaseAssignedPassengers(phaseId){
  const set = new Set();
  const assignments = STATE.event?.assignments || new Map();
  const passengersInEvent = eventPassengerSet();

  assignments.forEach(a => {
    const phases = (a?.phases && typeof a.phases === "object") ? a.phases : {};
    let ids = Array.isArray(phases[phaseId]) ? phases[phaseId] : [];
    if ((!ids || !ids.length) && phaseId === "ida" && Array.isArray(a?.passengerIds)) {
      ids = a.passengerIds;
    }
    ids.forEach(id => {
      if (id && passengersInEvent.has(id)) set.add(id);
    });
  });

  return set;
}

function phaseAssignedDrivers(phaseId){
  let count = 0;
  const assignments = STATE.event?.assignments || new Map();
  const passengersInEvent = eventPassengerSet();

  assignments.forEach(a => {
    const phases = (a?.phases && typeof a.phases === "object") ? a.phases : {};
    let ids = Array.isArray(phases[phaseId]) ? phases[phaseId] : [];
    if ((!ids || !ids.length) && phaseId === "ida" && Array.isArray(a?.passengerIds)) {
      ids = a.passengerIds;
    }
    const validIds = (ids || []).filter(id => id && passengersInEvent.has(id));
    if (validIds.length > 0) count++;
  });

  return count;
}

function trackingForPhase(passengerId, phaseId){
  const meta = STATE.event?.passengersMeta?.get(passengerId) || {};
  const byPhase = (meta.trackingByPhase && typeof meta.trackingByPhase === "object") ? meta.trackingByPhase : {};
  const phaseRec = byPhase[phaseId] || {};
  return phaseRec.status || meta.trackingStatus || meta.status || "Pendiente";
}

function renderDashboard(){
  const el = document.getElementById("homeStatus");
  if (!el) return;

  const eventId = STATE.event?.id || "";
  const ev = (STATE.events || []).find(e => e.id === eventId);
  const title = ev?.name || ev?.title || (eventId ? "Evento sin nombre" : "Sin evento");

  const phases = (STATE.event?.phases || []).length ? STATE.event.phases : [{ id: "ida", name: "Ida" }];
  const passengers = Array.from(STATE.event?.passengersIds || []);

  const phaseCards = phases.map(phase => {
    const pid = phase.id;
    const assignedSet = phaseAssignedPassengers(pid);
    const assignedDrivers = phaseAssignedDrivers(pid);

    const total = passengers.length;
    let inTransit = 0;
    let atDestination = 0;

    passengers.forEach(passengerId => {
      const s = normalizeStatus(trackingForPhase(passengerId, pid));
      if (s.includes("transito")) inTransit++;
      if (s.includes("destino")) atDestination++;
    });

    const progress = total > 0 ? Math.round((atDestination / total) * 100) : 0;

    return `
      <div class="card dashboardCard">
        <div class="rowBetween" style="margin-bottom:8px;">
          <div class="cardTitle" style="margin:0; font-size:16px;">${escapeHtml(phase.name || phase.id)}</div>
          <span class="pill" style="padding:4px 10px;">Avance: <b>${progress}%</b></span>
        </div>

        <div class="dashboardKpis">
          <div class="dashboardKpi"><span class="muted">Choferes con asignación</span><b>${assignedDrivers}</b></div>
          <div class="dashboardKpi"><span class="muted">Pasajeros asignados</span><b>${assignedSet.size}</b></div>
          <div class="dashboardKpi"><span class="muted">En tránsito</span><b>${inTransit}</b></div>
          <div class="dashboardKpi"><span class="muted">En destino</span><b>${atDestination}</b></div>
        </div>

        <div class="progressWrap" style="margin-top:10px;">
          <div class="progressBar" style="width:${progress}%;"></div>
        </div>
      </div>
    `;
  }).join("");

  const totalPassengers = passengers.length;
  const totalAssigned = new Set(phases.flatMap(p => Array.from(phaseAssignedPassengers(p.id)))).size;

  el.innerHTML = `
    <div class="card" style="margin-bottom:14px;">
      <div class="row" style="flex-wrap:wrap; gap:10px;">
        <span class="pill">Evento activo: <b>${escapeHtml(title)}</b></span>
        <span class="pill">Pasajeros evento: <b>${totalPassengers}</b></span>
        <span class="pill">Pasajeros asignados (global): <b>${totalAssigned}</b></span>
      </div>
      <div class="small muted" style="margin-top:10px;">Dashboard por fase basado en asignaciones y tracking en tiempo real.</div>
    </div>

    <div class="dashboardGrid">${phaseCards}</div>
  `;
}

(async function(){
  await initCorePage({ page: "home" });
  if (!STATE.auth?.user) return;

  applyPermissions();
  setupAppearanceControls();
  renderDashboard();

  document.addEventListener("eventChanged", async (ev) => {
    const eventId = ev?.detail?.eventId;
    if (!eventId) return;
    await loadEventContext(eventId);
    renderDashboard();
  });
})();
