import {
  initCorePage, STATE, $, toast, escapeHtml,
  loadMasterDrivers, loadMasterPassengers,
  loadEventContext, driversInEvent, passengersInEvent,
  assignmentForDriver, assignPassengerToDriver, unassignPassenger
} from "./core.js";

function fullName(x){ return `${x.lastName||""} ${x.firstName||""}`.trim(); }

function render() {
  const hint = $("eventHint");
  if (hint) hint.textContent = STATE.event.id ? `Evento activo: ${STATE.event.id}` : "No hay evento seleccionado";

  const ds = driversInEvent();
  const ps = passengersInEvent();

  $("driversBox").innerHTML = `
    <table>
      <thead><tr><th>Chofer</th><th>Cap</th><th>Asignados</th></tr></thead>
      <tbody>
        ${ds.map(d => {
          const a = assignmentForDriver(d.id);
          const used = a.passengerIds.length;
          const cap = Number(d.capacity ?? 4);
          return `<tr>
            <td><strong>${escapeHtml(fullName(d))}</strong></td>
            <td>${cap}</td>
            <td>${used}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;

  $("passengersBox").innerHTML = `
    <table>
      <thead><tr><th>Pasajero</th><th>Estado</th><th>Chofer</th></tr></thead>
      <tbody>
        ${ps.map(p => {
          const meta = p._event || {};
          const status = meta.status || "Pendiente";
          const driverId = meta.assignedDriverId || "";
          const d = ds.find(x => x.id === driverId);
          const dName = d ? fullName(d) : "";
          return `<tr>
            <td><strong>${escapeHtml(fullName(p))}</strong><div class="muted">${escapeHtml(p.localidad||"")} · ${escapeHtml(p.address||"")}</div></td>
            <td>${escapeHtml(status)}</td>
            <td>${escapeHtml(dName)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;

  // selects
  $("selDriver").innerHTML = ds.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(fullName(d))}</option>`).join("") || `<option value="">(sin choferes vinculados)</option>`;
  $("selPassenger").innerHTML = ps.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(fullName(p))}</option>`).join("") || `<option value="">(sin pasajeros vinculados)</option>`;
}

async function refreshAll() {
  await loadMasterDrivers();
  await loadMasterPassengers();
  await loadEventContext(STATE.event.id);
  render();
}

(async function init(){
  await initCorePage({ page: "assignments" });

  document.addEventListener("eventChanged", refreshAll);

  $("btnAssign").addEventListener("click", async () => {
    try {
      if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
      const driverId = $("selDriver").value;
      const passengerId = $("selPassenger").value;
      if (!driverId || !passengerId) throw new Error("Falta chofer o pasajero");
      await assignPassengerToDriver({ passengerId, driverId });
      toast("Asignado");
      await refreshAll();
    } catch (e) { console.error(e); toast(e.message || String(e)); }
  });

  $("btnUnassign").addEventListener("click", async () => {
    try {
      if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
      const passengerId = $("selPassenger").value;
      if (!passengerId) throw new Error("Falta pasajero");
      const meta = STATE.event.passengersMeta.get(passengerId) || {};
      const driverId = meta.assignedDriverId || "";
      if (!driverId) throw new Error("Ese pasajero no tiene chofer asignado");
      await unassignPassenger({ passengerId, driverId });
      toast("Quitado");
      await refreshAll();
    } catch (e) { console.error(e); toast(e.message || String(e)); }
  });

  await refreshAll();
})();

