// assignments.js
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

(async function init() {
  await initCorePage({ page: "assignments" }); // ✅ esto carga eventos + header

  // Algunas versiones no traen STATE.ui
  if (!STATE.ui) STATE.ui = { activePhase: null };

  // Cargar master passengers (initCorePage carga drivers, pero no passengers)
  await loadMasterPassengers();

  // Cargar contexto del evento activo (phases, eventDrivers, eventPassengers, assignments)
  if (STATE.event?.id) {
    await loadEventContext(STATE.event.id);
  }

  wireUI();
  renderAll();

  // Si cambia el evento desde el header, recargar todo
  document.addEventListener("eventChanged", async (ev) => {
    const id = ev?.detail?.eventId;
    if (!id) return;
    await loadEventContext(id);
    renderAll();
  });
})().catch((e) => {
  console.error("INIT ERROR assignments", e);
  toast(e?.message || String(e));
});

function wireUI() {
  $("btnRefresh")?.addEventListener("click", async () => {
    if (!STATE.event?.id) return toast("Seleccioná un evento arriba.");
    await loadEventContext(STATE.event.id);
    renderAll();
    toast("Actualizado");
  });

  // filtros pasajeros
  $("passFilter")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-filter]");
    if (!btn) return;
    document.querySelectorAll("#passFilter button[data-filter]").forEach(b => b.classList.remove("primary"));
    btn.classList.add("primary");
    STATE.ui.passFilter = btn.dataset.filter; // "pending" | "assigned" | "all"
    renderPassengers();
  });

  $("passSearch")?.addEventListener("input", () => renderPassengers());
}

function renderAll() {
  renderPhaseBar();
  renderDrivers();
  renderPassengers();
}

function renderPhaseBar() {
  const host = $("phaseBar");
  if (!host) return;

  const phases = STATE.event?.phases || [];
  if (!phases.length) {
    host.innerHTML = `<div class="hint">No hay fases. Definilas en <b>Eventos</b>.</div>`;
    return;
  }

  const current = getActivePhaseId() || phases[0].id;
  if (!STATE.ui) STATE.ui = { activePhase: null };
  STATE.ui.activePhase = current;

  host.innerHTML = phases
    .map(p => {
      const active = p.id === current;
      return `<button class="btn ${active ? "primary" : ""}" data-phase="${escapeHtml(p.id)}" type="button">${escapeHtml(p.name || p.id)}</button>`;
    })
    .join(" ");

  host.querySelectorAll("button[data-phase]").forEach(b => {
    b.addEventListener("click", () => {
      if (!STATE.ui) STATE.ui = { activePhase: null };
      STATE.ui.activePhase = b.dataset.phase;
      renderDrivers();
      renderPassengers();
    });
  });
}

function driverLabel(d) {
  return `${d.lastName || ""} ${d.firstName || ""}`.trim() || d.name || d.email || d.id;
}

function renderDrivers() {
  const host = $("driversList");
  if (!host) return;

  const phaseId = getActivePhaseId();
  if (!STATE.event?.id) {
    host.innerHTML = `<div class="emptyBox">Seleccioná un evento arriba.</div>`;
    return;
  }
  if (!phaseId) {
    host.innerHTML = `<div class="emptyBox">No hay fase activa.</div>`;
    return;
  }

  const drivers = driversForPhase(phaseId) || [];
  if (!drivers.length) {
    host.innerHTML = `<div class="emptyBox">No hay choferes disponibles para esta fase.</div>`;
    return;
  }

  host.innerHTML = drivers
    .map(d => `
      <div class="row" style="justify-content:space-between; padding:10px 12px; border:1px solid rgba(255,255,255,.08); border-radius:14px;">
        <div>
          <div style="font-weight:700">${escapeHtml(driverLabel(d))}</div>
          <div class="hint">${escapeHtml(d.email || "")}</div>
        </div>
        <button class="btn" type="button" disabled>Ver</button>
      </div>
    `)
    .join("");
}

function passengerLabel(p) {
  return `${p.lastName || ""} ${p.firstName || ""}`.trim() || p.name || p.email || p.id;
}

function renderPassengers() {
  const host = $("passengersList");
  if (!host) return;

  if (!STATE.event?.id) {
    host.innerHTML = `<div class="emptyBox">Seleccioná un evento arriba.</div>`;
    return;
  }

  const phaseId = getActivePhaseId();
  const q = ($("passSearch")?.value || "").trim().toLowerCase();
  const filter = STATE.ui?.passFilter || "pending";

  // pasajeros vinculados al evento
  const ids = Array.from(STATE.event?.passengersIds || []);
  const master = STATE.master?.passengers || [];
  const byId = new Map(master.map(p => [p.id, p]));

  // asignaciones actuales (driverId -> passengerIds)
  const asg = STATE.event?.assignments || new Map();
  const assignedSet = new Set();
  for (const v of asg.values()) {
    (v.passengerIds || []).forEach(pid => assignedSet.add(pid));
  }

  let list = ids.map(id => byId.get(id) || { id });

  if (q) {
    list = list.filter(p => passengerLabel(p).toLowerCase().includes(q));
  }

  if (filter === "pending") list = list.filter(p => !assignedSet.has(p.id));
  if (filter === "assigned") list = list.filter(p => assignedSet.has(p.id));

  if (!list.length) {
    host.innerHTML = `<div class="emptyBox">Sin resultados.</div>`;
    return;
  }

  host.innerHTML = list
    .map(p => {
      const isAssigned = assignedSet.has(p.id);
      return `
        <div class="row" style="justify-content:space-between; padding:10px 12px; border:1px solid rgba(255,255,255,.08); border-radius:14px;">
          <div>
            <div style="font-weight:700">${escapeHtml(passengerLabel(p))}</div>
            <div class="hint">${isAssigned ? "Asignado" : "Pendiente"}${phaseId ? ` — Fase: ${escapeHtml(phaseId)}` : ""}</div>
          </div>
          <button class="btn" type="button" disabled>Ver</button>
        </div>
      `;
    })
    .join("");
}
