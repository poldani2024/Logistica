import { db } from "./firebase-init.js";
import { parseCSV } from "./csv.js";

import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  query, where, orderBy, serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

let STATE = {
  eventId: "event1",
  drivers: [],
  passengers: [],
  assignments: [], // docs: {id, driverId, passengerIds[]}
};

const $ = (id) => document.getElementById(id);

function toast(msg){
  const el = $("copyHint");
  if(el){ el.textContent = msg; setTimeout(()=> el.textContent="", 2200); }
  else alert(msg);
}

/* -------------------- NAV -------------------- */
document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    const el = document.getElementById(`view-${view}`);
    if(el) el.classList.add("active");
  });
});
/* -------------------- EVENT ID -------------------- */
{
  const btn = $("btnSetEvent");
  if (btn) {
    btn.addEventListener("click", async () => {
      const v = ($("eventId")?.value || "").trim();
      STATE.eventId = v || "event1";
      await refreshAll();
      toast("Evento aplicado");
    });
  }
}


/* -------------------- LOAD + REFRESH -------------------- */
async function refreshAll(){
  await Promise.all([loadDrivers(), loadPassengers(), loadAssignments()]);
  renderZones();
  renderDriversTable();
  renderPassengersTable();
  renderAssignments();
  renderDashboard();
}

$("btnRefreshDashboard").addEventListener("click", refreshAll);
$("btnRefreshDrivers").addEventListener("click", loadDriversAndRender);
$("btnRefreshPassengers").addEventListener("click", loadPassengersAndRender);
$("btnRefreshAssignments").addEventListener("click", loadAssignmentsAndRender);

async function loadDriversAndRender(){ await loadDrivers(); renderZones(); renderDriversTable(); renderDashboard(); }
async function loadPassengersAndRender(){ await loadPassengers(); renderZones(); renderPassengersTable(); renderDashboard(); }
async function loadAssignmentsAndRender(){ await loadAssignments(); renderAssignments(); renderDashboard(); }

async function loadDrivers(){
  const ref = collection(db, "drivers");
  const qy = query(ref, where("eventId","==",STATE.eventId), orderBy("lastName","asc"));
  const snap = await getDocs(qy);
  STATE.drivers = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
}

async function loadPassengers(){
  const ref = collection(db, "passengers");
  const qy = query(ref, where("eventId","==",STATE.eventId), orderBy("lastName","asc"));
  const snap = await getDocs(qy);
  STATE.passengers = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
}

async function loadAssignments(){
  const ref = collection(db, "assignments");
  const qy = query(ref, where("eventId","==",STATE.eventId));
  const snap = await getDocs(qy);
  STATE.assignments = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
}

/* -------------------- HELPERS -------------------- */
function uniqZones(){
  const zones = new Set();
  [...STATE.drivers, ...STATE.passengers].forEach(x=>{
    const z = (x.zone||"").trim();
    if(z) zones.add(z);
  });
  return Array.from(zones).sort((a,b)=>a.localeCompare(b));
}

function renderZones(){
  const zones = uniqZones();
  const selects = [
    $("driverZoneFilter"),
    $("passengerZoneFilter"),
    $("assignmentZoneFilter"),
  ];
  selects.forEach(sel=>{
    const current = sel.value;
    sel.innerHTML = `<option value="">Todas las zonas</option>` + zones.map(z=>`<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join("");
    sel.value = current;
  });
}

function escapeHtml(s){
  return (s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

function fullName(x){ return `${x.lastName||""} ${x.firstName||""}`.trim(); }

function driverAssignment(driverId){
  return STATE.assignments.find(a=>a.driverId === driverId) || null;
}

function assignedCount(driverId){
  const a = driverAssignment(driverId);
  return (a?.passengerIds?.length) ? a.passengerIds.length : 0;
}

function passengerById(id){ return STATE.passengers.find(p=>p.id===id); }
function driverById(id){ return STATE.drivers.find(d=>d.id===id); }

/* -------------------- DASHBOARD -------------------- */
function renderDashboard(){
  const passengers = STATE.passengers.length;
  const drivers = STATE.drivers.length;
  const assigned = STATE.passengers.filter(p=>p.status==="assigned").length;
  const pending = passengers - assigned;

  const capTotal = STATE.drivers.reduce((acc,d)=> acc + (Number(d.capacity)||4), 0);
  const capUsed = STATE.drivers.reduce((acc,d)=> acc + assignedCount(d.id), 0);

  $("statPassengers").textContent = passengers;
  $("statPassengers2").textContent = `${assigned} asignados • ${pending} pendientes`;

  $("statDrivers").textContent = drivers;
  $("statDrivers2").textContent = `${capTotal} lugares totales`;

  $("statCapacity").textContent = `${capUsed}/${capTotal}`;
  $("statCapacity2").textContent = `${capTotal-capUsed} lugares libres`;

  // pendientes por zona
  const map = new Map();
  STATE.passengers.filter(p=>p.status!=="assigned").forEach(p=>{
    const z = (p.zone||"Sin zona");
    map.set(z, (map.get(z)||0) + 1);
  });

  const rows = Array.from(map.entries()).sort((a,b)=>b[1]-a[1]);
  const html = `
    <table>
      <thead><tr><th>Zona</th><th>Pendientes</th></tr></thead>
      <tbody>
        ${rows.map(([z,c])=>`<tr><td>${escapeHtml(z)}</td><td>${c}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
  $("pendingByZone").innerHTML = html;
}
function driverByEmail(email){
  const e = String(email||"").trim().toLowerCase();
  if(!e) return null;
  return (STATE.drivers||[]).find(d => String(d.email||"").trim().toLowerCase() === e) || null;
}


/* -------------------- DRIVERS UI -------------------- */
$("driverSearch").addEventListener("input", renderDriversTable);
$("driverZoneFilter").addEventListener("change", renderDriversTable);

$("btnNewDriver").addEventListener("click", ()=> renderDriverDetailForm(null));

function renderDriversTable(){
  const q = ($("driverSearch").value||"").toLowerCase();
  const zf = $("driverZoneFilter").value;

  const list = STATE.drivers.filter(d=>{
    if(zf && (d.zone||"") !== zf) return false;
    const hay = `${d.firstName||""} ${d.lastName||""} ${d.phone||""} ${d.zone||""}`.toLowerCase();
    return !q || hay.includes(q);
  });

  const html = `
  <table>
    <thead>
      <tr>
        <th>Chofer</th><th>Tel</th><th>Zona</th><th>Cap</th><th>Ocupación</th><th></th>
      </tr>
    </thead>
    <tbody>
      ${list.map(d=>{
        const cap = Number(d.capacity)||4;
        const used = assignedCount(d.id);
        return `
        <tr>
          <td><strong>${escapeHtml(fullName(d))}</strong></td>
          <td>${escapeHtml(d.phone||"")}</td>
          <td><span class="tag">${escapeHtml(d.zone||"")}</span></td>
          <td>${cap}</td>
          <td>${used}/${cap}</td>
          <td><button class="btnSecondary" data-driver="${d.id}">Ver</button></td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>`;
  $("driversTable").innerHTML = html;

  $("driversTable").querySelectorAll("button[data-driver]").forEach(b=>{
    b.addEventListener("click", ()=>{
      const id = b.dataset.driver;
      const d = driverById(id);
      renderDriverDetailForm(d);
    });
  });
}

function renderDriverDetailForm(driver){
  const isNew = !driver;
  const d = driver || { firstName:"", lastName:"", phone:"", zone:"", capacity:4, active:true };

  const a = driver ? driverAssignment(driver.id) : null;
  const passengerIds = a?.passengerIds || [];
  const passengers = passengerIds.map(pid=> passengerById(pid)).filter(Boolean);

  const cap = Number(d.capacity)||4;
  const used = driver ? assignedCount(driver.id) : 0;
  const free = cap - used;

  const candidates = driver
    ? STATE.passengers.filter(p => (p.status!=="assigned") && ((p.zone||"") === (d.zone||"")))
    : [];

  $("driverDetail").innerHTML = `
    <div class="grid2">
      <div>
        <div class="field"><label>Nombre</label><input id="d_firstName" value="${escapeHtml(d.firstName)}"></div>
        <div class="field"><label>Apellido</label><input id="d_lastName" value="${escapeHtml(d.lastName)}"></div>
        <div class="field"><label>Teléfono</label><input id="d_phone" value="${escapeHtml(d.phone)}"></div>
        <div class="field"><label>Zona</label><input id="d_zone" value="${escapeHtml(d.zone)}" placeholder="Centro / Norte / Sur..."></div>
        <div class="field"><label>Capacidad</label><input id="d_capacity" type="number" min="1" max="20" value="${escapeHtml(String(d.capacity ?? 4))}"></div>
        <div class="actions">
          <button class="btn" id="btnSaveDriver">${isNew ? "Crear" : "Guardar"}</button>
          ${isNew ? "" : `<button class="btnDanger" id="btnDeleteDriver">Eliminar</button>`}
        </div>
      </div>

      <div>
        ${isNew ? `<div class="muted">Creá el chofer para poder asignar pasajeros.</div>` : `
          <div class="rowBetween">
            <div>
              <div class="cardTitle small">Asignados (${used}/${cap})</div>
              <div class="muted">Libres: ${free} • Zona: ${escapeHtml(d.zone||"")}</div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="cardTitle small">Lista</div>
          ${passengers.length ? passengers.map(p=>`
            <div class="rowBetween" style="padding:8px 0;border-bottom:1px solid var(--line);">
              <div>
                <div><strong>${escapeHtml(fullName(p))}</strong> <span class="tag">${escapeHtml(p.zone||"")}</span></div>
                <div class="muted">${escapeHtml(p.phone||"")} • ${escapeHtml(p.address||"")}</div>
              </div>
              <button class="btnDanger" data-unassign="${p.id}">Quitar</button>
            </div>
          `).join("") : `<div class="muted">No hay pasajeros asignados.</div>`}

          <div class="divider"></div>

          <div class="cardTitle small">Agregar (pendientes de la misma zona)</div>
          <div class="muted">${candidates.length} candidatos</div>
          <div style="margin-top:8px;">
            <select id="selCandidate" ${free<=0 ? "disabled":""} style="width:100%;">
              ${candidates.map(p=>`<option value="${p.id}">${escapeHtml(fullName(p))} • ${escapeHtml(p.address||"")}</option>`).join("")}
            </select>
          </div>
          <div class="actions">
            <button class="btn" id="btnAssign" ${free<=0 ? "disabled":""}>Asignar</button>
            <button class="btnSecondary" id="btnAutoFill" ${free<=0 ? "disabled":""}>Auto-completar (${free} libres)</button>
          </div>
        `}
      </div>
    </div>
  `;

  $("btnSaveDriver").addEventListener("click", async ()=>{
    const payload = {
      firstName: $("d_firstName").value.trim(),
      lastName: $("d_lastName").value.trim(),
      phone: $("d_phone").value.trim(),
      zone: $("d_zone").value.trim(),
      capacity: Number($("d_capacity").value || 4),
      active: true,
      eventId: STATE.eventId,
      updatedAt: serverTimestamp(),
    };

    if(isNew){
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db,"drivers"), payload);
      toast("Chofer creado");
    }else{
      await updateDoc(doc(db,"drivers",driver.id), payload);
      toast("Chofer guardado");
    }
    await loadDriversAndRender();
  });

  if(!isNew){
    $("btnDeleteDriver").addEventListener("click", async ()=>{
      if(!confirm("¿Eliminar chofer? (No borra automáticamente asignaciones)")) return;
      await deleteDoc(doc(db,"drivers",driver.id));
      toast("Chofer eliminado");
      await refreshAll();
      $("driverDetail").textContent = "Seleccioná un chofer para ver/editar y asignar pasajeros.";
    });

    // unassign
    $("driverDetail").querySelectorAll("button[data-unassign]").forEach(b=>{
      b.addEventListener("click", async ()=>{
        const pid = b.dataset.unassign;
        await unassignPassenger(driver.id, pid);
        await refreshAll();
        renderDriverDetailForm(driverById(driver.id));
      });
    });

    // assign one
    $("btnAssign").addEventListener("click", async ()=>{
      const pid = $("selCandidate").value;
      if(!pid) return;
      try{
        await assignPassenger(driver.id, pid);
        await refreshAll();
        renderDriverDetailForm(driverById(driver.id));
      }catch(e){
        alert(e.message || String(e));
      }
    });

    // autofill
    $("btnAutoFill").addEventListener("click", async ()=>{
      const freeSlots = (Number(driver.capacity)||4) - assignedCount(driver.id);
      const cand = STATE.passengers
        .filter(p=>p.status!=="assigned" && (p.zone||"")===(driver.zone||""))
        .slice(0, freeSlots);

      for(const p of cand){
        try{ await assignPassenger(driver.id, p.id); }
        catch(e){ console.warn(e); }
      }
      await refreshAll();
      renderDriverDetailForm(driverById(driver.id));
      toast("Auto-completar listo");
    });
  }
}

/* -------------------- PASSENGERS UI -------------------- */
$("passengerSearch").addEventListener("input", renderPassengersTable);
$("passengerZoneFilter").addEventListener("change", renderPassengersTable);
$("passengerStatusFilter").addEventListener("change", renderPassengersTable);

$("btnNewPassenger").addEventListener("click", ()=> renderPassengerDetailForm(null));

function renderPassengersTable(){
  const q = ($("passengerSearch").value||"").toLowerCase();
  const zf = $("passengerZoneFilter").value;
  const sf = $("passengerStatusFilter").value;

  const list = STATE.passengers.filter(p=>{
    if(zf && (p.zone||"") !== zf) return false;
    if(sf && (p.status||"unassigned") !== sf) return false;
    const hay = `${p.firstName||""} ${p.lastName||""} ${p.phone||""} ${p.address||""} ${p.zone||""}`.toLowerCase();
    return !q || hay.includes(q);
  });

  const html = `
  <table>
    <thead>
      <tr>
        <th>Joven</th><th>Tel</th><th>Dirección</th><th>Zona</th><th>Estado</th><th>Chofer</th><th></th>
      </tr>
    </thead>
    <tbody>
      ${list.map(p=>{
        const driver = p.assignedDriverId ? driverById(p.assignedDriverId) : null;
        return `
        <tr>
          <td><strong>${escapeHtml(fullName(p))}</strong></td>
          <td>${escapeHtml(p.phone||"")}</td>
          <td>${escapeHtml(p.address||"")}</td>
          <td><span class="tag">${escapeHtml(p.zone||"")}</span></td>
          <td>${p.status==="assigned" ? `<span class="pill">Asignado</span>` : `<span class="pill">Pendiente</span>`}</td>
          <td>${driver ? escapeHtml(fullName(driver)) : "-"}</td>
          <td><button class="btnSecondary" data-passenger="${p.id}">Ver</button></td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>`;
  $("passengersTable").innerHTML = html;

  $("passengersTable").querySelectorAll("button[data-passenger]").forEach(b=>{
    b.addEventListener("click", ()=>{
      const id = b.dataset.passenger;
      const p = passengerById(id);
      renderPassengerDetailForm(p);
    });
  });
}

function renderPassengerDetailForm(passenger){
  const isNew = !passenger;
  const p = passenger || { firstName:"", lastName:"", phone:"", address:"", zone:"", status:"unassigned", assignedDriverId:null };

  const driver = p.assignedDriverId ? driverById(p.assignedDriverId) : null;

  $("passengerDetail").innerHTML = `
    <div class="grid2">
      <div>
        <div class="field"><label>Nombre</label><input id="p_firstName" value="${escapeHtml(p.firstName)}"></div>
        <div class="field"><label>Apellido</label><input id="p_lastName" value="${escapeHtml(p.lastName)}"></div>
        <div class="field"><label>Teléfono</label><input id="p_phone" value="${escapeHtml(p.phone)}"></div>
        <div class="field"><label>Dirección</label><input id="p_address" value="${escapeHtml(p.address)}"></div>
        <div class="field"><label>Zona</label><input id="p_zone" value="${escapeHtml(p.zone)}"></div>

        <div class="muted">Estado: <strong>${escapeHtml(p.status || "unassigned")}</strong></div>
        <div class="muted">Chofer: <strong>${driver ? escapeHtml(fullName(driver)) : "-"}</strong></div>

        <div class="actions">
          <button class="btn" id="btnSavePassenger">${isNew ? "Crear" : "Guardar"}</button>
          ${isNew ? "" : `<button class="btnDanger" id="btnDeletePassenger">Eliminar</button>`}
          ${(!isNew && p.status==="assigned" && p.assignedDriverId) ? `<button class="btnDanger" id="btnUnassignHere">Quitar asignación</button>` : ""}
        </div>
      </div>

      <div>
        ${(!isNew && p.status!=="assigned") ? renderQuickAssignBox(p) : `
          <div class="muted">Si querés asignar rápido, ponelo “pendiente” y asigná desde el chofer (recomendado).</div>
        `}
      </div>
    </div>
  `;

  $("btnSavePassenger").addEventListener("click", async ()=>{
    const payload = {
      firstName: $("p_firstName").value.trim(),
      lastName: $("p_lastName").value.trim(),
      phone: $("p_phone").value.trim(),
      address: $("p_address").value.trim(),
      zone: $("p_zone").value.trim(),
      eventId: STATE.eventId,
      updatedAt: serverTimestamp(),
    };

    if(isNew){
      payload.status = "unassigned";
      payload.assignedDriverId = null;
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db,"passengers"), payload);
      toast("Joven creado");
    }else{
      await updateDoc(doc(db,"passengers",passenger.id), payload);
      toast("Joven guardado");
    }
    await loadPassengersAndRender();
  });

  if(!isNew){
    $("btnDeletePassenger").addEventListener("click", async ()=>{
      if(!confirm("¿Eliminar joven?")) return;
      // si estaba asignado, intentar sacarlo de la asignación
      if(passenger.status==="assigned" && passenger.assignedDriverId){
        await unassignPassenger(passenger.assignedDriverId, passenger.id);
      }
      await deleteDoc(doc(db,"passengers",passenger.id));
      toast("Joven eliminado");
      await refreshAll();
      $("passengerDetail").textContent = "Seleccioná un joven para ver/editar.";
    });

    const unBtn = $("btnUnassignHere");
    if(unBtn){
      unBtn.addEventListener("click", async ()=>{
        await unassignPassenger(passenger.assignedDriverId, passenger.id);
        await refreshAll();
        renderPassengerDetailForm(passengerById(passenger.id));
      });
    }

    const qa = $("btnQuickAssign");
    if(qa){
      qa.addEventListener("click", async ()=>{
        const driverId = $("selQuickDriver").value;
        if(!driverId) return;
        try{
          await assignPassenger(driverId, passenger.id);
          await refreshAll();
          renderPassengerDetailForm(passengerById(passenger.id));
        }catch(e){
          alert(e.message || String(e));
        }
      });
    }
  }
}

function renderQuickAssignBox(p){
  const driversSameZone = STATE.drivers
    .filter(d=> (d.zone||"") === (p.zone||""))
    .map(d=>{
      const cap = Number(d.capacity)||4;
      const used = assignedCount(d.id);
      return { d, used, cap };
    })
    .filter(x=> x.used < x.cap);

  return `
    <div class="cardTitle small">Asignación rápida (misma zona)</div>
    <div class="muted">Solo muestra choferes con lugar libre.</div>
    <div style="margin-top:8px;">
      <select id="selQuickDriver" style="width:100%;">
        ${driversSameZone.map(x=>`
          <option value="${x.d.id}">
            ${escapeHtml(fullName(x.d))} • ${x.used}/${x.cap}
          </option>
        `).join("")}
      </select>
    </div>
    <div class="actions">
      <button class="btn" id="btnQuickAssign" ${driversSameZone.length? "" : "disabled"}>Asignar</button>
    </div>
  `;
}

/* -------------------- ASSIGN / UNASSIGN (transaction) -------------------- */
async function assignPassenger(driverId, passengerId){
  const driverRef = doc(db,"drivers",driverId);
  const passengerRef = doc(db,"passengers",passengerId);

  // buscamos/creamos assignment doc para este driver + event
  const assignmentRef = await ensureAssignmentDoc(driverId);

  await runTransaction(db, async (tx)=>{
    const driverSnap = await tx.get(driverRef);
    if(!driverSnap.exists()) throw new Error("Chofer no existe");

    const passengerSnap = await tx.get(passengerRef);
    if(!passengerSnap.exists()) throw new Error("Pasajero no existe");

    const d = driverSnap.data();
    const p = passengerSnap.data();

    if(p.eventId !== STATE.eventId || d.eventId !== STATE.eventId){
      throw new Error("EventId no coincide");
    }
    if(p.status === "assigned" && p.assignedDriverId){
      throw new Error("Ese pasajero ya está asignado");
    }

    const aSnap = await tx.get(assignmentRef);
    const a = aSnap.exists() ? aSnap.data() : { passengerIds:[] };

    const cap = Number(d.capacity)||4;
    const ids = Array.isArray(a.passengerIds) ? a.passengerIds : [];
    if(ids.length >= cap) throw new Error("Chofer lleno (capacidad alcanzada)");

    // update assignment
    const newIds = [...ids, passengerId];
    tx.set(assignmentRef, {
      eventId: STATE.eventId,
      driverId,
      passengerIds: newIds,
      updatedAt: serverTimestamp(),
    }, { merge:true });

    // update passenger
    tx.update(passengerRef, {
      status: "assigned",
      assignedDriverId: driverId,
      updatedAt: serverTimestamp(),
    });
  });

  toast("Asignado");
}

async function unassignPassenger(driverId, passengerId){
  const passengerRef = doc(db,"passengers",passengerId);
  const assignmentRef = await ensureAssignmentDoc(driverId);

  await runTransaction(db, async (tx)=>{
    const pSnap = await tx.get(passengerRef);
    if(!pSnap.exists()) return;
    const p = pSnap.data();

    const aSnap = await tx.get(assignmentRef);
    const a = aSnap.exists() ? aSnap.data() : { passengerIds:[] };
    const ids = Array.isArray(a.passengerIds) ? a.passengerIds : [];
    const newIds = ids.filter(id=>id!==passengerId);

    tx.set(assignmentRef, {
      eventId: STATE.eventId,
      driverId,
      passengerIds: newIds,
      updatedAt: serverTimestamp(),
    }, { merge:true });

    // solo si coincide chofer
    if(p.assignedDriverId === driverId){
      tx.update(passengerRef, {
        status: "unassigned",
        assignedDriverId: null,
        updatedAt: serverTimestamp(),
      });
    }
  });

  toast("Quitado");
}

async function ensureAssignmentDoc(driverId){
  // assignmentId determinístico: `${eventId}_${driverId}`
  const id = `${STATE.eventId}_${driverId}`;
  const ref = doc(db,"assignments", id);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref, { eventId: STATE.eventId, driverId, passengerIds: [], createdAt: serverTimestamp() });
  }
  return ref;
}

/* -------------------- ASSIGNMENTS VIEW -------------------- */
$("assignmentSearch").addEventListener("input", renderAssignments);
$("assignmentZoneFilter").addEventListener("change", renderAssignments);
$("btnCopyWA").addEventListener("click", async ()=>{
  await navigator.clipboard.writeText($("waText").value || "");
  toast("Copiado");
});

$("btnExportCSV").addEventListener("click", ()=>{
  const csv = exportAssignmentsCSV();
  downloadTextFile(`asignaciones_${STATE.eventId}.csv`, csv);
});

function renderAssignments(){
  const zf = $("assignmentZoneFilter").value;
  const q = ($("assignmentSearch").value||"").toLowerCase();

  // armar lista por driver
  const items = STATE.drivers
    .filter(d=> !zf || (d.zone||"")===zf)
    .map(d=>{
      const a = driverAssignment(d.id);
      const pids = a?.passengerIds || [];
      const plist = pids.map(pid=> passengerById(pid)).filter(Boolean);
      return { d, plist };
    });

  const filtered = items.filter(it=>{
    if(!q) return true;
    const hay = `${fullName(it.d)} ${it.d.phone||""} ${it.d.zone||""} ` +
      it.plist.map(p=>`${fullName(p)} ${p.phone||""} ${p.address||""}`).join(" ");
    return hay.toLowerCase().includes(q);
  });

  $("assignmentsList").innerHTML = filtered.map(it=>{
    const cap = Number(it.d.capacity)||4;
    const used = it.plist.length;
    return `
      <div class="item" data-driver="${it.d.id}">
        <div class="itemHeader">
          <div>
            <div class="itemTitle">${escapeHtml(fullName(it.d))}</div>
            <div class="muted">${escapeHtml(it.d.phone||"")} • <span class="tag">${escapeHtml(it.d.zone||"")}</span></div>
          </div>
          <div class="pill">${used}/${cap}</div>
        </div>
        <div class="divider"></div>
        ${it.plist.length ? it.plist.map(p=>`
          <div class="rowBetween" style="padding:6px 0;">
            <div>
              <strong>${escapeHtml(fullName(p))}</strong>
              <div class="muted">${escapeHtml(p.phone||"")} • ${escapeHtml(p.address||"")}</div>
            </div>
            <button class="btnDanger" data-unassign2="${it.d.id}|${p.id}">Quitar</button>
          </div>
        `).join("") : `<div class="muted">Sin asignados.</div>`}
      </div>
    `;
  }).join("");

  // click para generar WhatsApp
  $("assignmentsList").querySelectorAll(".item[data-driver]").forEach(el=>{
    el.addEventListener("click", (e)=>{
      // evitar que el click en "Quitar" dispare el WA
      if(e.target?.dataset?.unassign2) return;
      const id = el.dataset.driver;
      $("waText").value = makeWhatsAppText(id);
      toast("Texto listo");
    });
  });

  // quitar desde vista
  $("assignmentsList").querySelectorAll("button[data-unassign2]").forEach(b=>{
    b.addEventListener("click", async (e)=>{
      e.stopPropagation();
      const [did,pid] = b.dataset.unassign2.split("|");
      await unassignPassenger(did, pid);
      await refreshAll();
    });
  });
}

function makeWhatsAppText(driverId){
  const d = driverById(driverId);
  const a = driverAssignment(driverId);
  const pids = a?.passengerIds || [];
  const plist = pids.map(pid=> passengerById(pid)).filter(Boolean);

  const lines = [];
  lines.push(`Chofer: ${fullName(d)} (${d.phone||"-"})`);
  lines.push(`Zona: ${d.zone||"-"} • Pasajeros: ${plist.length}/${Number(d.capacity)||4}`);
  lines.push("");
  plist.forEach((p,i)=>{
    lines.push(`${i+1}) ${fullName(p)} • ${p.phone||"-"}`);
    lines.push(`   ${p.address||"-"} • Zona: ${p.zone||"-"}`);
  });
  if(!plist.length) lines.push("(Sin asignados)");
  return lines.join("\n");
}

function exportAssignmentsCSV(){
  // driver -> passenger rows
  const header = ["driverLastName","driverFirstName","driverPhone","driverZone","passengerLastName","passengerFirstName","passengerPhone","passengerAddress","passengerZone"];
  const rows = [];

  STATE.drivers.forEach(d=>{
    const a = driverAssignment(d.id);
    const pids = a?.passengerIds || [];
    if(!pids.length){
      rows.push([d.lastName||"", d.firstName||"", d.phone||"", d.zone||"", "", "", "", "", ""]);
      return;
    }
    pids.forEach(pid=>{
      const p = passengerById(pid);
      rows.push([
        d.lastName||"", d.firstName||"", d.phone||"", d.zone||"",
        p?.lastName||"", p?.firstName||"", p?.phone||"", p?.address||"", p?.zone||""
      ]);
    });
  });

  const esc = (v)=> `"${String(v??"").replaceAll('"','""')}"`;
  return [header.join(","), ...rows.map(r=>r.map(esc).join(","))].join("\n");
}

function downloadTextFile(filename, content){
  const blob = new Blob([content], {type:"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* -------------------- IMPORT CSV -------------------- */
$("btnImportPassengers").addEventListener("click", async ()=>{
  const text = $("csvPassengers").value;
  const { rows } = parseCSV(text);
  const log = [];
  for(const r of rows){
    const payload = {
      firstName: (r.firstName||"").trim(),
      lastName: (r.lastName||"").trim(),
      phone: (r.phone||"").trim(),
      address: (r.address||"").trim(),
      zone: (r.zone||"").trim(),
      status: "unassigned",
      assignedDriverId: null,
      eventId: STATE.eventId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if(!payload.firstName && !payload.lastName) continue;
    await addDoc(collection(db,"passengers"), payload);
    log.push(`OK pasajero: ${payload.lastName} ${payload.firstName}`);
  }
  $("importLog").textContent = log.join("\n") || "Nada para importar";
  await refreshAll();
});

$("btnImportDrivers").addEventListener("click", async ()=>{
  const text = $("csvDrivers").value;
  const { rows } = parseCSV(text);
  const log = [];
  for(const r of rows){
    const payload = {
      firstName: (r.firstName||"").trim(),
      lastName: (r.lastName||"").trim(),
      phone: (r.phone||"").trim(),
      zone: (r.zone||"").trim(),
      capacity: Number((r.capacity||"").trim() || 4),
      active: true,
      eventId: STATE.eventId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if(!payload.firstName && !payload.lastName) continue;
    await addDoc(collection(db,"drivers"), payload);
    log.push(`OK chofer: ${payload.lastName} ${payload.firstName}`);
  }
  $("importLog").textContent = log.join("\n") || "Nada para importar";
  await refreshAll();
});

$("btnDangerClearEvent").addEventListener("click", async ()=>{
  if(!confirm(`⚠️ Borra TODO del evento ${STATE.eventId}. ¿Seguro?`)) return;

  const delLog = [];
  for(const col of ["assignments","passengers","drivers"]){
    const ref = collection(db, col);
    const qy = query(ref, where("eventId","==",STATE.eventId));
    const snap = await getDocs(qy);
    for(const d of snap.docs){
      await deleteDoc(doc(db, col, d.id));
      delLog.push(`DEL ${col}/${d.id}`);
    }
  }
  $("importLog").textContent = delLog.join("\n") || "No había nada";
  await refreshAll();
});

/* -------------------- START -------------------- */
(async function init(){
  wireGlobalAuthUI();

  // Finish redirect login (mobile)
  try{ await getRedirectResult(auth); }catch(e){}

  onAuthStateChanged(auth, async (user)=>{
    STATE.auth.user = user || null;

    if(!user){
      STATE.auth.isAdmin = false;
      STATE.auth.driver = null;
      showAuthGate("");
      renderAuthBar();
      // Clear UI
      if(typeof renderDashboard==="function") renderDashboard();
      if(typeof renderDrivers==="function") renderDrivers();
      if(typeof renderPassengers==="function") renderPassengers();
      if(typeof renderAssignments==="function") renderAssignments();
      if(typeof renderTracking==="function") renderTracking();
      return;
    }

    hideAuthGate();

    // Load events now that we are authenticated
    try{ await loadEvents(); }catch(e){ console.warn("loadEvents failed", e); }

    const saved = localStorage.getItem("selectedEventId");
    const fromInput = $$("eventId") ? $$("eventId").value.trim() : "";
    STATE.eventId = saved || fromInput || STATE.eventId || "event1";

    if($$("eventId")) $$("eventId").value = STATE.eventId;
    if($$("eventSelect")) renderEventSelect();

    // Load data and resolve role
    try{ await loadDrivers(); }catch(e){}
    resolveAuthRole();
    renderAuthBar();

    await refreshAll();
  });

  // show gate until auth resolves
  showAuthGate("");
})();function showAuthGate(msg){
  const gate = $$("authGate");
  if(gate) gate.classList.add("show");
  if($$("authGateHint")) $$("authGateHint").textContent = msg || "";
  // Disable event selection until auth
  if($$("eventSelect")) $$("eventSelect").disabled = true;
  if($$("btnReloadEvents")) $$("btnReloadEvents").disabled = true;
}

function hideAuthGate(){
  const gate = $$("authGate");
  if(gate) gate.classList.remove("show");
  if($$("authGateHint")) $$("authGateHint").textContent = "";
  if($$("eventSelect")) $$("eventSelect").disabled = false;
  if($$("btnReloadEvents")) $$("btnReloadEvents").disabled = false;
}

async function doGoogleLogin(){
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if(isMobile){
    await signInWithRedirect(auth, provider);
  }else{
    await signInWithPopup(auth, provider);
  }
}

function wireGlobalAuthUI(){
  if($$("btnAppGoogleLogin")){
    $$("btnAppGoogleLogin").addEventListener("click", async ()=>{
      try{
        if($$("authGateHint")) $$("authGateHint").textContent = "Abriendo login con Google...";
        await doGoogleLogin();
      }catch(e){
        console.warn(e);
        showAuthGate(e?.message || String(e));
      }
    });
  }

  if($$("btnAppLogout")){
    $$("btnAppLogout").addEventListener("click", async ()=>{
      await signOut(auth);
    });
  }
}

function renderAuthBar(){
  const user = STATE.auth?.user;
  const el = $$("authBarStatus");
  const btn = $$("btnAppLogout");
  if(!el) return;

  if(user){
    const role = STATE.auth.isAdmin ? "Admin" : (STATE.auth.driver ? "Chofer" : "Usuario");
    el.textContent = `Logueado: ${user.email} • ${role}`;
    if(btn) btn.style.display = "";
  }else{
    el.textContent = "No logueado";
    if(btn) btn.style.display = "none";
  }
}

