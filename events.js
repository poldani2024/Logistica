import {
  initCorePage, STATE, $, toast, escapeHtml,
  loadMasterDrivers, loadEvents, loadMasterPassengers,
  loadEventContext, saveEvent, linkDriversToEvent, linkPassengersToEvent,
  renderEventSelect
} from "./core.js";

function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function pickedIds(attr) {
  return Array.from(document.querySelectorAll(`[${attr}="1"] input[type="checkbox"]:checked`))
    .map(x => x.dataset.id);
}

function renderDrivers() {
  const q = ($("driverSearch")?.value || "").toLowerCase();
  const linked = STATE.event.driversIds;

  const list = (STATE.master.drivers || []).filter(d => {
    const hay = `${d.firstName||""} ${d.lastName||""} ${d.phone||""} ${d.email||""}`.toLowerCase();
    return !q || hay.includes(q);
  });

  $("driversList").innerHTML = `
    <table>
      <thead><tr><th></th><th>Chofer</th><th>Email</th><th>Tel</th><th>Vinculado</th></tr></thead>
      <tbody>
        ${list.map(d => {
          const is = linked.has(d.id);
          return `
            <tr data-pick-driver="1">
              <td><input type="checkbox" data-id="${escapeHtml(d.id)}"></td>
              <td><strong>${escapeHtml(d.lastName||"")} ${escapeHtml(d.firstName||"")}</strong></td>
              <td>${escapeHtml(d.email||"")}</td>
              <td>${escapeHtml(d.phone||"")}</td>
              <td>${is ? "✅" : ""}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderPassengers() {
  const q = ($("passSearch")?.value || "").toLowerCase();
  const linked = STATE.event.passengersIds;

  const list = (STATE.master.passengers || []).filter(p => {
    const hay = `${p.firstName||""} ${p.lastName||""} ${p.phone||""} ${p.address||""} ${p.localidad||""}`.toLowerCase();
    return !q || hay.includes(q);
  });

  $("passengersList").innerHTML = `
    <table>
      <thead><tr><th></th><th>Pasajero</th><th>Localidad</th><th>Tel</th><th>Vinculado</th></tr></thead>
      <tbody>
        ${list.map(p => {
          const is = linked.has(p.id);
          return `
            <tr data-pick-pass="1">
              <td><input type="checkbox" data-id="${escapeHtml(p.id)}"></td>
              <td><strong>${escapeHtml(p.lastName||"")} ${escapeHtml(p.firstName||"")}</strong></td>
              <td>${escapeHtml(p.localidad||"")}</td>
              <td>${escapeHtml(p.phone||"")}</td>
              <td>${is ? "✅" : ""}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

async function refreshAll() {
  await loadMasterDrivers();
  await loadMasterPassengers();
  await loadEventContext(STATE.event.id);

  renderDrivers();
  renderPassengers();

  const hint = $("eventHint");
  if (hint) hint.textContent = STATE.event.id ? `Evento activo: ${STATE.event.id}` : "No hay evento seleccionado";
}

(async function boot() {
  try {
    await initCorePage({ page: "events" });
    if (!STATE.auth.user) return;

    // initCorePage ya carga eventos y renderiza selector, pero si querés reforzar:
    await loadEvents();
    renderEventSelect();
    if (STATE.event.id) await loadEventContext(STATE.event.id);

    if (!STATE.auth.isAdmin) {
      toast("Esta pantalla requiere Admin (modo lectura)");
    }

    $("driverSearch")?.addEventListener("input", renderDrivers);
    $("passSearch")?.addEventListener("input", renderPassengers);

    document.addEventListener("eventChanged", async () => {
      await loadEventContext(STATE.event.id);
      await refreshAll();
    });

    $("btnSaveEvent")?.addEventListener("click", async () => {
      try {
        if (!STATE.auth.isAdmin) throw new Error("Solo Admin");

        await saveEvent({
          id: $("ev_id").value,
          name: $("ev_name").value,
          dateStart: $("ev_start").value,
          dateEnd: $("ev_end").value,
          address: $("ev_address").value,
          localidad: $("ev_localidad").value
        });

        toast("Evento guardado");
        await loadEvents();
        renderEventSelect();
      } catch (e) { console.error(e); toast(e.message || String(e)); }
    });

    $("btnLoadFromSelected")?.addEventListener("click", async () => {
      try {
        const id = STATE.event.id;
        if (!id) throw new Error("No hay evento seleccionado");
        const ev = (STATE.events || []).find(x => x.id === id);
        if (!ev) throw new Error("No encontré el evento en memoria. Recargá eventos.");

        $("ev_id").value = ev.id || "";
        $("ev_name").value = ev.name || "";
        $("ev_start").value = toLocalInputValue(ev.dateStart);
        $("ev_end").value = toLocalInputValue(ev.dateEnd);
        $("ev_address").value = ev.address || "";
        $("ev_localidad").value = ev.localidad || "";
        toast("Cargado desde el evento seleccionado");
      } catch (e) { console.error(e); toast(e.message || String(e)); }
    });

    $("btnLinkAllDrivers")?.addEventListener("click", async () => {
      try {
        if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
        await linkDriversToEvent(pickedIds("data-pick-driver"), true);
        await loadEventContext(STATE.event.id);
        renderDrivers();
        toast("Choferes vinculados");
      } catch (e) { console.error(e); toast(e.message || String(e)); }
    });

    $("btnUnlinkAllDrivers")?.addEventListener("click", async () => {
      try {
        if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
        await linkDriversToEvent(pickedIds("data-pick-driver"), false);
        await loadEventContext(STATE.event.id);
        renderDrivers();
        toast("Choferes desvinculados");
      } catch (e) { console.error(e); toast(e.message || String(e)); }
    });

    $("btnLinkAllPassengers")?.addEventListener("click", async () => {
      try {
        if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
        await linkPassengersToEvent(pickedIds("data-pick-pass"), true);
        await loadEventContext(STATE.event.id);
        renderPassengers();
        toast("Pasajeros vinculados");
      } catch (e) { console.error(e); toast(e.message || String(e)); }
    });

    $("btnUnlinkAllPassengers")?.addEventListener("click", async () => {
      try {
        if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
        await linkPassengersToEvent(pickedIds("data-pick-pass"), false);
        await loadEventContext(STATE.event.id);
        renderPassengers();
        toast("Pasajeros desvinculados");
      } catch (e) { console.error(e); toast(e.message || String(e)); }
    });

    await refreshAll();
  } catch (e) {
    console.error("INIT ERROR:", e);
    toast(e.message || String(e));
  }
})();
