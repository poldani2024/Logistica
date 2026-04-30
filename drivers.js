import {
  initCorePage, STATE, $, toast, escapeHtml,
  loadMasterDrivers
} from "./core.js";

import { validateDriver } from "./validation.js";

import { db } from "./firebase-init.js";

import {
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

function fullName(d){ return `${d.lastName||""} ${d.firstName||""}`.trim(); }

let currentDriverId = null;

function getFilteredDrivers(){
  const q = (($("driverSearch")?.value || "").trim()).toLowerCase();
  const list = (STATE.master.drivers || []).filter(d => {
    const hay = `${d.firstName||""} ${d.lastName||""} ${d.phone||""} ${d.email||""} ${d.localidad||""} ${d.zone||""}`.toLowerCase();
    return !q || hay.includes(q);
  });
  list.sort((a,b) => `${a.lastName||""} ${a.firstName||""}`.localeCompare(`${b.lastName||""} ${b.firstName||""}`));
  return list;
}

function renderTable(){
  const tbody = $("driversTableBody");
  if (!tbody) return;

  const list = getFilteredDrivers();
  tbody.innerHTML = list.map(d => `
    <tr>
      <td><strong>${escapeHtml(fullName(d))}</strong></td>
      <td>${escapeHtml(d.email||"")}</td>
      <td>${escapeHtml(d.phone||"")}</td>
      <td>${escapeHtml(String(d.capacity ?? 4))}</td>
      <td><button class="btn" data-id="${escapeHtml(d.id)}">Ver</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll("button[data-id]").forEach(b => {
    b.addEventListener("click", () => openDetail(b.dataset.id));
  });
}

function renderCards(){
  const wrap = $("driversCards");
  if (!wrap) return;

  const list = getFilteredDrivers();
  wrap.innerHTML = list.map(d => `
    <div class="card" style="padding:14px;">
      <div class="rowBetween">
        <div>
          <div style="font-weight:800;">${escapeHtml(fullName(d) || "(sin nombre)")}</div>
          <div class="subtitle">${escapeHtml(d.email||"")}</div>
          <div class="subtitle">${escapeHtml(d.phone||"")}${d.localidad ? " · " + escapeHtml(d.localidad) : ""}</div>
        </div>
        <button class="btn" data-id="${escapeHtml(d.id)}">Ver</button>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll("button[data-id]").forEach(b => {
    b.addEventListener("click", () => openDetail(b.dataset.id));
  });
}

function renderAll(){
  renderTable();
  renderCards();
}

function openDetailNew(){
  currentDriverId = null;
  $("detailMode").textContent = "Alta de chofer";
  $("btnDeleteDriver").style.display = "none";

  $("driverDetail").innerHTML = `
    <div class="grid2">
      <div class="field"><label>Nombre</label><input id="d_firstName" placeholder="Nombre"></div>
      <div class="field"><label>Apellido</label><input id="d_lastName" placeholder="Apellido"></div>

      <div class="field"><label>Email</label><input id="d_email" placeholder="email@..."></div>
      <div class="field"><label>Teléfono</label><input id="d_phone" placeholder="(sin guiones)"></div>

      <div class="field"><label>Dirección</label><input id="d_address" placeholder="Calle y número"></div>
      <div class="field"><label>Localidad</label><input id="d_localidad" placeholder="Rosario / Funes / ..."></div>

      <div class="field"><label>Zona</label><input id="d_zone" placeholder="Zona"></div>
      <div class="field"><label>Capacidad</label><input id="d_capacity" type="number" value="4" min="1" max="15"></div>
    </div>

    <div class="row" style="margin-top:12px;">
      <button id="btnSaveDriver" class="btnPrimary primary">Guardar</button>
      <button id="btnCancelDriver" class="btnSecondary">Cancelar</button>
    </div>

    <p class="muted" style="margin-top:10px;">Master Data: acá no se asignan pasajeros.</p>
  `;

  $("btnSaveDriver").addEventListener("click", saveDriver);
  $("btnCancelDriver").addEventListener("click", () => {
    $("driverDetail").innerHTML = '<span class="muted">Seleccioná un chofer…</span>';
    $("detailMode").textContent = "Seleccioná un chofer…";
  });
}

function openDetail(id){
  const d = (STATE.master.drivers || []).find(x => x.id === id) || null;
  if (!d) return;

  currentDriverId = id;
  $("detailMode").textContent = "Edición";
  $("btnDeleteDriver").style.display = STATE.auth.isAdmin ? "inline-block" : "none";

  $("driverDetail").innerHTML = `
    <div class="grid2">
      <div class="field"><label>Nombre</label><input id="d_firstName" value="${escapeHtml(d.firstName||"")}"></div>
      <div class="field"><label>Apellido</label><input id="d_lastName" value="${escapeHtml(d.lastName||"")}"></div>

      <div class="field"><label>Email</label><input id="d_email" value="${escapeHtml(d.email||"")}"></div>
      <div class="field"><label>Teléfono</label><input id="d_phone" value="${escapeHtml(d.phone||"")}"></div>

      <div class="field"><label>Dirección</label><input id="d_address" value="${escapeHtml(d.address||"")}"></div>
      <div class="field"><label>Localidad</label><input id="d_localidad" value="${escapeHtml(d.localidad||"")}"></div>

      <div class="field"><label>Zona</label><input id="d_zone" value="${escapeHtml(d.zone||"")}"></div>
      <div class="field"><label>Capacidad</label><input id="d_capacity" type="number" value="${escapeHtml(String(d.capacity ?? 4))}" min="1" max="15"></div>
    </div>

    <div class="row" style="margin-top:12px;">
      <button id="btnSaveDriver" class="btnPrimary primary">Guardar</button>
    </div>

    <p class="muted" style="margin-top:10px;">Master Data: acá no se asignan pasajeros.</p>
  `;

  $("btnSaveDriver").addEventListener("click", saveDriver);
  $("btnDeleteDriver").onclick = deleteCurrent;
}

function getPayloadFromForm(){
  return {
    firstName: ($("d_firstName")?.value || "").trim(),
    lastName: ($("d_lastName")?.value || "").trim(),
    email: ($("d_email")?.value || "").trim(),
    phone: ($("d_phone")?.value || "").trim(),
    address: ($("d_address")?.value || "").trim(),
    localidad: ($("d_localidad")?.value || "").trim(),
    zone: ($("d_zone")?.value || "").trim(),
    capacity: Number(($("d_capacity")?.value || 4)),
    updatedAt: serverTimestamp()
  };
}

async function saveDriver(){
  try{
    if (!STATE.auth.isAdmin) throw new Error("Solo Admin");

    const payload = getPayloadFromForm();

    const { valid, errors } = validateDriver(payload);
    if (!valid) {
      const first = Object.values(errors)[0];
      throw new Error(first);
    }

    if (!currentDriverId){
      const ref = await addDoc(collection(db, "drivers"), {
        ...payload,
        createdAt: serverTimestamp()
      });
      currentDriverId = ref.id;
      toast("Chofer creado");
    } else {
      await setDoc(doc(db, "drivers", currentDriverId), payload, { merge:true });
      toast("Chofer actualizado");
    }

    await loadMasterDrivers();
    renderAll();
    openDetail(currentDriverId);
  }catch(e){
    console.error(e);
    toast(e.message || String(e));
  }
}

async function deleteCurrent(){
  try{
    if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
    if (!currentDriverId) return;

    const ok = confirm("¿Eliminar este chofer?");
    if (!ok) return;

    await deleteDoc(doc(db, "drivers", currentDriverId));
    toast("Chofer eliminado");
    currentDriverId = null;

    await loadMasterDrivers();
    renderAll();

    $("driverDetail").innerHTML = '<span class="muted">Seleccioná un chofer…</span>';
    $("detailMode").textContent = "Seleccioná un chofer…";
    $("btnDeleteDriver").style.display = "none";
  }catch(e){
    console.error(e);
    toast(e.message || String(e));
  }
}

(async function init(){
  try{
    await initCorePage({ page: "drivers" });
    if (!STATE.auth.user) return;

    $("driverSearch")?.addEventListener("input", renderAll);
    $("btnReloadDrivers")?.addEventListener("click", async () => {
      await loadMasterDrivers();
      renderAll();
      toast("Choferes recargados");
    });

    $("btnAddDriver")?.addEventListener("click", openDetailNew);

    await loadMasterDrivers();
    renderAll();
  }catch(e){
    console.error("INIT ERROR:", e);
    toast(e.message || String(e));
  }
})();