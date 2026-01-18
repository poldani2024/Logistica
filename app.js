import { app, db } from "./firebase-init.js";
import { parseCSV } from "./csv.js";

// Auth (Google Login)
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";

const auth = getAuth(app); // ✅ importante: usar el mismo app

// Firestore (SOLO funciones, NO getFirestore)
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";


// Helpers DOM (poner arriba de todo, después de imports)
const $  = (id) => document.getElementById(id);
const $$ = (id) => document.getElementById(id); // compat, tu código usa $$
let AUTH_IN_PROGRESS = false;
const STATE = {
  eventId: null,
  events: [],
  drivers: [],
  passengers: [],
  assignments: [],

  auth: {
    user: null,
    isAdmin: false,
    driver: null
  }
};

function resolveAuthRole(){
  // versión mínima para no romper
  const email = STATE?.auth?.user?.email || "";
  STATE.auth.isAdmin = (email === "pedro.l.oldani@gmail.com");

  // chofer: lo resolvemos si ya está cargada la lista de drivers
  if(STATE.drivers && STATE.drivers.length){
    const e = email.toLowerCase();
    STATE.auth.driver = STATE.drivers.find(d => (d.email||"").toLowerCase() === e) || null;
  }else{
    STATE.auth.driver = null;
  }
}
function canonicalLocalidad(loc){
  const x = norm(loc);

  // aliases típicos
  if(x === "villa g. galvez" || x === "villa g galvez" || x === "villa gálvez") return "villa gobernador gálvez";
  if(x === "vgg") return "villa gobernador gálvez";

  if(x === "roldán") return "roldán";
  if(x === "granadero baigorria") return "granadero baigorria";
  if(x === "pueblo esther") return "pueblo esther";
  if(x === "san lorenzo") return "san lorenzo";
  if(x === "funes") return "funes";
  if(x === "rosario") return "rosario";

  return x; // fallback
}

function pointInViewbox(lat, lng, viewbox){
  // viewbox: "west,north,east,south"
  const [west, north, east, south] = viewbox.split(",").map(Number);
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

async function isWithinSelectedCity(lat, lng, localidad){
  const cityCanonical = canonicalLocalidad((localidad||"").trim());
  const vb = await getCityViewbox(cityCanonical);
  if(!vb) return true; // si no se puede obtener bbox, no bloquees
  return pointInViewbox(lat, lng, vb);
}



let map;
let mapLayer;

function initMapIfNeeded(){
  const el = document.getElementById("map");
  if(!el) return false;              // no hay div
  if(typeof L === "undefined") return false; // Leaflet no cargó
  if(map) return true;               // ya está inicializado

  map = L.map("map").setView([-32.95, -60.66], 11); // Rosario aprox
  mapLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  return true;
}

let mapMarkersLayer = null;
let mapZonesLayer = null;

function renderMap(){
  const el = document.getElementById("map");
  if(!el) return;
  if(typeof L === "undefined") return;

  // init map si no existe
  if(!window._leafletMap){
    window._leafletMap = L.map("map").setView([-32.95, -60.66], 11);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19
    }).addTo(window._leafletMap);
  }

  const map = window._leafletMap;

  // si el mapa estaba oculto y recién se muestra
  setTimeout(() => map.invalidateSize(), 50);

  // limpiar capas anteriores
  if(mapMarkersLayer) map.removeLayer(mapMarkersLayer);
  if(mapZonesLayer) map.removeLayer(mapZonesLayer);

  mapMarkersLayer = L.layerGroup().addTo(map);
  mapZonesLayer = L.layerGroup().addTo(map);

  // -------------------- ZONAS (rectángulos simples) --------------------
  // Ajustá límites si querés después, pero esto te vuelve a mostrar "zonas"
  const zones = [
    { name:"Centro",  bounds:[[-32.99,-60.72],[-32.93,-60.62]] },
    { name:"Norte",   bounds:[[-32.93,-60.72],[-32.86,-60.62]] },
    { name:"Sur",     bounds:[[-33.05,-60.72],[-32.99,-60.62]] },
    { name:"Oeste",   bounds:[[-33.05,-60.82],[-32.86,-60.72]] },
    { name:"Este",    bounds:[[-33.05,-60.62],[-32.86,-60.55]] },
  ];

  zones.forEach(z=>{
    const rect = L.rectangle(z.bounds, {
      weight: 1,
      fillOpacity: 0.05
    }).addTo(mapZonesLayer);
    rect.bindTooltip(z.name, { permanent:false, direction:"center" });
  });

  // -------------------- MARCADORES: PASAJEROS --------------------
  // Rojo: sin chofer asignado
  // Verde: con chofer asignado

  const assignments = STATE.assignments || [];
  const assignedPassengerIds = new Set(assignments.map(a => a.passengerId));
  const zoneFilter = ($("mapZoneFilter")?.value || "").trim();
  const show = ($("mapShow")?.value || "all");
  
 if(show === "all" || show === "passengers"){
  (STATE.passengers || []).forEach(p=>{
    if(p.lat == null || p.lng == null) return;

    const isAssigned = assignedPassengerIds.has(p.id);

    const marker = L.circleMarker([p.lat, p.lng], {
      radius: 7,
      weight: 2,
      fillOpacity: 0.8,
      // Leaflet no acepta "color names" como lógica de negocio, pero sí strings CSS
      color: isAssigned ? "green" : "red",
      fillColor: isAssigned ? "green" : "red",
    }).addTo(mapMarkersLayer);

    marker.bindPopup(`
      <b>Pasajero</b><br/>
      ${escapeHtml(p.firstName || "")} ${escapeHtml(p.lastName || "")}<br/>
      ${escapeHtml(p.address || "")}<br/>
      ${escapeHtml(p.localidad || "")}<br/>
      ${escapeHtml(p.phone || "")}
    `);
  });
  }
  // -------------------- MARCADORES: CHOFERES --------------------
 if(show === "all" || show === "drivers"){
  (STATE.drivers || []).forEach(d=>{
    if(d.lat == null || d.lng == null) return;

    const marker = L.marker([d.lat, d.lng]).addTo(mapMarkersLayer);

    marker.bindPopup(`
      <b>Chofer</b><br/>
      ${escapeHtml(d.firstName || "")} ${escapeHtml(d.lastName || "")}<br/>
      ${escapeHtml(d.address || "")}<br/>
      ${escapeHtml(d.localidad || "")}<br/>
      ${escapeHtml(d.phone || "")}
    `);
  });
}
}




let _toastTimer = null;

function toast(msg){
  const t = $("toast");
  if(!t){
    const el = $("copyHint");
    if(el){ el.textContent = msg; setTimeout(()=> el.textContent="", 2200); }
    else alert(msg);
    return;
  }

  t.textContent = msg;
  t.classList.add("show");

  if(_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=>{
    t.classList.remove("show");
    t.textContent = "";
  }, 2200);
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
    // ✅ FIX MAPA (esto es lo único nuevo)
    if(view === "map"){
      setTimeout(() => {
        renderMap();
      }, 0);
    }
  });
});
/* -------------------- EVENT ID -------------------- */
{
  const btn = $("btnSetEvent");
  if (btn) {
    btn.addEventListener("click", async () => {
      const v = ($("eventId")?.value || "").trim();
      STATE.eventId = v || null;
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
  if(typeof renderTracking==="function") renderTracking(); // ✅ AGREGAR
}

$("btnRefreshDashboard").addEventListener("click", refreshAll);
$("btnRefreshDrivers").addEventListener("click", loadDriversAndRender);
$("btnRefreshPassengers").addEventListener("click", loadPassengersAndRender);
$("btnRefreshAssignments").addEventListener("click", loadAssignmentsAndRender);
// -------------------- MAP UI --------------------
$("btnRefreshMap")?.addEventListener("click", renderMap);
$("mapZoneFilter")?.addEventListener("change", renderMap);
$("mapShow")?.addEventListener("change", renderMap);

async function loadDriversAndRender(){ await loadDrivers(); renderZones(); renderDriversTable(); renderDashboard(); }
async function loadPassengersAndRender(){ await loadPassengers(); renderZones(); renderPassengersTable(); renderDashboard(); }
async function loadAssignmentsAndRender(){ await loadAssignments(); renderAssignments(); renderDashboard(); }

// -------------------- EVENTS --------------------
async function loadEvents(){
  const snap = await getDocs(query(collection(db, "events")));
  const arr = [];
  snap.forEach(d => {
    const data = d.data() || {};
    arr.push({ id: d.id, ...data });
  });
  arr.sort((a,b)=> (a.id||"").localeCompare(b.id||""));
  STATE.events = arr;
  return arr;
}

function renderEventSelect(){
  const sel = $$("eventSelect");
  if(!sel) return;

  sel.innerHTML = (STATE.events || []).map(ev => {
    const label = ev.name ? `${ev.id} — ${ev.name}` : ev.id;
    return `<option value="${escapeHtml(ev.id)}">${escapeHtml(label)}</option>`;
  }).join("") || `<option value="">(sin eventos)</option>`;

  if (STATE.eventId) sel.value = STATE.eventId;
}

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
    $("mapZoneFilter"), // ✅ NUEVO
  ];
  selects.forEach(sel=>{
    if(!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">Todas las zonas</option>` +
      zones.map(z=>`<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join("");
    sel.value = current;
  });
}


function escapeHtml(s){
  return (s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

function norm(s){ return String(s||"").trim().toLowerCase(); }

// Cache simple para no pedir el bbox todo el tiempo
const CITY_BBOX_CACHE = new Map();

// Devuelve viewbox "left,top,right,bottom" para una ciudad (Santa Fe, AR)
async function getCityViewbox(city){
  const key = norm(city);
  if(CITY_BBOX_CACHE.has(key)) return CITY_BBOX_CACHE.get(key);

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "ar");
  url.searchParams.set("city", city);
  url.searchParams.set("state", "Santa Fe");

  const res = await fetch(url.toString(), { headers: { "Accept":"application/json" }});
  if(!res.ok) throw new Error(`City bbox HTTP ${res.status}`);
  const data = await res.json();
  if(!data.length || !data[0].boundingbox) return null;

  // boundingbox viene como [south_lat, north_lat, west_lon, east_lon]
  const bb = data[0].boundingbox.map(Number);
  const south = bb[0], north = bb[1], west = bb[2], east = bb[3];

  // viewbox = left,top,right,bottom (lon,lat,lon,lat)
  const viewbox = `${west},${north},${east},${south}`;
  CITY_BBOX_CACHE.set(key, viewbox);
  return viewbox;
}

function pickCityFromAddress(r){
  const a = r.address || {};
  return (a.city || a.town || a.village || a.municipality || a.county || "").trim();
}

async function geocodeOSM(address, localidad){
  const city = (localidad || "").trim();
  const cityCanonical = canonicalLocalidad(city); // <- normalizado

  if(!address || !city) return null;

  const viewbox = await getCityViewbox(cityCanonical);

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "ar");
  url.searchParams.set("q", `${address}, ${cityCanonical}, Santa Fe, Argentina`);

  // ✅ si conseguimos viewbox de la ciudad, encerramos la búsqueda
  if(viewbox){
    url.searchParams.set("viewbox", viewbox);
    url.searchParams.set("bounded", "1");
  }

  const res = await fetch(url.toString(), { headers: { "Accept":"application/json" }});
  if(!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const data = await res.json();
  if(!data.length) return null;

  // ✅ elegimos el primer resultado que coincide con la ciudad target
  const target = norm(cityCanonical);
  let best = null;

  for(const r of data){
    const got = norm(pickCityFromAddress(r));
    if(got && got === target){ best = r; break; }
  }
  if(!best) best = data[0]; // fallback (igual lo vamos a validar luego)

  const geoCity = pickCityFromAddress(best);
  return {
    lat: Number(best.lat),
    lng: Number(best.lon),
    geoLabel: best.display_name || "",
    geoCity,
    geoCodeQuery: `${address}, ${cityCanonical}, Santa Fe, Argentina`
  };
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
  const d = driver || {
    firstName:"", lastName:"", phone:"",
    address:"", localidad:"Rosario",
    zone:"", capacity:4, active:true
  };

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

        <div class="field">
          <label>Dirección</label>
          <input id="d_address" value="${escapeHtml(d.address || "")}" placeholder="Ej: Pellegrini 1234">
        </div>

        <div class="field">
          <label>Localidad</label>
          <select id="d_localidad">
            ${["Rosario","Funes","Roldán","San Lorenzo","Pueblo Esther","Granadero Baigorria","Villa G. Galvez"]
              .map(l => `<option value="${l}" ${d.localidad===l ? "selected" : ""}>${l}</option>`)
              .join("")}
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
  try{
    const payload = {
      firstName: $("d_firstName").value.trim(),
      lastName: $("d_lastName").value.trim(),
      phone: $("d_phone").value.trim(),
      address: $("d_address").value.trim(),
      localidad: $("d_localidad").value,
      zone: $("d_zone").value.trim(),
      capacity: Number($("d_capacity").value || 4),
      active: true,
      eventId: STATE.eventId,
      updatedAt: serverTimestamp(),
    };

    const newAddress = payload.address;       // ya lo tenés en payload
    const newLocalidad = payload.localidad;

    const changed =
      isNew ||
      norm(newAddress) !== norm(driver?.address) ||
      norm(newLocalidad) !== norm(driver?.localidad) ||
      driver?.lat == null || driver?.lng == null;

    if(changed && newAddress && newLocalidad){
      const geo = await geocodeOSM(newAddress, newLocalidad);
      if(geo){
        const target = canonicalLocalidad(newLocalidad);
        const got = canonicalLocalidad(geo.geoCity);
        const ok = await isWithinSelectedCity(geo.lat, geo.lng, newLocalidad);

        if(!ok){
          toast(`Geocoding rechazado: el punto cae fuera de ${newLocalidad}`);
        }else{
          payload.lat = geo.lat;
          payload.lng = geo.lng;
          payload.geoLabel = geo.geoLabel;
          payload.geoCity = geo.geoCity;
          payload.geoCodeQuery = geo.geoCodeQuery;
        }

      }
    }

    if(isNew){
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db,"drivers"), payload);
      toast("Chofer creado");
    }else{
      await updateDoc(doc(db,"drivers",driver.id), payload);
      toast("Chofer guardado");
    }

    await loadDriversAndRender();
  }catch(e){
    console.error(e);
    toast("Error al guardar chofer");
    alert(e?.message || String(e));
  }
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
  await setPersistence(auth, browserLocalPersistence);
  // Finish redirect login (mobile)
  try{ await getRedirectResult(auth); }catch(e){ console.warn("getRedirectResult:", e?.message || e);}

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

    
    if (STATE.events && STATE.events.length) {
      const saved = localStorage.getItem("selectedEventId");
    
      const found = saved
        ? STATE.events.find(e => e.id === saved)
        : null;
    
      STATE.eventId = found
        ? found.id
        : STATE.events[0].id;
    }

    if($$("eventSelect")) renderEventSelect();
    // ✅ PASO 3: cuando cambio el evento desde el dropdown
    if ($$("eventSelect")) {
      $$("eventSelect").addEventListener("change", async () => {
        const id = $$("eventSelect").value;
        if (!id) return;
    
        STATE.eventId = id;
        localStorage.setItem("selectedEventId", id);
    
        await refreshAll();
        if(typeof renderTracking==="function") renderTracking();
        toast("Evento cambiado");
      });
    }


    
    // Cargar TODO primero
      await refreshAll();
      
      // Recién ahora resolver rol (chofer/admin)
      resolveAuthRole();
      renderAuthBar();
      
      // ⚠️ clave: forzar render tracking ahora que hay datos
      if(typeof renderTracking === "function") {
        renderTracking();
      }

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
function isInAppBrowser(){
  const ua = navigator.userAgent || "";
  return /Instagram|FBAN|FBAV|FBIOS|FB_IAB|Line|Twitter|TikTok|Snapchat/i.test(ua);
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

  try{
    // ✅ intentar popup primero (inclusive en mobile)
    await signInWithPopup(auth, provider);
    return;
  }catch(e){
    const code = e?.code || "";
    const msg = String(e?.message || "");

    // Si popup está bloqueado/cancelado, probamos redirect
    const popupRelated =
      code === "auth/popup-blocked" ||
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request";

    if(!popupRelated){
      // otro error: lo mostramos
      toast(msg);
      throw e;
    }
  }

  // Fallback redirect
  try{
    await signInWithRedirect(auth, provider);
  }catch(e){
    const msg = String(e?.message || "");
    // ✅ caso que vos tenés
    if(msg.includes("missing initial state")){
      alert(
        "En algunos celulares el login falla por restricciones del navegador.\n\n" +
        "Solución: activá 'Sitio de escritorio' (desktop site) e intentá de nuevo, " +
        "o abrí esta página en Chrome/Safari."
      );
      return;
    }
    toast(msg);
    throw e;
  }
}





function wireGlobalAuthUI(){
    // Tracking login button
  if($$("btnGoogleLogin")){
    $$("btnGoogleLogin").addEventListener("click", async ()=>{
      try{
        await doGoogleLogin();
      }catch(e){
        console.warn(e);
        toast(e?.message || String(e));
      }
    });
  }

  // Tracking logout button
  if($$("btnLogout")){
    $$("btnLogout").addEventListener("click", async ()=>{
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
function getAssignedPassengersForDriver(driverId){
  const a = driverAssignment(driverId);
  const ids = a?.passengerIds || [];
  return ids.map(pid => passengerById(pid)).filter(Boolean);
}

function trackingStatusLabel(s){
  switch((s||"").toLowerCase()){
    case "pending": return "Pendiente";
    case "transit": return "En tránsito";
    case "arrived": return "En destino";
    case "absent": return "Ausente";
    default: return "Pendiente";
  }
}

function renderTracking(){
  // elementos
  const authBox = $("trackingAuthBox");
  const statusEl = $("authStatus");
  const listEl = $("trackingList");
  const headerEl = $("trackingHeader");
  const filterSel = $("trackingDriverFilter");
  const btnLogout = $("btnLogout");

  if(!listEl || !filterSel || !statusEl || !headerEl) return;

  const user = STATE?.auth?.user || null;
  const isAdmin = !!STATE?.auth?.isAdmin;
  const myDriver = STATE?.auth?.driver || null;

  // UI auth state
  if(!user){
    statusEl.textContent = "No estás logueado.";
    if(authBox) authBox.style.display = "grid";
    if(btnLogout) btnLogout.style.display = "none";
    filterSel.disabled = true;
    filterSel.innerHTML = `<option value="">(Solo cuando estés logueado)</option>`;
    headerEl.textContent = "";
    listEl.innerHTML = `<div class="muted">Ingresá para ver el tracking.</div>`;
    return;
  }

  statusEl.textContent = `Logueado: ${user.email || "(sin email)"} • ${isAdmin ? "Admin" : (myDriver ? "Chofer" : "Usuario")}`;
  if(btnLogout) btnLogout.style.display = "inline-block";

  // Si es admin, arma filtro de chofer; si es chofer, lo deja fijo
  if(isAdmin){
    filterSel.disabled = false;
    const current = filterSel.value || "";
    filterSel.innerHTML =
      `<option value="">(Todos los choferes)</option>` +
      STATE.drivers.map(d => `<option value="${d.id}">${escapeHtml(fullName(d))}</option>`).join("");
    filterSel.value = current;
  }else{
    filterSel.disabled = true;
    if(myDriver){
      filterSel.innerHTML = `<option value="${myDriver.id}">${escapeHtml(fullName(myDriver))}</option>`;
      filterSel.value = myDriver.id;
    }else{
      filterSel.innerHTML = `<option value="">(Tu correo no coincide con ningún chofer)</option>`;
      filterSel.value = "";
    }
  }

  // Determinar qué chofer(es) se muestran
  const selectedDriverId = (isAdmin ? (filterSel.value || "") : (myDriver?.id || ""));
  let driversToShow = [];

  if(isAdmin){
    driversToShow = selectedDriverId ? [driverById(selectedDriverId)].filter(Boolean) : [...STATE.drivers];
  }else{
    driversToShow = selectedDriverId ? [driverById(selectedDriverId)].filter(Boolean) : [];
  }

  // Render
  if(!driversToShow.length){
    headerEl.textContent = "No hay chofer seleccionado / disponible.";
    listEl.innerHTML = `<div class="muted">Si sos chofer, tu email debe estar cargado en el chofer.</div>`;
    return;
  }

  const totalPassengers = driversToShow.reduce((acc,d)=> acc + getAssignedPassengersForDriver(d.id).length, 0);
  headerEl.textContent = `${driversToShow.length === 1 ? "Chofer" : "Choferes"}: ${driversToShow.length} • Pasajeros: ${totalPassengers}`;

  const canEdit = !!myDriver && !isAdmin ? true : isAdmin; // admin puede editar si querés; si no, cambiá a false

  listEl.innerHTML = driversToShow.map(d=>{
    const ps = getAssignedPassengersForDriver(d.id);

    return `
      <div class="item" style="padding:12px;">
        <div style="font-weight:700;">${escapeHtml(fullName(d))}</div>
        <div class="muted">${escapeHtml(d.phone||"")}</div>
        <div class="divider" style="margin:10px 0;"></div>

        ${ps.length ? ps.map(p=>{
          const st = (p.trackStatus || "pending");
          const cm = (p.trackComment || "");
          return `
            <div class="card" style="margin:10px 0; padding:12px;">
              <div style="font-weight:700;">${escapeHtml(fullName(p))}</div>
              <div class="muted">${escapeHtml(p.phone||"")} • ${escapeHtml(p.address||"")} • ${escapeHtml(p.localidad||"")}</div>

              <div class="grid2" style="margin-top:10px;">
                <div class="field">
                  <label>Estado</label>
                  <select data-track-status="${p.id}" ${canEdit ? "" : "disabled"}>
                    <option value="pending"  ${st==="pending"?"selected":""}>Pendiente</option>
                    <option value="transit"  ${st==="transit"?"selected":""}>En tránsito</option>
                    <option value="arrived"  ${st==="arrived"?"selected":""}>En destino</option>
                    <option value="absent"   ${st==="absent"?"selected":""}>Ausente</option>
                  </select>
                </div>
                <div class="field">
                  <label>Comentario</label>
                  <input data-track-comment="${p.id}" value="${escapeHtml(cm)}" ${canEdit ? "" : "disabled"} />
                </div>
              </div>

              <div class="actions" style="margin-top:10px;">
                <button class="btnSecondary" data-track-save="${p.id}" ${canEdit ? "" : "disabled"}>
                  Guardar tracking
                </button>
                <span class="muted" data-track-hint="${p.id}"></span>
              </div>
            </div>
          `;
        }).join("") : `<div class="muted">Sin pasajeros asignados.</div>`}
      </div>
    `;
  }).join("");

  // Wire saves
  listEl.querySelectorAll("button[data-track-save]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const pid = btn.dataset.trackSave;
      const sel = listEl.querySelector(`select[data-track-status="${pid}"]`);
      const inp = listEl.querySelector(`input[data-track-comment="${pid}"]`);
      const hint = listEl.querySelector(`span[data-track-hint="${pid}"]`);

      try{
        const payload = {
          trackStatus: sel?.value || "pending",
          trackComment: inp?.value?.trim() || "",
          trackUpdatedAt: serverTimestamp(),
          trackUpdatedBy: (STATE.auth.user?.email || ""),
          updatedAt: serverTimestamp()
        };
        await updateDoc(doc(db, "passengers", pid), payload);

        if(hint) hint.textContent = "Guardado ✅";
        // refrescar memoria local para que quede consistente
        const p = passengerById(pid);
        if(p){
          p.trackStatus = payload.trackStatus;
          p.trackComment = payload.trackComment;
        }
      }catch(e){
        console.error(e);
        if(hint) hint.textContent = "Error ❌";
        alert(e?.message || String(e));
      }
    });
  });

  // Wire filter change (admin)
  if(isAdmin){
    filterSel.onchange = () => renderTracking();
  }
}

