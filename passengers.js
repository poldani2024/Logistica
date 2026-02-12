import {
  initCorePage, STATE, $, toast, escapeHtml,
  loadMasterPassengers
} from "./core.js";

function fullName(p){ return `${p.lastName||""} ${p.firstName||""}`.trim(); }

function renderTable() {
  const q = ($("passSearch").value || "").toLowerCase();
  const list = (STATE.master.passengers || []).filter(p => {
    const hay = `${p.firstName||""} ${p.lastName||""} ${p.phone||""} ${p.address||""} ${p.localidad||""}`.toLowerCase();
    return !q || hay.includes(hay) || hay.includes(q);
  });

  $("passengersTable").innerHTML = `
    <table>
      <thead><tr><th>Pasajero</th><th>Localidad</th><th>Tel</th><th></th></tr></thead>
      <tbody>
        ${list.map(p => `
          <tr>
            <td><strong>${escapeHtml(fullName(p))}</strong><div class="muted">${escapeHtml(p.address||"")}</div></td>
            <td>${escapeHtml(p.localidad||"")}</td>
            <td>${escapeHtml(p.phone||"")}</td>
            <td><button class="btnSecondary" data-id="${escapeHtml(p.id)}">Ver</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  $("passengersTable").querySelectorAll("button[data-id]").forEach(b => {
    b.addEventListener("click", () => openDetail(b.dataset.id));
  });
}

function openDetail(id) {
  const p = (STATE.master.passengers || []).find(x => x.id === id) || null;
  if (!p) return;

  $("passengerDetail").innerHTML = `
    <div class="grid2">
      <div class="field"><label>Nombre</label><input id="p_firstName" value="${escapeHtml(p.firstName||"")}"></div>
      <div class="field"><label>Apellido</label><input id="p_lastName" value="${escapeHtml(p.lastName||"")}"></div>

      <div class="field"><label>Teléfono</label><input id="p_phone" value="${escapeHtml(p.phone||"")}"></div>
      <div class="field"><label>Localidad</label><input id="p_localidad" value="${escapeHtml(p.localidad||"")}"></div>

      <div class="field" style="grid-column:1/-1;"><label>Dirección</label><input id="p_address" value="${escapeHtml(p.address||"")}"></div>

      <div class="field"><label>Zona</label><input id="p_zone" value="${escapeHtml(p.zone||"")}"></div>
      <div class="field"><label>Lat</label><input id="p_lat" value="${escapeHtml(String(p.lat ?? ""))}"></div>
      <div class="field"><label>Lng</label><input id="p_lng" value="${escapeHtml(String(p.lng ?? ""))}"></div>
    </div>

    <p class="muted">Master Data: acá no se asigna chofer. Eso es por evento en “Asignaciones”.</p>
  `;
}

(async function init(){
  await initCorePage({ page: "passengers" });

  $("passSearch").addEventListener("input", renderTable);
  $("btnReloadPassengers").addEventListener("click", async () => { await loadMasterPassengers(); renderTable(); toast("Pasajeros recargados"); });

  await loadMasterPassengers();
  renderTable();
})();

