import {
  initCorePage, STATE, $, toast, escapeHtml,
  loadMasterDrivers, loadMasterPassengers,
  loadEventContext, driversInEvent, passengersInEvent,
  phasesForEvent, getActivePhaseId, setActivePhaseId,
  assignedDriverIdForPassengerPhase, assignmentForDriverPhase,
  assignPassengerToDriverPhase, unassignPassengerPhase,
  copyAssignmentsPhase, saveEvent
} from "./core.js";

let activeDriverId = "";
let passFilter = "pending"; // pending | assigned | all

function fullName(x){
  return `${x.lastName||""} ${x.firstName||""}`.trim() || "(sin nombre)";
}

function driverNameById(id){
  const d = (STATE.master.drivers||[]).find(x => x.id === id);
  return d ? fullName(d) : id;
}

function phaseBarRender(){
  const bar = $("phaseBar");
  if (!bar) return;

  const phases = phasesForEvent();
  const active = getActivePhaseId();

  bar.innerHTML = phases.map(p => `
    <div class="chip ${p.id === active ? "active" : ""}" data-phase="${escapeHtml(p.id)}">
      ${escapeHtml(p.name || p.id)}
    </div>
  `).join("");

  bar.querySelectorAll("[data-phase]").forEach(el => {
    el.addEventListener("click", async () => {
      const pid = el.dataset.phase;
      setActivePhaseId(pid);
      await refreshAll();
      toast(`Fase: ${phases.find(x=>x.id===pid)?.name || pid}`);
    });
  });
}

function driversRender(){
  const wrap = $("driversList");
  if (!wrap) return;

  const phaseId = getActivePhaseId();
  const drivers = driversInEvent();

  if (!drivers.length){
    wrap.innerHTML = `<div class="emptyBox">No hay choferes vinculados al evento.</div>`;
    return;
  }

  wrap.innerHTML = drivers.map(d => {
    const a = assignmentForDriverPhase(d.id, phaseId);
    const used = (a.passengerIds || []).length;
    const cap = Number(d.capacity ?? 0);
    const capTxt = cap ? `${used}/${cap}` : `${used}`;
    return `
      <div class="driverCard ${d.id === activeDriverId ? "active" : ""}" data-driver="${escapeHtml(d.id)}">
        <div style="font-weight:900;">🚗 ${escapeHtml(fullName(d))}</div>
        <div class="muted2">${escapeHtml(d.email||"")}</div>
        <div class="kpi">
          <div class="badge">Ocupación: ${escapeHtml(capTxt)}</div>
          ${cap ? `<div class="badge">Cupo: ${escapeHtml(String(cap))}</div>` : ``}
        </div>
      </div>
    `;
  }).join("");

  wrap.querySelectorAll("[data-driver]").forEach(el => {
    el.addEventListener("click", () => {
      activeDriverId = el.dataset.driver || "";
      $("activeDriverBadge").textContent = activeDriverId ? `Chofer activo: ${driverNameById(activeDriverId)}` : "Chofer activo: —";
      driversRender();
      passengersRender();
    });
  });

  $("activeDriverBadge").textContent = activeDriverId ? `Chofer activo: ${driverNameById(activeDriverId)}` : "Chofer activo: —";
}

function passengersRender(){
  const wrap = $("passengersList");
  if (!wrap) return;

  const phaseId = getActivePhaseId();
  const list = passengersInEvent();

  const q = (($("passSearch")?.value || "").trim()).toLowerCase();

  const view = list
    .filter(p => {
      const hay = `${p.firstName||""} ${p.lastName||""} ${p.phone||""} ${p.address||""} ${p.localidad||""}`.toLowerCase();
      return !q || hay.includes(q);
    })
    .map(p => {
      const assigned = assignedDriverIdForPassengerPhase(p.id, phaseId);
      const isAssigned = !!assigned;
      const show =
        (passFilter === "all") ||
        (passFilter === "pending" && !isAssigned) ||
        (passFilter === "assigned" && isAssigned);

      if (!show) return null;

      const label = isAssigned ? `Asignado: <strong>${escapeHtml(driverNameById(assigned))}</strong>` : "Pendiente";
      const btn = !activeDriverId
        ? `<span class="muted2">Seleccioná un chofer para asignar</span>`
        : (isAssigned
            ? (assigned === activeDriverId
                ? `<button class="btnSm btnDanger" data-action="unassign" data-pid="${escapeHtml(p.id)}">Quitar</button>`
                : `<button class="btnSm" data-action="move" data-pid="${escapeHtml(p.id)}">Mover a ${escapeHtml(driverNameById(activeDriverId))}</button>`
              )
            : `<button class="btnSm primary" data-action="assign" data-pid="${escapeHtml(p.id)}">Asignar</button>`
          );

      return `
        <div class="passCard">
          <div class="rowBetween">
            <div>
              <div style="font-weight:900;">🧍 ${escapeHtml(fullName(p))}</div>
              <div class="muted2">${p.phone ? escapeHtml(p.phone) : ""}${p.localidad ? ` · ${escapeHtml(p.localidad)}` : ""}</div>
              <div class="muted2">${p.address ? escapeHtml(p.address) : ""}</div>
              <div class="muted2" style="margin-top:6px;">${label}</div>
            </div>
            <div class="row" style="gap:10px; flex-wrap:wrap;">
              ${btn}
            </div>
          </div>
        </div>
      `;
    })
    .filter(Boolean);

  if (!view.length){
    wrap.innerHTML = `<div class="emptyBox">No hay pasajeros para mostrar con los filtros actuales.</div>`;
    return;
  }

  wrap.innerHTML = view.join("");

  wrap.querySelectorAll("button[data-action]").forEach(b => {
    b.addEventListener("click", async () => {
      const action = b.dataset.action;
      const passengerId = b.dataset.pid;
      const phaseId = getActivePhaseId();

      try{
        if (!STATE.auth.isAdmin) throw new Error("Solo Admin");

        if (action === "assign"){
          await assignPassengerToDriverPhase({ passengerId, driverId: activeDriverId, phaseId });
          toast("Asignado");
        } else if (action === "move"){
          await assignPassengerToDriverPhase({ passengerId, driverId: activeDriverId, phaseId });
          toast("Movido");
        } else if (action === "unassign"){
          await unassignPassengerPhase({ passengerId, phaseId });
          toast("Quitado");
        }

        await refreshAll(false);
      }catch(e){
        console.error(e);
        toast(e.message || String(e));
      }
    });
  });
}

function wirePassFilters(){
  const seg = $("passFilter");
  if (!seg) return;

  seg.querySelectorAll(".chip").forEach(ch => {
    ch.addEventListener("click", () => {
      seg.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
      ch.classList.add("active");
      passFilter = ch.dataset.filter || "pending";
      passengersRender();
    });
  });
}

async function refreshAll(showToast = false){
  if (!STATE.event.id) return;

  await loadEventContext(STATE.event.id); // trae fases + asignaciones
  phaseBarRender();
  driversRender();
  passengersRender();

  if (showToast) toast("Actualizado");
}

/* --------- Modal fases (Admin) --------- */
function openPhasesModal(){
  if (!STATE.auth.isAdmin){ toast("Solo Admin"); return; }
  $("phasesModal")?.classList.add("show");
  renderPhasesEditor();
}
function closePhasesModal(){
  $("phasesModal")?.classList.remove("show");
}
function renderPhasesEditor(){
  const wrap = $("phasesEditor");
  if (!wrap) return;

  const phases = phasesForEvent();
  wrap.innerHTML = phases.map((p, idx) => `
    <div class="card" style="padding:12px; margin-bottom:10px;">
      <div class="modalGrid">
        <div class="field">
          <label>ID (sin espacios)</label>
          <input data-k="id" data-i="${idx}" value="${escapeHtml(p.id)}" />
        </div>
        <div class="field">
          <label>Nombre</label>
          <input data-k="name" data-i="${idx}" value="${escapeHtml(p.name || "")}" />
        </div>
        <div class="field">
          <label>Orden</label>
          <input data-k="order" data-i="${idx}" value="${escapeHtml(String(p.order ?? (idx+1)))}" />
        </div>
        <div class="field">
          <label>Acciones</label>
          <button class="btnDanger" data-del="${idx}">Eliminar</button>
        </div>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll("[data-del]").forEach(b => {
    b.addEventListener("click", () => {
      const idx = Number(b.dataset.del);
      const arr = phasesForEvent().slice();
      arr.splice(idx,1);
      STATE.event.phases = arr;
      renderPhasesEditor();
      phaseBarRender();
    });
  });
}

function collectPhasesFromEditor(){
  const wrap = $("phasesEditor");
  const inputs = wrap ? Array.from(wrap.querySelectorAll("input[data-k]")) : [];
  const tmp = {};
  for (const inp of inputs){
    const i = Number(inp.dataset.i);
    const k = inp.dataset.k;
    tmp[i] = tmp[i] || {};
    tmp[i][k] = inp.value;
  }
  let arr = Object.values(tmp).map((x, idx) => ({
    id: String(x.id||"").trim().replace(/\s+/g,""),
    name: String(x.name||"").trim(),
    order: Number(x.order||idx+1)
  })).filter(x => x.id);

  // uniq + sort
  const seen = new Set();
  arr = arr.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  arr.sort((a,b)=> (a.order||0)-(b.order||0));
  return arr;
}

async function savePhases(){
  try{
    if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
    if (!STATE.event.id) throw new Error("No hay evento seleccionado");

    const phases = collectPhasesFromEditor();
    if (!phases.length) throw new Error("Debe haber al menos 1 fase");

    // Guardar en el evento (merge)
    const ev = (STATE.events||[]).find(e => e.id === STATE.event.id) || {};
    await saveEvent({
      id: STATE.event.id,
      name: ev.name || "",
      dateStart: ev.dateStart || null,
      dateEnd: ev.dateEnd || null,
      address: ev.address || "",
      localidad: ev.localidad || "",
      phases
    });

    toast("Fases guardadas");
    closePhasesModal();
    await refreshAll(false);

    // si fase activa ya no existe, setear a primera
    const active = getActivePhaseId();
    if (!phases.some(p => p.id === active)){
      setActivePhaseId(phases[0].id);
      await refreshAll(false);
    }
  }catch(e){
    console.error(e);
    toast(e.message || String(e));
  }
}

(async function init(){
  try{
    await initCorePage({ page: "assignments" });
    if (!STATE.auth.user) return;

    wirePassFilters();
    $("passSearch")?.addEventListener("input", passengersRender);

    $("btnRefresh")?.addEventListener("click", async () => {
      await loadMasterDrivers();
      await loadMasterPassengers();
      await refreshAll(true);
    });

    $("btnCopyIdaVuelta")?.addEventListener("click", async () => {
      try{
        if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
        const ok = confirm("Copiar asignaciones de Ida a Vuelta (solo donde Vuelta está vacía). ¿Continuar?");
        if (!ok) return;
        await copyAssignmentsPhase({ fromPhaseId: "ida", toPhaseId: "vuelta", onlyIfEmpty: true });
        await refreshAll(false);
        toast("Copiado Ida→Vuelta");
      }catch(e){
        console.error(e);
        toast(e.message || String(e));
      }
    });

    $("btnManagePhases")?.addEventListener("click", openPhasesModal);
    $("btnClosePhases")?.addEventListener("click", closePhasesModal);
    $("phasesModal")?.addEventListener("click", (e) => { if (e.target?.id === "phasesModal") closePhasesModal(); });
    $("btnAddPhase")?.addEventListener("click", () => {
      const arr = phasesForEvent().slice();
      arr.push({ id:`fase${arr.length+1}`, name:`Fase ${arr.length+1}`, order: arr.length+1 });
      STATE.event.phases = arr;
      renderPhasesEditor();
    });
    $("btnSavePhases")?.addEventListener("click", savePhases);

    await loadMasterDrivers();
    await loadMasterPassengers();
    await refreshAll(false);

    document.addEventListener("eventChanged", async () => {
      activeDriverId = "";
      await refreshAll(false);
    });
    document.addEventListener("phaseChanged", async () => {
      await refreshAll(false);
    });
  }catch(e){
    console.error("INIT ERROR:", e);
    toast(e.message || String(e));
  }
})();
