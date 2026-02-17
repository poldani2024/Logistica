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

  const phases = STATE.event.phases || [];
  const activePhaseId = getActivePhaseId() || STATE.ui.activePhase;

  // Choferes disponibles en la fase (si no hay fases, cae a lista vacía)
  const dsPhase = activePhaseId ? (driversForPhase(activePhaseId) || []) : [];

  // Chofer seleccionado
  let selectedDriverId = isAdmin ? (STATE.ui.activeDriverId || dsPhase[0]?.id || "") : (me?.id || "");
  if (!isAdmin) STATE.ui.activeDriverId = selectedDriverId;

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
              ${dsPhase.map(d=> `<option value="${escapeHtml(d.id)}">${escapeHtml(fullName(d))}</option>`).join("")}
            </select>
          </div>
        ` : `
          <div class="row"><span class="muted">Chofer:</span>&nbsp;<strong>${escapeHtml(fullName(me))}</strong></div>
        `}
      </div>

      <div style="height:12px"></div>
      <div id="trackingList"></div>
    </div>
  `;

  const selPhase = $("selPhase");
  if (selPhase) selPhase.value = activePhaseId;

  const selDriver = $("selDriver");
  if (isAdmin && selDriver) selDriver.value = selectedDriverId;

  const renderList = (driverId, phaseIdNow) => {
    if (!phaseIdNow) {
      $("trackingList").innerHTML = `<p class="muted">Seleccioná una fase.</p>`;
      return;
    }

    // Pasajeros del evento (con meta _event)
    const ps = passengersInEvent();

    const ids = new Set(getPassengerIdsFor(driverId, phaseIdNow));
    const list = ps.filter(p => ids.has(p.id));

    $("trackingList").innerHTML = list.length ? `
      <table>
        <thead>
          <tr>
            <th>Pasajero</th>
            <th>Estado</th>
            <th>Obs</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${list.map(p => {
            const t = getTrackingForPhase(p, phaseIdNow);
            return `
              <tr>
                <td>
                  <strong>${escapeHtml(fullName(p))}</strong>
                  <div class="muted">${escapeHtml(p.address||"")} ${p.localidad ? "· "+escapeHtml(p.localidad) : ""}</div>
                </td>
                <td>
                  <select data-st="1" data-id="${escapeHtml(p.id)}" class="select">
                    ${["Pendiente","En tránsito","En destino","Ausente"].map(x => `<option ${x===t.status?"selected":""}>${x}</option>`).join("")}
                  </select>
                </td>
                <td>
                  <input data-note="1" data-id="${escapeHtml(p.id)}" value="${escapeHtml(t.note)}" placeholder="Observación…" />
                </td>
                <td>
                  <button class="btnPrimary" data-save="1" data-id="${escapeHtml(p.id)}">Guardar</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    ` : `<p class="muted">Este chofer no tiene pasajeros asignados en esta fase.</p>`;

    document.querySelectorAll("button[data-save='1']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const pid = btn.dataset.id;
        const stEl = document.querySelector(`select[data-st='1'][data-id='${pid}']`);
        const noteEl = document.querySelector(`input[data-note='1'][data-id='${pid}']`);

        try {
          await updateTrackingAsDriver({
            passengerId: pid,
            trackingStatus: stEl?.value || "Pendiente",
            trackingNote: noteEl?.value || "",
            phaseId: phaseIdNow,
            driverId: driverId
          });

          // refrescar contexto para que se vea el tracking actualizado
          await loadEventContext(STATE.event.id);
          render();
          toast("Tracking actualizado");
        } catch (e) {
          console.error(e);
          toast(e?.message || String(e));
        }
      });
    });
  };

  const apply = () => {
    const pid = $("selPhase")?.value || activePhaseId;
    STATE.ui.activePhase = pid;

    // si cambia fase, recalcular lista de choferes disponibles (re-render completo)
    if (pid !== activePhaseId) { render(); return; }

    const did = isAdmin ? ($("selDriver")?.value || selectedDriverId) : selectedDriverId;
    STATE.ui.activeDriverId = did;
    renderList(did, pid);
  };

  selPhase?.addEventListener("change", apply);
  selDriver?.addEventListener("change", apply);

  renderList(selectedDriverId, activePhaseId);
}

async function refreshAll() {
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
