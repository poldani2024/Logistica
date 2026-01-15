import { db } from "./firebase-init.js";
import { parseCSV } from "./csv.js";

import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  query, where, orderBy, serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

import {
  getAuth, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";

let STATE = {
  eventId: "event1",
  drivers: [],
  passengers: [],
  assignments: [], // docs: {id, driverId, passengerIds[]}
  events: [],
  auth: { user: null, isAdmin: false, driver: null },
};

const $ = (id) => document.getElementById(id);
const $$ = (id) => document.getElementById(id);


const auth = getAuth();

// Admin allowlist (emails en minúscula). Podés editar esta lista.
const ADMIN_EMAILS = [
  "pedro.l.oldani@gmail.com",
];

function isAdminEmail(email){
  const e = (email||"").trim().toLowerCase();
  return ADMIN_EMAILS.includes(e);
}


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
    $(`view-${view}`).classList.add("active");

    // Map needs resize when shown
    if(view === "map"){
      try{ renderMap(); }catch(e){ console.warn(e); }
    }
  });
});
/* -------------------- EVENT ID -------------------- */

/* -------------------- EVENTS (dropdown) -------------------- */
// Uses collection "events". Each document id is the eventId.
// Suggested fields: { name, date } (date can be string or timestamp)
async function loadEvents(){
  const ref = collection(db, "events");
  let qy = ref;
  // Try to order by date desc, if field exists; otherwise falls back.
  try{
    qy = query(ref, orderBy("date", "desc"));
  }catch(_e){
    qy = ref;
  }
  const snap = await getDocs(qy);
  STATE.events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderEventSelect();
}

function renderEventSelect(){
  const sel = $$("eventSelect");
  if(!sel) return; // UI not present, keep using text eventId

  if(!STATE.events || STATE.events.length === 0){
    sel.innerHTML = '<option value="">(Sin eventos)</option>';
    return;
  }

  sel.innerHTML = STATE.events.map(ev=>{
    const name = ev.name || ev.title || ev.id;
    // If date is a Firestore Timestamp, show YYYY-MM-DD-ish
    let dateTxt = "";
    if(ev.date){
      if(typeof ev.date === "string") dateTxt = ev.date;
      else if(typeof ev.date?.toDate === "function"){
        const d = ev.date.toDate();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth()+1).padStart(2,"0");
        const dd = String(d.getDate()).padStart(2,"0");
        dateTxt = `${yyyy}-${mm}-${dd}`;
      }
    }
    const label = dateTxt ? `${name} — ${dateTxt}` : `${name}`;
    return `<option value="${escapeHtml(ev.id)}">${escapeHtml(label)}</option>`;
  }).join("");

  const saved = localStorage.getItem("selectedEventId");
  const currentText = $$("eventId") ? $$("eventId").value.trim() : "";
  const preferred = saved || STATE.eventId || currentText || STATE.events[0].id;
  const exists = STATE.events.some(e => e.id === preferred);
  const finalId = exists ? preferred : STATE.events[0].id;

  sel.value = finalId;
  STATE.eventId = finalId;

  // Keep old text input (if exists) in sync
  if($$("eventId")) $$("eventId").value = finalId;
}

// UI listeners (optional)
if($$("eventSelect")){
  $$("eventSelect").addEventListener("change", async (e)=>{
    const v = e.target.value;
    if(!v) return;
    STATE.eventId = v;
    localStorage.setItem("selectedEventId", v);
    if($$("eventId")) $$("eventId").value = v;
    await refreshAll();
    toast("Evento aplicado");
  });
}
if($$("btnReloadEvents")){
  $$("btnReloadEvents").addEventListener("click", async ()=>{
    await loadEvents();
    await refreshAll();
    toast("Eventos recargados");
  });
}

if($$("btnSetEvent")) $("btnSetEvent").addEventListener("click", async ()=>{
  const v = $("eventId").value.trim();
  STATE.eventId = v || "event1";
  await refreshAll();
  toast("Event aplicado");
});

/* -------------------- LOAD + REFRESH -------------------- */
async function refreshAll(){
  await Promise.all([loadDrivers(), loadPassengers(), loadAssignments()]);
  renderZones();
  renderDriversTable();
  renderPassengersTable();
  renderAssignments();
  renderDashboard();
  if(typeof renderTracking==="function") renderTracking();
  if(typeof renderMap==="function") renderMap();
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
    $("mapZoneFilter"),
  ].filter(Boolean);
  selects.forEach(sel=>{
    const current = sel.value;
    const firstLabel = (sel.id==="mapZoneFilter") ? "Todas las zonas" : "Todas las zonas";
    sel.innerHTML = `<option value="">${firstLabel}</option>` + zones.map(z=>`<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join("");
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
function driverByEmail(email){
  const e = (email||"").trim().toLowerCase();
  return STATE.drivers.find(d => (d.email||"").trim().toLowerCase() === e) || null;
}

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
        <th>Chofer</th><th>Tel</th><th>Correo</th><th>Zona</th><th>Cap</th><th>Ocupación</th><th></th>
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
          <td>${escapeHtml(d.email||"")}</td>
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
  const d = driver || { firstName:"", lastName:"", phone:"", email:"", address:"", localidad:"Rosario", lat:null, lng:null, zone:"", capacity:4, active:true, role:"driver" };

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
        <div class="field"><label>Correo</label><input id="d_email" value="${escapeHtml(d.email||"")}" placeholder="chofer@correo.com"></div>
        <div class="field"><label>Domicilio</label><input id="d_address" value="${escapeHtml(d.address||"")}" placeholder="Calle y número"></div>
        <div class="field"><label>Localidad</label>
          <select id="d_localidad">
            ${["Rosario","Funes","Roldan","San Lorenzo"].map(l=>`<option value="${l}" ${((d.localidad||"Rosario")===l)?"selected":""}>${l}</option>`).join("")}
          </select>
        </div>
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
      email: ($("d_email") ? $("d_email").value.trim().toLowerCase() : ""),
      address: ($("d_address") ? $("d_address").value.trim() : ""),
      localidad: ($("d_localidad") ? $("d_localidad").value : "Rosario"),
      zone: $("d_zone").value.trim(),
      capacity: Number($("d_capacity").value || 4),
      active: true,
      role: (driver && driver.role) ? driver.role : "driver",
      eventId: STATE.eventId,
      updatedAt: serverTimestamp(),
    }

    // Auto-geocodificar chofer si hay domicilio (no requiere que el usuario haga nada)
    // Si el domicilio/localidad cambian, recalculamos lat/lng.
    const prevAddr = (driver?.address||"").trim();
    const prevLoc = (driver?.localidad||"Rosario").trim();
    const addrNow = (payload.address||"").trim();
    const locNow = (payload.localidad||"Rosario").trim();
    if(addrNow){
      const changed = (addrNow !== prevAddr) || (locNow !== prevLoc) || (driver?.lat==null) || (driver?.lng==null);
      if(changed){
        try{
          const q = `${addrNow}, ${locNow}, Santa Fe, Argentina`;
          const geo = await geocodeQuery(q);
          if(geo){
            payload.lat = geo.lat;
            payload.lng = geo.lng;
            payload.geocodedQuery = q;
            payload.geocodedAt = serverTimestamp();
          }
        }catch(e){
          console.warn("geocode driver fail", e);
        }
      }else{
        payload.lat = driver.lat ?? null;
        payload.lng = driver.lng ?? null;
      }
    }else{
      payload.lat = driver?.lat ?? null;
      payload.lng = driver?.lng ?? null;
    }
;

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
    const hay = `${p.firstName||""} ${p.lastName||""} ${p.phone||""} ${p.address||""} ${p.zone||""} ${p.localidad||""}`.toLowerCase();
    return !q || hay.includes(q);
  });

  const html = `
  <table>
    <thead>
      <tr>
        <th>Joven</th><th>Tel</th><th>Dirección</th><th>Localidad</th><th>Zona</th><th>Estado</th><th>Chofer</th><th></th>
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
          <td>${escapeHtml(p.localidad||"Rosario")}</td>
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
  const p = passenger || { firstName:"", lastName:"", phone:"", address:"", zone:"", localidad:"Rosario", status:"unassigned", assignedDriverId:null, lat:null, lng:null };

  const driver = p.assignedDriverId ? driverById(p.assignedDriverId) : null;

  $("passengerDetail").innerHTML = `
    <div class="grid2">
      <div>
        <div class="field"><label>Nombre</label><input id="p_firstName" value="${escapeHtml(p.firstName)}"></div>
        <div class="field"><label>Apellido</label><input id="p_lastName" value="${escapeHtml(p.lastName)}"></div>
        <div class="field"><label>Teléfono</label><input id="p_phone" value="${escapeHtml(p.phone)}"></div>
        <div class="field"><label>Dirección</label><input id="p_address" value="${escapeHtml(p.address)}"></div>
        <div class="field"><label>Localidad</label>
          <select id="p_localidad">
            ${["Rosario","Funes","Roldan","San Lorenzo"].map(l=>`<option value="${l}" ${((p.localidad||"Rosario")===l)?"selected":""}>${l}</option>`).join("")}
          </select>
        </div>
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
      localidad: ($("p_localidad") ? $("p_localidad").value : "Rosario"),
      zone: $("p_zone").value.trim(),
      eventId: STATE.eventId,
      updatedAt: serverTimestamp(),
    };

    if(isNew){
      payload.status = "unassigned";
      payload.assignedDriverId = null;
      payload.assignedDriverEmail = null;
      payload.lat = null;
      payload.lng = null;
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
      assignedDriverEmail: (d.email||"").trim().toLowerCase(),
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
      assignedDriverEmail: null,
      lat: null,
      lng: null,
        assignedDriverEmail: null,
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



/* -------------------- GEO HELPERS -------------------- */
function haversineKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const toRad = (x)=> x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function geocodeQuery(q){
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q);
  const res = await fetch(url, { headers: { "Accept": "application/json" }});
  const data = await res.json();
  if(data && data[0]) return { lat:Number(data[0].lat), lng:Number(data[0].lon) };
  return null;
}

/* -------------------- MAP (Leaflet) -------------------- */
// Requires Leaflet loaded in Index.html (leaflet.js + leaflet.css)
let MAP = {
  map: null,
  passengersLayer: null,
  driversLayer: null,
  zonesLayer: null
};

const LOCALIDADES = ["Rosario","Funes","Roldan","San Lorenzo"];

// Rough bounds for Gran Rosario (approx)
const GRAN_ROSARIO_CENTER = [-32.95, -60.66];
const GRAN_ROSARIO_BOUNDS = [
  [-33.20, -60.95], // SW
  [-32.70, -60.45]  // NE
];

// Simple zone polygons (approximation). You can refine later.
const ZONE_POLYS = {
  "Centro": [[-32.97,-60.70],[-32.97,-60.62],[-32.92,-60.62],[-32.92,-60.70]],
  "Norte":  [[-32.92,-60.74],[-32.92,-60.58],[-32.82,-60.58],[-32.82,-60.74]],
  "Sur":    [[-33.08,-60.74],[-33.08,-60.58],[-32.97,-60.58],[-32.97,-60.74]],
  "Oeste":  [[-33.08,-60.95],[-33.08,-60.74],[-32.82,-60.74],[-32.82,-60.95]],
  "Este":   [[-33.08,-60.62],[-33.08,-60.50],[-32.82,-60.50],[-32.82,-60.62]]
};

function initMapIfNeeded(){
  const el = $("map");
  if(!el) return;

  if(MAP.map) return;

  if(typeof L === "undefined"){
    console.warn("Leaflet no cargó. Revisá leaflet.js en Index.html");
    return;
  }

  MAP.map = L.map("map", {
    preferCanvas: true
  }).setView(GRAN_ROSARIO_CENTER, 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(MAP.map);

  MAP.zonesLayer = L.layerGroup().addTo(MAP.map);
  MAP.passengersLayer = L.layerGroup().addTo(MAP.map);
  MAP.driversLayer = L.layerGroup().addTo(MAP.map);

  // Zones overlay
  drawZones();

  // UI buttons
  if($("btnRefreshMap")){
    $("btnRefreshMap").addEventListener("click", ()=>{
      renderMap();
      toast("Mapa refrescado");
    });
  }
  if($("mapZoneFilter")){
    $("mapZoneFilter").addEventListener("change", renderMap);
  }
  if($("mapShow")){
    $("mapShow").addEventListener("change", renderMap);
  }
  if($("btnGeocodePassengers")){
    $("btnGeocodePassengers").addEventListener("click", geocodeMissingPassengers);
  }
}

function drawZones(){
  if(!MAP.zonesLayer) return;
  MAP.zonesLayer.clearLayers();

  Object.entries(ZONE_POLYS).forEach(([name, coords])=>{
    const poly = L.polygon(coords, { weight: 1, fillOpacity: 0.05 });
    poly.bindTooltip(name, { sticky:true });
    poly.addTo(MAP.zonesLayer);
  });
}

function zoneFromPassenger(p){
  return (p.zone||"").trim();
}

function renderMap(){
  initMapIfNeeded();
  if(!MAP.map) return;

  // Important: if view was hidden, Leaflet needs a size refresh
  setTimeout(()=>{ try{ MAP.map.invalidateSize(); }catch(_e){} }, 60);

  MAP.passengersLayer.clearLayers();
  MAP.driversLayer.clearLayers();

  const zoneFilter = $("mapZoneFilter") ? $("mapZoneFilter").value : "";
  const show = $("mapShow") ? $("mapShow").value : "all";

  // Passengers
  if(show === "all" || show === "passengers"){
    STATE.passengers.forEach(p=>{
      if(zoneFilter && zoneFromPassenger(p) !== zoneFilter) return;
      if(p.lat == null || p.lng == null) return;

      const assigned = (p.status === "assigned" && !!p.assignedDriverId);
      const icon = L.divIcon({
        className: "markerDot",
        html: `<div style="width:12px;height:12px;border-radius:50%;background:${assigned ? "#24c26a" : "#ff4d4f"};border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.25)"></div>`,
        iconSize: [12,12],
        iconAnchor: [6,6]
      });

      const m = L.marker([p.lat, p.lng], { icon });
      const driver = p.assignedDriverId ? driverById(p.assignedDriverId) : null;
      const html = `
        <div style="min-width:220px">
          <strong>${escapeHtml(fullName(p))}</strong><br/>
          ${escapeHtml(p.phone||"")}<br/>
          ${escapeHtml(p.address||"")}<br/>
          ${escapeHtml(p.localidad||"Rosario")} • <span class="tag">${escapeHtml(p.zone||"")}</span><br/>
          Estado: <strong>${assigned ? "Asignado" : "Pendiente"}</strong><br/>
          Chofer: ${driver ? escapeHtml(fullName(driver)) : "-"}
        </div>
      `;
      m.bindPopup(html);
      m.addTo(MAP.passengersLayer);
    });
  }

  // Drivers (placed at zone centroid for now)
  if(show === "all" || show === "drivers"){
    STATE.drivers.forEach(d=>{
      if(zoneFilter && (d.zone||"") !== zoneFilter) return;

      // Use real coords if present; otherwise fall back to zone centroid
      let lat = (d.lat!=null ? Number(d.lat) : null);
      let lng = (d.lng!=null ? Number(d.lng) : null);
      if(lat==null || lng==null){
        const poly = ZONE_POLYS[d.zone];
        if(!poly) return;
        lat = poly.reduce((a,c)=>a+c[0],0)/poly.length;
        lng = poly.reduce((a,c)=>a+c[1],0)/poly.length;
      }

      const icon = L.divIcon({
        className: "markerDot",
        html: `<div style="width:14px;height:14px;border-radius:4px;background:#2f76ff;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.25)"></div>`,
        iconSize: [14,14],
        iconAnchor: [7,7]
      });

      const used = assignedCount(d.id);
      const cap = Number(d.capacity)||4;

      const m = L.marker([lat,lng], { icon });
      m.bindPopup(`
        <div style="min-width:220px">
          <strong>Chofer: ${escapeHtml(fullName(d))}</strong><br/>
          ${escapeHtml(d.phone||"")}<br/>
          ${escapeHtml(d.email||"")}<br/>
          Zona: <span class="tag">${escapeHtml(d.zone||"")}</span><br/>
          Ocupación: <strong>${used}/${cap}</strong>
        </div>
      `);
      m.addTo(MAP.driversLayer);
    });
  }
}

async function geocodeMissingPassengers(){
  const toGeocode = STATE.passengers.filter(p => (p.lat==null || p.lng==null) && (p.address||"").trim());
  if(!toGeocode.length){
    alert("No hay jóvenes sin coordenadas (o sin dirección).");
    return;
  }

  const max = Math.min(25, toGeocode.length);
  if(!confirm(`Vas a geocodificar ${max} jóvenes (máx 25 por intento para no saturar). ¿Continuar?`)) return;

  let ok = 0;
  for(let i=0; i<max; i++){
    const p = toGeocode[i];
    const localidad = (p.localidad || "Rosario").trim() || "Rosario";
    const q = `${p.address}, ${localidad}, Santa Fe, Argentina`;

    try{
      const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q);
      const res = await fetch(url, { headers: { "Accept": "application/json" }});
      const data = await res.json();
      if(data && data[0]){
        const lat = Number(data[0].lat);
        const lng = Number(data[0].lon);
        await updateDoc(doc(db,"passengers", p.id), {
          lat, lng,
          geocodedQuery: q,
          geocodedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        ok++;
      }
    }catch(e){
      console.warn("geocode fail", e);
    }

    // polite delay
    await new Promise(r=>setTimeout(r, 1100));
  }

  toast(`Geocodificados: ${ok}`);
  await loadPassengers();
  renderMap();
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
      localidad: (r.localidad||"Rosario").trim() || "Rosario",
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
      email: (r.email||"").trim().toLowerCase(),
      address: (r.address||"").trim(),
      localidad: (r.localidad||"Rosario").trim() || "Rosario",
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


/* -------------------- TRACKING (auth + statuses) -------------------- */
const TRACKING_STATUSES = ["Pendiente","En tránsito","En destino","Ausente"];

// Ensure passenger has tracking fields
function passengerTracking(p){
  return {
    status: p.trackingStatus || (p.status==="assigned" ? "Pendiente" : "Pendiente"),
    note: p.trackingNote || "",
    updatedAt: p.trackingUpdatedAt || null,
    updatedBy: p.trackingUpdatedBy || null,
  };
}

function canEditPassenger(p){
  const u = STATE.auth.user;
  if(!u) return false;
  if(STATE.auth.isAdmin) return true;
  // driver can edit only if assigned to them
  const d = STATE.auth.driver;
  return !!d && p.assignedDriverId === d.id;
}

function visiblePassengersForTracking(){
  const u = STATE.auth.user;
  if(!u) return [];
  if(STATE.auth.isAdmin){
    const filter = $$("trackingDriverFilter") ? $$("trackingDriverFilter").value : "";
    if(filter) return STATE.passengers.filter(p => p.assignedDriverId === filter);
    return STATE.passengers.filter(p => p.status==="assigned" && p.assignedDriverId);
  }
  const d = STATE.auth.driver;
  if(!d) return [];
  return STATE.passengers.filter(p => p.assignedDriverId === d.id);
}

function renderTracking(){
  const box = $$("trackingAuthBox");
  const listEl = $$("trackingList");
  const headEl = $$("trackingHeader");
  const logoutBtn = $$("btnLogout");
  const statusEl = $$("authStatus");

  if(!listEl || !headEl) return;

  const u = STATE.auth.user;
  if(!u){
    if(box) box.style.display = "";
    if(logoutBtn) logoutBtn.style.display = "none";
    headEl.innerHTML = '<div class="muted">Ingresá con tu correo para ver tus pasajeros asignados.</div>';
    listEl.innerHTML = "";
    if(statusEl) statusEl.textContent = "";
    if($$("trackingDriverFilter")) { $$("trackingDriverFilter").disabled = true; $$("trackingDriverFilter").innerHTML = '<option value="">(Solo cuando estés logueado)</option>'; }
    return;
  }

  if(box) box.style.display = "";
  if(logoutBtn) logoutBtn.style.display = "";

  const role = STATE.auth.isAdmin ? "Admin" : "Chofer";
  const driverName = STATE.auth.driver ? fullName(STATE.auth.driver) : "-";
  headEl.innerHTML = `
    <div class="rowBetween">
      <div>
        <div><strong>Logueado:</strong> ${escapeHtml(u.email||"")} • <span class="tag">${role}</span></div>
        <div class="muted">${STATE.auth.isAdmin ? "Podés ver todos o filtrar por chofer." : `Chofer: ${escapeHtml(driverName)}`}</div>
      </div>
      <div class="muted">Evento: <strong>${escapeHtml(STATE.eventId)}</strong></div>
    </div>
  `;

  // Fill driver filter for admin
  const df = $$("trackingDriverFilter");
  if(df){
    if(STATE.auth.isAdmin){
      df.disabled = false;
      const current = df.value || "";
      df.innerHTML = '<option value="">Todos los choferes</option>' + STATE.drivers.map(d=>`<option value="${d.id}">${escapeHtml(fullName(d))} • ${escapeHtml(d.email||"")}</option>`).join("");
      df.value = current;
    }else{
      df.disabled = true;
      df.innerHTML = '<option value="">(Solo Admin)</option>';
    }
  }

  const list = visiblePassengersForTracking();
  if(!list.length){
    listEl.innerHTML = '<div class="muted">No hay pasajeros para mostrar.</div>';
    return;
  }

  listEl.innerHTML = list.map(p=>{
    const tr = passengerTracking(p);
    const driver = p.assignedDriverId ? driverById(p.assignedDriverId) : null;
    const editable = canEditPassenger(p);

    const opts = TRACKING_STATUSES.map(s=>`<option value="${escapeHtml(s)}" ${tr.status===s?"selected":""}>${escapeHtml(s)}</option>`).join("");
    return `
      <div class="item" data-track="${p.id}">
        <div class="itemHeader">
          <div>
            <div class="itemTitle">${escapeHtml(fullName(p))}</div>
            <div class="muted">${escapeHtml(p.phone||"")} • ${escapeHtml(p.address||"")} • <span class="tag">${escapeHtml(p.zone||"")}</span></div>
            ${STATE.auth.isAdmin ? `<div class="muted">Chofer: <strong>${driver ? escapeHtml(fullName(driver)) : "-"}</strong></div>` : ""}
          </div>
          <div class="pill">${escapeHtml(tr.status)}</div>
        </div>

        <div class="divider"></div>

        <div class="grid2" style="gap:10px;">
          <div class="field">
            <label>Estado</label>
            <select class="trackStatus" ${editable ? "" : "disabled"}>${opts}</select>
          </div>
          <div class="field">
            <label>Nota</label>
            <input class="trackNote" ${editable ? "" : "disabled"} value="${escapeHtml(tr.note)}" placeholder="Ej: No responde, salió tarde...">
          </div>
        </div>

        <div class="rowBetween" style="margin-top:10px;">
          <div class="muted">${tr.updatedAt ? "Actualizado" : "Sin cambios"}</div>
          <button class="btnSecondary btnSaveTrack" ${editable ? "" : "disabled"}>Guardar</button>
        </div>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll(".item[data-track]").forEach(card=>{
    const pid = card.dataset.track;
    const btn = card.querySelector(".btnSaveTrack");
    const sel = card.querySelector(".trackStatus");
    const note = card.querySelector(".trackNote");
    if(btn){
      btn.addEventListener("click", async ()=>{
        try{
          await updatePassengerTracking(pid, sel.value, note.value);
          await loadPassengers(); // refresh list
          renderTracking();
          toast("Tracking guardado");
        }catch(e){
          alert(e?.message || String(e));
        }
      });
    }
  });
}

async function updatePassengerTracking(passengerId, trackingStatus, trackingNote){
  const passengerRef = doc(db,"passengers", passengerId);

  const status = (trackingStatus||"Pendiente").trim();
  const note = (trackingNote||"").trim();

  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(passengerRef);
    if(!snap.exists()) throw new Error("Pasajero no existe");
    const p = snap.data();

    if(p.eventId !== STATE.eventId) throw new Error("EventId no coincide");

    // permisos lógicos (además de Rules)
    const u = STATE.auth.user;
    if(!u) throw new Error("No autenticado");

    if(!STATE.auth.isAdmin){
      const d = STATE.auth.driver;
      if(!d) throw new Error("No sos chofer válido");
      if(p.assignedDriverId !== d.id) throw new Error("No podés editar pasajeros de otro chofer");
    }

    tx.update(passengerRef, {
      trackingStatus: status,
      trackingNote: note,
      trackingUpdatedAt: serverTimestamp(),
      trackingUpdatedBy: (u.email||"").toLowerCase(),
    });
  });
}

function wireTrackingUI(){
  const statusEl = $$("authStatus");

  if($$("btnGoogleLogin")){
    $$("btnGoogleLogin").addEventListener("click", async ()=>{
      try{
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if(isMobile){
          if(statusEl) statusEl.textContent = "Abriendo login con Google...";
          await signInWithRedirect(auth, provider);
          return;
        }
        await signInWithPopup(auth, provider);
      }catch(e){
        console.warn(e);
        alert(e?.message || String(e));
      }
    });
  }

  if($$("btnLogout")){
    $$("btnLogout").addEventListener("click", async ()=>{
      await signOut(auth);
    });
  }

  if($$("trackingDriverFilter")){
    $$("trackingDriverFilter").addEventListener("change", ()=> renderTracking());
  }
}

function resolveAuthRole(){
  const u = STATE.auth.user;
  if(!u) return;
  const email = (u.email||"").toLowerCase();
  const driver = driverByEmail(email);
  const admin = isAdminEmail(email) || (driver && driver.role === "admin");
  STATE.auth.isAdmin = !!admin;
  STATE.auth.driver = driver || null;
}


/* -------------------- START -------------------- */
(async function init(){
  // 1) Conectar botón de login (si no se llama, el click no hace nada)
  wireTrackingUI();

  // 2) Completar login si vino por redirect (mobile)
  try{ await getRedirectResult(auth); }catch(e){}

  // 3) Cargar eventos
  try{ await loadEvents(); }catch(e){ console.warn("loadEvents failed", e); }

  const saved = localStorage.getItem("selectedEventId");
  const fromInput = $$("eventId") ? $$("eventId").value.trim() : "";
  STATE.eventId = saved || fromInput || STATE.eventId || "event1";

  // Sync UI
  if($$("eventId")) $$("eventId").value = STATE.eventId;
  if($$("eventSelect")) renderEventSelect();

  // 4) Escuchar cambios de login
  onAuthStateChanged(auth, async (user)=>{
    STATE.auth.user = user || null;

    // Si cambia el login, recalculamos rol (admin/chofer)
    try{ await loadDrivers(); }catch(e){}

    if(user){
      resolveAuthRole();
    }else{
      STATE.auth.isAdmin = false;
      STATE.auth.driver = null;
    }

    renderTracking();
  });

  // 5) Cargar todo
  await refreshAll();
  renderTracking();
})();

