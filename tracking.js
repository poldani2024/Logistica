import {
  initCorePage, STATE, $, toast, escapeHtml,
  loadMasterDrivers, loadMasterPassengers,
  loadEventContext, passengersInEvent,
  driversForPhase, getActivePhaseId,
  assignmentForDriver, updateTrackingAsDriver
} from "./core.js";

function fullName(x){ return `${x.lastName||""} ${x.firstName||""}`.trim(); }

function getPassengerIdsFor(driverId, phaseId){
  const a = assignmentForDriver(driverId) || {};
  const phases = (a.phases && typeof a.phases === "object") ? a.phases : {};

  if (phaseId && Array.isArray(phases[phaseId])) return phases[phaseId];

  // compat vieja: tratar passengerIds como "ida"
  if ((!phaseId || phaseId === "ida") && Array.isArray(a.passengerIds)) return a.passengerIds;

  return [];
}

function getTrackingForPhase(p, phaseId){
  const ep = p?._event || {};
  const by = ep.trackingByPhase || {};
  const rec = (phaseId && by[phaseId]) ? by[phaseId] : null;

  return {
    status: rec?.status || ep.trackingStatus || "Pendiente",
    note: rec?.note || ep.trackingNote || ""
  };
}

function render() {
  const hint = $("eventHint");
  if (hint) hint.textContent = STATE.event.id ? `Evento activo: ${STATE.event.title || STATE.event.id}` : "No hay evento seleccionado";

  const isAdmin = !!STATE.auth.isAdmin;
  const me = STATE.auth.driver;

  if (!me && !isAdmin) {
    $("trackingBox").innerHTML = `<p class="muted">No estás registrado como chofer y no sos Admin.</p>`;
    return;
  }

  if (!STATE.ui) STATE.ui = {};
  if (!STATE.ui.activePhase) STATE.ui.activePhase = (STATE.event.phases?.[0]?.id || "ida");
  if (!STATE.ui.trackingStatusFilter) STATE.ui.trackingStatusFilter = "Todos";

  const phases = STATE.event.phases || [];
  const activePhaseId = getActivePhaseId() || STATE.ui.activePhase;

  // Choferes disponibles en la fase
  const dsPhase = activePhaseId ? (driversForPhase(activePhaseId) || []) : [];

  // Chofer seleccionado
  let selectedDriverId = isAdmin ? (STATE.ui.activeDriverId || "__ALL__") : (me?.id || "");
  if (isAdmin) {
    // si no existe en la fase y no es ALL, caer a ALL
    const ok = selectedDriverId === "__ALL__" || dsPhase.some(d => d.id === selectedDriverId);
    if (!ok) selectedDriverId = "__ALL__";
    STATE.ui.activeDriverId = selectedDriverId;
  } else {
    STATE.ui.activeDriverId = selectedDriverId;
  }

  const statusOptions = ["Todos","Pendiente","En tránsito","En destino","Ausente"];

  $("trackingBox").innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between; gap:14px; flex-wrap:wrap; align-items:center;">
        <div class="row" style="gap:10px; align-items:center;">
          <label class="muted">Fase:</label>
          <select id="selPhase" class="select">
            ${phases.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`).join("")}
          </select>
        </div>

        ${isAdmin ? `
          <div class="row" style="gap:10px; align-items:center;">
            <label class="muted">Chofer:</label>
            <select id="selDriver" class="select">
              ${[`<option value="__ALL__">Todos</option>`]
                .concat(dsPhase.map(d=> `<option value="${escapeHtml(d.id)}">${escapeHtml(fullName(d))}</option>`))
                .join("")}
            </select>
          </div>
        ` : `
          <div class="row" style="gap:10px; align-items:center;">
            <span class="muted">Chofer:</span>
            <strong>${escapeHtml(fullName(me))}</strong>
          </div>
        `}

        <div class="row" style="gap:10px; align-items:center;">
          <label class="muted">Estado:</label>
          <select id="selStatus" class="select">
            ${statusOptions.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
          </select>
        </div>
      </div>

      <div style="height:12px"></div>
      <div id="trackingList"></div>
    </div>
  `;

  const selPhase = $("selPhase");
  const selDriver = $("selDriver");
  const selStatus = $("selStatus");

  if (selPhase) selPhase.value = activePhaseId;
  if (selStatus) selStatus.value = STATE.ui.trackingStatusFilter || "Todos";
  if (isAdmin && selDriver) selDriver.value = selectedDriverId;

  const renderList = () => {
    const phaseIdNow = ($("selPhase")?.value || activePhaseId);
    const driverId = isAdmin ? ($("selDriver")?.value || "__ALL__") : me.id;
    const statusFilter = ($("selStatus")?.value || "Todos");

    STATE.ui.activePhase = phaseIdNow;
    STATE.ui.activeDriverId = driverId;
    STATE.ui.trackingStatusFilter = statusFilter;

    if (!phaseIdNow) {
      $("trackingList").innerHTML = `<p class="muted">Seleccioná una fase.</p>`;
      return;
    }

    const wanted = (statusFilter || "Todos").toLowerCase();
    const ps = passengersInEvent();

    let pairs = [];
    if (driverId === "__ALL__") {
      dsPhase.forEach(drv => {
        const ids = new Set(getPassengerIdsFor(drv.id, phaseIdNow));
        ps.forEach(p => { if (ids.has(p.id)) pairs.push({ drv, p }); });
      });
    } else {
      const ids = new Set(getPassengerIdsFor(driverId, phaseIdNow));
      const drv = dsPhase.find(d=>d.id===driverId) || null;
      pairs = ps.filter(p => ids.has(p.id)).map(p => ({ drv, p }));
    }

    pairs = pairs.filter(({ p }) => {
      const t = getTrackingForPhase(p, phaseIdNow);
      if (wanted === "todos") return true;
      return (t.status || "Pendiente").toLowerCase() === wanted;
    });

    const showDriverCol = (driverId === "__ALL__");

    $("trackingList").innerHTML = pairs.length ? `
      <table>
        <thead>
          <tr>
            ${showDriverCol ? "<th>Chofer</th>" : ""}
            <th>Pasajero</th>
            <th>Estado</th>
            <th>Obs</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${pairs.map(({ drv, p }) => {
            const t = getTrackingForPhase(p, phaseIdNow);
            return `
              <tr>
                ${showDriverCol ? `<td><strong>${escapeHtml(drv ? fullName(drv) : "")}</strong></td>` : ""}
                <td>
                  <strong>${escapeHtml(fullName(p))}</strong>
                  <div class="muted">${escapeHtml(p.address||"")} ${p.localidad ? "· "+escapeHtml(p.localidad) : ""}</div>
                </td>
                <td>
                  <select data-st="1" data-id="${escapeHtml(p.id)}" class="select">
                    ${["Pendiente","En tránsito","En destino","Ausente"].map(x => `<option ${x===t.status?"selected":""}>${escapeHtml(x)}</option>`).join("")}
                  </select>
                </td>
                <td><input data-note="1" data-id="${escapeHtml(p.id)}" value="${escapeHtml(t.note)}" placeholder="Observación…" class="input"></td>
                <td><button class="btnPrimary" data-save="1" data-id="${escapeHtml(p.id)}" data-driver="${escapeHtml(drv?.id || "")}">Guardar</button></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    ` : `<p class="muted">No hay pasajeros para mostrar con estos filtros.</p>`;

    document.querySelectorAll("button[data-save='1']").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const pid = btn.dataset.id;
          const stEl = document.querySelector(`select[data-st='1'][data-id='${pid}']`);
          const noteEl = document.querySelector(`input[data-note='1'][data-id='${pid}']`);

          const rowDriverId = btn.dataset.driver || "";
          const targetDriverId = (isAdmin ? (driverId === "__ALL__" ? rowDriverId : driverId) : me.id);

          await updateTrackingAsDriver({
            passengerId: pid,
            trackingStatus: stEl.value,
            trackingNote: noteEl.value,
            phaseId: phaseIdNow,
            driverId: targetDriverId
          });

          toast("Tracking actualizado");
        } catch (e) { console.error(e); toast(e.message || String(e)); }
      });
    });
  };

  // binds
  selPhase?.addEventListener("change", () => {
    // cambiar fase implica recalcular dsPhase; re-render completo
    STATE.ui.activePhase = selPhase.value;
    render();
  });

  selDriver?.addEventListener("change", renderList);
  selStatus?.addEventListener("change", renderList);

  // primera carga
  renderList();
}

async function refreshAll(){
  if (!STATE.event?.id) { render(); return; }
  await loadMasterDrivers();
  await loadMasterPassengers();
  await loadEventContext(STATE.event.id);
  render();
}

(async function init(){
  await initCorePage({ page: "tracking" });
  document.addEventListener("eventChanged", refreshAll);
  await refreshAll();
})();
