import {
db } from "./firebase-init.js";
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

function driverByEmail(email){
  const e = String(email||"").trim().toLowerCase();
  if(!e) return null;
  return (STATE.drivers||[]).find(d => String(d.email||"").trim().toLowerCase() === e) || null;
}


const $ = (id) => document.getElementById(id);
const $$ = (id) => document.getElementById(id);


const auth = getAuth();

// Admin allowlist (emails en minúscula). Podés editar esta lista.
const ADMIN_EMAILS = [
  "pedro.l.oldani@gmail.com",
];

function isAdminEmail(email){
  const e = String(email||"").trim().toLowerCase();
  return !!e && ADMIN_EMAILS.map(x=>String(x).trim().toLowerCase()).includes(e);
}



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
  if(typeof MAP === "undefined") return;

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
  if(typeof MAP === "undefined") return;

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



async function refreshAll(){
  // Central refresh: loads collections for current event and re-renders views
  if(STATE.eventId && typeof localStorage !== "undefined"){
    localStorage.setItem("selectedEventId", STATE.eventId);
  }

  if(typeof loadDrivers === "function") await loadDrivers();
  if(typeof loadPassengers === "function") await loadPassengers();
  if(typeof loadAssignments === "function") await loadAssignments();

  if(typeof renderZones === "function") renderZones();
  if(typeof renderDrivers === "function") renderDrivers();
  if(typeof renderPassengers === "function") renderPassengers();
  if(typeof renderAssignments === "function") renderAssignments();
  if(typeof renderDashboard === "function") renderDashboard();
  if(typeof renderTracking === "function") renderTracking();
  if(typeof renderMap === "function" && typeof MAP !== "undefined") renderMap();
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

function renderEventDetailForm(ev){
  const isNew = !ev;
  const e = ev || { id:"", name:"", date:"", domicilioEvento:"", localidadEvento:"Rosario", lat:null, lng:null };

  const box = $$("eventDetail");
  if(!box) return;

  box.innerHTML = `
    <div class="card" style="margin-top:10px;">
      <div class="cardTitle">${isNew ? "Nuevo evento" : "Editar evento"}</div>
      <div class="muted">Destino del viaje: “Domicilio Evento”.</div>

      <div class="grid2" style="margin-top:10px;">
        <div>
          <div class="field"><label>Event ID</label>
            <input id="ev_id" value="${escapeHtml(e.id||"")}" ${isNew? "" : "disabled"} placeholder="Ej: Jovenes17-01-26">
          </div>
          <div class="field"><label>Nombre</label>
            <input id="ev_name" value="${escapeHtml(e.name||"")}" placeholder="Ej: Jóvenes Rosario">
          </div>
          <div class="field"><label>Fecha (texto)</label>
            <input id="ev_date" value="${escapeHtml(e.date||"")}" placeholder="Ej: 2026-01-17">
          </div>
        </div>

        <div>
          <div class="field"><label>Domicilio Evento (Destino)</label>
            <input id="ev_address" value="${escapeHtml(e.domicilioEvento||"")}" placeholder="Ej: Calle y número del lugar del evento">
          </div>
          <div class="field"><label>Localidad Evento</label>
            <select id="ev_localidad">
              ${LOCALIDADES.map(l=>`<option value="${l}" ${((e.localidadEvento||"Rosario")===l)?"selected":""}>${l}</option>`).join("")}
            </select>
          </div>
          <div class="muted">Coordenadas: ${e.lat && e.lng ? `${e.lat}, ${e.lng}` : "(sin geocodificar)"}</div>
        </div>
      </div>

      <div class="actions" style="margin-top:10px;">
        <button class="btn" id="btnSaveEvent">${isNew ? "Crear evento" : "Guardar cambios"}</button>
        ${isNew ? "" : `<button class="btnDanger" id="btnDeleteEvent">Eliminar evento</button>`}
        <button class="btnSecondary" id="btnGeocodeEvent">Geocodificar domicilio</button>
      </div>
      <div class="muted" id="eventFormHint"></div>
    </div>
  `;

  $$("btnGeocodeEvent").addEventListener("click", async ()=>{
    const addr = ($$("ev_address").value||"").trim();
    const loc = ($$("ev_localidad").value||"Rosario").trim();
    if(!addr){ alert("Completá el domicilio del evento."); return; }
    const q = `${addr}, ${loc}, Santa Fe, Argentina`;
    const hint = $$("eventFormHint");
    if(hint) hint.textContent = "Geocodificando...";
    const geo = await geocodeQuery(q);
    if(!geo){
      if(hint) hint.textContent = "No se pudo geocodificar.";
      alert("No se pudo geocodificar ese domicilio.");
      return;
    }
    if(hint) hint.textContent = `OK: ${geo.lat}, ${geo.lng}`;
    renderEventDetailForm({ ...e, domicilioEvento: addr, localidadEvento: loc, lat: geo.lat, lng: geo.lng });
  });

  $$("btnSaveEvent").addEventListener("click", async ()=>{
    const id = ($$("ev_id").value||"").trim();
    if(isNew && !id){ alert("Event ID requerido"); return; }

    const payload = {
      name: ($$("ev_name").value||"").trim(),
      date: ($$("ev_date").value||"").trim(),
      domicilioEvento: ($$("ev_address").value||"").trim(),
      localidadEvento: ($$("ev_localidad").value||"Rosario").trim(),
      updatedAt: serverTimestamp(),
    };

    if(payload.domicilioEvento){
      const q = `${payload.domicilioEvento}, ${payload.localidadEvento}, Santa Fe, Argentina`;
      const geo = await geocodeQuery(q);
      if(geo){
        payload.lat = geo.lat;
        payload.lng = geo.lng;
        payload.geocodedQuery = q;
        payload.geocodedAt = serverTimestamp();
      }
    }

    if(isNew){
      payload.createdAt = serverTimestamp();
      await setDoc(doc(db,"events", id), payload);
      toast("Evento creado");
    }else{
      await updateDoc(doc(db,"events", e.id), payload);
      toast("Evento guardado");
    }

    await loadEvents();
    await refreshAll();
    const ev2 = STATE.events.find(x=>x.id===STATE.eventId) || null;
    if(ev2) renderEventDetailForm(ev2);
  });

  if(!isNew){
    $$("btnDeleteEvent").addEventListener("click", async ()=>{
      if(!confirm("¿Eliminar evento?")) return;
      await deleteDoc(doc(db,"events", e.id));
      toast("Evento eliminado");
      await loadEvents();
      await refreshAll();
      box.innerHTML = "Seleccioná un evento o creá uno nuevo.";
    });
  }
}


function haversineKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const toRad = (d)=> d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function hasLatLng(x){
  return x && typeof x.lat === "number" && typeof x.lng === "number" && !isNaN(x.lat) && !isNaN(x.lng);
}


function getEventDestination(){
  const ev = STATE.events.find(e=>e.id===STATE.eventId);
  if(!ev) return null;
  if(typeof ev.lat === "number" && typeof ev.lng === "number") return { lat: ev.lat, lng: ev.lng, domicilioEvento: ev.domicilioEvento||"", localidadEvento: ev.localidadEvento||"" };
  return null;
}


function optimizeAssignments(){
  // Returns a plan: [{passengerId, driverId, costKm, d1Km, d2Km}]
  const dest = getEventDestination();
  if(!dest) return { ok:false, reason:"El evento no tiene coordenadas (geocodificá el domicilio del evento)." };

  const drivers = STATE.drivers
    .filter(d => hasLatLng(d))
    .map(d => ({...d, cap: Number(d.capacity)||4, used: assignedCount(d.id)}))
    .filter(d => d.used < d.cap);

  const passengers = STATE.passengers
    .filter(p => (p.status !== "assigned" || !p.assignedDriverId)) // pendientes
    .filter(p => hasLatLng(p));

  if(!drivers.length) return { ok:false, reason:"No hay choferes con coordenadas (lat/lng). Geocodificá los choferes." };
  if(!passengers.length) return { ok:false, reason:"No hay pasajeros pendientes con coordenadas. Geocodificá los jóvenes." };

  // Build cost matrix
  const pairs = [];
  passengers.forEach(p=>{
    drivers.forEach(d=>{
      // optional hard constraints: if both have localidad and differ a lot, we could penalize; keep simple
      const d1 = haversineKm(d.lat, d.lng, p.lat, p.lng);
      const d2 = haversineKm(p.lat, p.lng, dest.lat, dest.lng);
      const cost = d1 + d2;
      pairs.push({ passengerId:p.id, driverId:d.id, costKm:cost, d1Km:d1, d2Km:d2 });
    });
  });

  // Greedy assignment: sort by cost ascending, pick if both available.
  pairs.sort((a,b)=>a.costKm - b.costKm);

  const driverRemaining = new Map(drivers.map(d=>[d.id, d.cap - d.used]));
  const passengerAssigned = new Set();
  const plan = [];

  for(const pair of pairs){
    if(passengerAssigned.has(pair.passengerId)) continue;
    const rem = driverRemaining.get(pair.driverId) || 0;
    if(rem <= 0) continue;

    passengerAssigned.add(pair.passengerId);
    driverRemaining.set(pair.driverId, rem-1);
    plan.push(pair);
  }

  // Some passengers may remain unassigned due to capacity
  const unassigned = passengers.filter(p=>!passengerAssigned.has(p.id)).map(p=>p.id);

  const totalKm = plan.reduce((s,x)=>s+x.costKm,0);
  return { ok:true, plan, totalKm, dest, unassignedCount: unassigned.length, considered:{drivers:drivers.length, passengers:passengers.length} };
}

function renderOptimizationResult(res){
  const el = $$("optResult");
  if(!el) return;

  if(!res || !res.ok){
    el.innerHTML = `<div class="card"><div class="cardTitle">Optimización</div><div class="muted">${escapeHtml(res?.reason || "Sin resultado")}</div></div>`;
    return;
  }

  // Group by driver
  const byDriver = new Map();
  res.plan.forEach(x=>{
    if(!byDriver.has(x.driverId)) byDriver.set(x.driverId, []);
    byDriver.get(x.driverId).push(x);
  });

  const rows = [];
  byDriver.forEach((items, driverId)=>{
    const d = driverById(driverId);
    const name = d ? fullName(d) : driverId;
    const subtotal = items.reduce((s,i)=>s+i.costKm,0);
    rows.push(`<div class="card" style="margin-top:10px;">
      <div class="cardTitle">Chofer: ${escapeHtml(name)} <span class="muted">(${items.length} pasajeros • ${subtotal.toFixed(1)} km)</span></div>
      <div class="tableWrap">
        <table class="table">
          <thead><tr><th>Pasajero</th><th>Origen→Pasajero</th><th>Pasajero→Evento</th><th>Total</th></tr></thead>
          <tbody>
            ${items.map(i=>{
              const p = passengerById(i.passengerId);
              return `<tr>
                <td>${p ? escapeHtml(fullName(p)) : i.passengerId}</td>
                <td>${i.d1Km.toFixed(1)} km</td>
                <td>${i.d2Km.toFixed(1)} km</td>
                <td><strong>${i.costKm.toFixed(1)} km</strong></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`);
  });

  el.innerHTML = `
    <div class="card" style="margin-top:12px;">
      <div class="cardTitle">Optimización de rutas</div>
      <div class="muted">
        Evento destino: ${escapeHtml(res.dest.domicilioEvento||"")} (${escapeHtml(res.dest.localidadEvento||"")})<br/>
        Choferes considerados: ${res.considered.drivers} • Pasajeros pendientes considerados: ${res.considered.passengers}<br/>
        Asignaciones propuestas: <strong>${res.plan.length}</strong> • Total aprox: <strong>${res.totalKm.toFixed(1)} km</strong>
        ${res.unassignedCount ? `<br/>Quedaron sin asignar por capacidad: <strong>${res.unassignedCount}</strong>` : ""}
      </div>
      <div class="actions" style="margin-top:10px;">
        <button class="btn" id="btnApplyOptimization">Aplicar asignación</button>
      </div>
    </div>
    ${rows.join("")}
  `;

  $$("btnApplyOptimization").addEventListener("click", async ()=>{
    if(!confirm("¿Aplicar estas asignaciones? Esto asignará pasajeros pendientes a choferes.")) return;
    try{
      await applyOptimizationPlan(res.plan);
      toast("Asignación aplicada");
      await refreshAll();
      // rerun preview
      const again = optimizeAssignments();
      STATE.optimization.plan = again;
      renderOptimizationResult(again);
    }catch(e){
      console.warn(e);
      alert(e?.message || String(e));
    }
  });
}

async function applyOptimizationPlan(plan){
  // Apply using existing assignPassenger logic (transaction safe)
  for(const item of plan){
    await assignPassenger(item.passengerId, item.driverId);
  }
}

// -------------------- EVENTS --------------------
async function loadEvents(){
  // Loads events list into STATE.events (id, name, domicilioEvento, localidadEvento, lat/lng)
  try{
    const q = query(collection(db,"events"));
    const snap = await getDocs(q);
    const arr = [];
    snap.forEach(docu=>{
      const d = docu.data() || {};
      arr.push({
        id: docu.id,
        ...d
      });
    });
    // Sort by id for stable dropdown
    arr.sort((a,b)=> (a.id||"").localeCompare(b.id||""));
    STATE.events = arr;
    if($$("eventSelect")) renderEventSelect();
    return arr;
  }catch(e){
    console.warn("loadEvents failed", e);
    throw e;
  }
}

function renderEventSelect(){
  const sel = $$("eventSelect");
  if(!sel) return;
  const current = STATE.eventId || "";

  const esc = (s)=>{
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  };

  sel.innerHTML = (STATE.events||[]).map(ev=>{
    const label = ev.name ? `${ev.id} — ${ev.name}` : ev.id;
    return `<option value="${esc(ev.id)}">${esc(label)}</option>`;
  }).join("") || `<option value="">(sin eventos)</option>`;

  sel.value = current;
}



