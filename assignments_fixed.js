import {
  initCorePage, STATE, $, toast, escapeHtml,
  loadMasterDrivers, loadMasterPassengers,
  loadEventContext, driversInEvent, passengersInEvent,
  assignPassengerToDriver, unassignPassenger, assignmentForDriver,
  getSelectedEventId
} from "./core.js";

function fullName(x){
  return `${x.lastName||""} ${x.firstName||""}`.trim() || "(sin nombre)";
}

function passengerLine(p){
  const loc = p.localidad ? ` · ${p.localidad}` : "";
  const addr = p.address ? ` · ${p.address}` : "";
  const phone = p.phone ? ` · ${p.phone}` : "";
  return `${loc}${addr}${phone}`;
}

let modalDriverId = null;

function isAdmin(){
  return !!STATE.auth.isAdmin;
}

function capacityOf(driver){
  const c = Number(driver?.capacity ?? 4);
  return Number.isFinite(c) && c > 0 ? c : 4;
}

function assignedCount(driverId){
  const a = assignmentForDriver(driverId);
  return (a.passengerIds || []).length;
}

function unassignedPassengers(){
  const list = passengersInEvent(); // incluye _event meta
  return list.filter(p => !(p._event?.assignedDriverId));
}

function renderBoard(){
  const board = $("driversBoard");
  if (!board) return;

  const eventId = STATE.event.id;
  if (!eventId){
    board.innerHTML = '<div class="card"><div class="subtitle">Seleccioná un evento arriba.</div></div>';
    return;
  }

  const drivers = driversInEvent();
  if (!drivers.length){
    board.innerHTML = '<div class="card"><div class="subtitle">No hay choferes vinculados a este evento. Vinculalos en Eventos.</div></div>';
    return;
  }

  const passById = new Map((passengersInEvent() || []).map(p => [p.id, p]));

  board.innerHTML = drivers.map(d => {
    const cap = capacityOf(d);
    const cnt = assignedCount(d.id);
    const full = cnt >= cap;

    const a = assignmentForDriver(d.id);
    const assigned = (a.passengerIds || [])
      .map(pid => passById.get(pid))
      .filter(Boolean);

    const pill = `<span class="pillSmall">${escapeHtml(String(cnt))} / ${escapeHtml(String(cap))} cupo</span>`;
    const addBtn = isAdmin()
      ? `<button class="btn primary" data-add="${escapeHtml(d.id)}" ${full ? "disabled" : ""}>+ Agregar pasajero</button>`
      : `<span class="pillSmall">Solo Admin asigna</span>`;

    const listHtml = assigned.length ? assigned.map(p => {
      const meta = p._event || {};
      const status = meta.trackingStatus || meta.status || "Pendiente";
      return `
        <div class="passRow">
          <div class="passMeta">
            <div class="passName">${escapeHtml(fullName(p))}</div>
            <div class="passSub">${escapeHtml(status)}${escapeHtml(passengerLine(p))}</div>
          </div>
          ${isAdmin() ? `<button class="btnDanger" data-unassign="${escapeHtml(d.id)}" data-p="${escapeHtml(p.id)}">Quitar</button>` : ``}
        </div>
      `;
    }).join("") : `<div class="emptyBox">Sin pasajeros asignados todavía.</div>`;

    return `
      <section class="card">
        <div class="driverHead">
          <div>
            <div class="cardTitle">${escapeHtml(fullName(d))}</div>
            <div class="subtitle">${escapeHtml(d.email||"")}${d.phone ? " · " + escapeHtml(d.phone) : ""}</div>
          </div>
          <div class="row" style="align-items:center;">
            ${pill}
            ${addBtn}
          </div>
        </div>

        <div style="margin-top:12px;">
          ${listHtml}
        </div>
      </section>
    `;
  }).join("");

  board.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => openModal(btn.getAttribute("data-add")));
  });

  board.querySelectorAll("[data-unassign]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const driverId = btn.getAttribute("data-unassign");
      const passengerId = btn.getAttribute("data-p");
      await doUnassign({ driverId, passengerId });
    });
  });
}

function openModal(driverId){
  modalDriverId = driverId;
  const driver = (STATE.master.drivers || []).find(x => x.id === driverId);
  $("modalTitle").textContent = `Agregar pasajero a ${driver ? fullName(driver) : "chofer"}`;
  $("modalSub").textContent = "Elegí un pasajero pendiente (no asignado).";
  $("modalSearch").value = "";
  $("assignModal").classList.add("show");
  renderModalList();
  setTimeout(() => $("modalSearch")?.focus(), 50);
}

function closeModal(){
  $("assignModal").classList.remove("show");
  modalDriverId = null;
}

function renderModalList(){
  const wrap = $("modalList");
  if (!wrap) return;

  const q = ($("modalSearch")?.value || "").trim().toLowerCase();

  const list = unassignedPassengers().filter(p => {
    if (!q) return true;
    const hay = `${p.firstName||""} ${p.lastName||""} ${p.phone||""} ${p.address||""} ${p.localidad||""}`.toLowerCase();
    return hay.includes(q);
  });

  if (!list.length){
    wrap.innerHTML = `<div class="emptyBox">No hay pasajeros pendientes para asignar.</div>`;
    return;
  }

  wrap.innerHTML = list.map(p => {
    const meta = p._event || {};
    const status = meta.trackingStatus || meta.status || "Pendiente";
    return `
      <div class="passRow">
        <div class="passMeta">
          <div class="passName">${escapeHtml(fullName(p))}</div>
          <div class="passSub">${escapeHtml(status)}${escapeHtml(passengerLine(p))}</div>
        </div>
        <button class="btn primary" data-assign="${escapeHtml(p.id)}">Asignar</button>
      </div>
    `;
  }).join("");

  wrap.querySelectorAll("[data-assign]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const passengerId = btn.getAttribute("data-assign");
      await doAssign({ driverId: modalDriverId, passengerId });
    });
  });
}

async function doAssign({ driverId, passengerId }){
  try{
    if (!isAdmin()) throw new Error("Solo Admin");
    if (!STATE.event.id) throw new Error("No hay evento seleccionado");
    if (!driverId || !passengerId) return;

    const driver = (STATE.master.drivers || []).find(x => x.id === driverId);
    const cap = capacityOf(driver || {});
    const cnt = assignedCount(driverId);
    if (cnt >= cap) throw new Error("Cupo completo para ese chofer");

    await assignPassengerToDriver({ driverId, passengerId });

    await loadEventContext(getSelectedEventId());
    renderBoard();
    renderModalList();
    toast("Asignado");
  }catch(e){
    console.error(e);
    toast(e.message || String(e));
  }
}

async function doUnassign({ driverId, passengerId }){
  try{
    if (!isAdmin()) throw new Error("Solo Admin");
    const ok = confirm("¿Quitar este pasajero del chofer?");
    if (!ok) return;

    await unassignPassenger({ driverId, passengerId });

    await loadEventContext(getSelectedEventId());
    renderBoard();
    toast("Quitado");
  }catch(e){
    console.error(e);
    toast(e.message || String(e));
  }
}

function wireModal(){
  $("btnCloseModal")?.addEventListener("click", closeModal);
  $("assignModal")?.addEventListener("click", (e) => {
    if (e.target?.id === "assignModal") closeModal();
  });
  $("modalSearch")?.addEventListener("input", renderModalList);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

(async function init(){
  try{
    await initCorePage({ page: "assignments" });
    if (!STATE.auth.user) return;

    wireModal();

    $("btnReloadContext")?.addEventListener("click", async () => {
      await loadMasterDrivers();
      await loadMasterPassengers();
      await loadEventContext(getSelectedEventId());
      renderBoard();
      toast("Recargado");
    });

    document.addEventListener("eventChanged", async () => {
      await loadEventContext(getSelectedEventId());
      renderBoard();
      closeModal();
    });

    await loadMasterDrivers();
    await loadMasterPassengers();
    await loadEventContext(getSelectedEventId());
    renderBoard();
  }catch(e){
    console.error("INIT ERROR:", e);
    toast(e.message || String(e));
  }
})();
