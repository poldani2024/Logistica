import {
  initCorePage, STATE, $, toast, escapeHtml,
  loadMasterDrivers, loadMasterPassengers,
  loadEventContext, driversInEvent, passengersInEvent,
  assignmentForDriver, updateTrackingAsDriver
} from "./core.js";

function fullName(x){ return `${x.lastName||""} ${x.firstName||""}`.trim(); }

function render() {
  const hint = $("eventHint");
  if (hint) hint.textContent = STATE.event.id ? `Evento activo: ${STATE.event.id}` : "No hay evento seleccionado";

  const driver = STATE.auth.driver;
  const isAdmin = STATE.auth.isAdmin;

  if (!driver && !isAdmin) {
    $("trackingBox").innerHTML = `<p class="muted">No estás registrado como chofer y no sos Admin.</p>`;
    return;
  }

  const ds = driversInEvent();
  const ps = passengersInEvent();

  // Admin: puede elegir un chofer
  let selectedDriverId = driver?.id || "";
  if (isAdmin) {
    selectedDriverId = selectedDriverId || (ds[0]?.id || "");
  }

  const selHtml = isAdmin ? `
    <div class="row">
      <label class="muted">Chofer:</label>
      <select id="selDriver" class="select">
        ${ds.map(d=> `<option value="${escapeHtml(d.id)}">${escapeHtml(fullName(d))}</option>`).join("")}
      </select>
    </div>
  ` : "";

  $("trackingBox").innerHTML = `
    ${selHtml}
    <div id="trackingList"></div>
  `;

  const renderList = (driverId) => {
    const a = assignmentForDriver(driverId);
    const ids = new Set(a.passengerIds || []);
    const list = ps.filter(p => ids.has(p.id));

    $("trackingList").innerHTML = list.length ? `
      <table>
        <thead><tr><th>Pasajero</th><th>Estado</th><th>Obs</th><th></th></tr></thead>
        <tbody>
          ${list.map(p => {
            const meta = p._event || {};
            const st = meta.trackingStatus || "Pendiente";
            const note = meta.trackingNote || "";
            return `
              <tr>
                <td><strong>${escapeHtml(fullName(p))}</strong><div class="muted">${escapeHtml(p.address||"")} · ${escapeHtml(p.localidad||"")}</div></td>
                <td>
                  <select data-st="1" data-id="${escapeHtml(p.id)}">
                    ${["Pendiente","En tránsito","En destino","Ausente"].map(x => `<option ${x===st?"selected":""}>${x}</option>`).join("")}
                  </select>
                </td>
                <td><input data-note="1" data-id="${escapeHtml(p.id)}" value="${escapeHtml(note)}" placeholder="Observación…"></td>
                <td><button class="btnPrimary" data-save="1" data-id="${escapeHtml(p.id)}">Guardar</button></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    ` : `<p class="muted">Este chofer no tiene pasajeros asignados en este evento.</p>`;

    // bind save
    document.querySelectorAll("button[data-save='1']").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          const pid = btn.dataset.id;
          const stEl = document.querySelector(`select[data-st='1'][data-id='${pid}']`);
          const noteEl = document.querySelector(`input[data-note='1'][data-id='${pid}']`);
          await updateTrackingAsDriver({
            passengerId: pid,
            trackingStatus: stEl.value,
            trackingNote: noteEl.value
          });
          toast("Tracking actualizado");
        } catch (e) { console.error(e); toast(e.message || String(e)); }
      });
    });
  };

  if (isAdmin) {
    const sel = $("selDriver");
    sel.value = selectedDriverId;
    sel.addEventListener("change", () => renderList(sel.value));
    renderList(sel.value);
  } else {
    renderList(driver.id);
  }
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

