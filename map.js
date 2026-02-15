import {
  initCorePage, STATE, $, toast, escapeHtml,
  loadMasterDrivers, loadMasterPassengers,
  loadEventContext, driversInEvent, passengersInEvent,
  getSelectedEventId
} from "./core.js";

let map = null;
let driversLayer = null;
let passengersLayer = null;

let currentFilter = "all"; // all | drivers | passengers

function setActiveFilter(filter){
  currentFilter = filter;

  const all = $("btnShowAll");
  const d = $("btnShowDrivers");
  const p = $("btnShowPassengers");
  [all,d,p].forEach(x => x?.classList.remove("active"));

  if (filter === "all") all?.classList.add("active");
  if (filter === "drivers") d?.classList.add("active");
  if (filter === "passengers") p?.classList.add("active");

  applyFilter();
}

function applyFilter(){
  if (!map) return;

  if (driversLayer) map.removeLayer(driversLayer);
  if (passengersLayer) map.removeLayer(passengersLayer);

  if (currentFilter === "all"){
    driversLayer?.addTo(map);
    passengersLayer?.addTo(map);
  } else if (currentFilter === "drivers"){
    driversLayer?.addTo(map);
  } else if (currentFilter === "passengers"){
    passengersLayer?.addTo(map);
  }
}

/**
 * Ícono grande con contraste (se ve bien sobre mapas claros/amarillos).
 * Usamos HTML inline para no depender de styles.css.
 */
function bubbleIcon({ emoji, bg, border }){
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width:56px;height:56px;border-radius:18px;
        display:flex;align-items:center;justify-content:center;
        background:${bg};
        border:3px solid ${border};
        box-shadow: 0 8px 18px rgba(0,0,0,.35);
        font-size:30px;
        line-height:1;
        transform: translateZ(0);
      ">${emoji}</div>
    `,
    iconSize: [56, 56],
    iconAnchor: [28, 56],     // “apoya” abajo
    popupAnchor: [0, -54]
  });
}

const DRIVER_ICON = bubbleIcon({ emoji: "🚗", bg: "rgba(0,122,255,.95)", border: "rgba(255,255,255,.95)" });
const PASSENGER_ICON = bubbleIcon({ emoji: "🧍", bg: "rgba(168,85,247,.95)", border: "rgba(255,255,255,.95)" });

function pickLatLng(obj){
  const lat = obj?.lat ?? obj?.latitude ?? obj?.location?.lat ?? obj?.geo?.lat;
  const lng = obj?.lng ?? obj?.lon ?? obj?.longitude ?? obj?.location?.lng ?? obj?.geo?.lng ?? obj?.geo?.lon;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return [la, ln];
}

function fullName(x){
  return `${x.lastName||""} ${x.firstName||""}`.trim() || "(sin nombre)";
}

function driverNameById(driverId){
  if (!driverId) return "";
  const d = (STATE.master.drivers || []).find(x => x.id === driverId);
  return d ? `${d.lastName||""} ${d.firstName||""}`.trim() : driverId;
}

function renderStats({driversShown, passengersShown, driversTotal, passengersTotal, missingDrivers, missingPassengers}){
  const el = $("mapStats");
  if (!el) return;
  el.textContent = `Choferes: ${driversShown}/${driversTotal} · Pasajeros: ${passengersShown}/${passengersTotal} · Sin geo: ${missingDrivers + missingPassengers}`;
}

function ensureMap(){
  if (map) return;

  map = L.map("map", { zoomControl: true });
  // Centro Rosario aprox.
  map.setView([-32.9468, -60.6393], 12);

  // Tiles más neutros (si querés, se puede cambiar a Carto light, etc.)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
}

function popupHtml({ title, lines }){
  const safeLines = (lines || []).filter(Boolean).map(x => `<div style="color:#111;opacity:.92;font-size:13px;line-height:1.25;margin-top:4px;">${x}</div>`).join("");
  return `
    <div style="color:#0f172a; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; min-width: 220px;">
      <div style="font-weight:900; font-size:14px; color:#0b1220;">${title}</div>
      ${safeLines}
    </div>
  `;
}

function rebuildLayers(){
  ensureMap();

  if (driversLayer) { map.removeLayer(driversLayer); driversLayer = null; }
  if (passengersLayer) { map.removeLayer(passengersLayer); passengersLayer = null; }

  const drivers = driversInEvent();
  const passengers = passengersInEvent();

  let missingDrivers = 0;
  let missingPassengers = 0;

  driversLayer = L.layerGroup();
  passengersLayer = L.layerGroup();

  const bounds = [];

  for (const d of drivers){
    const ll = pickLatLng(d);
    if (!ll){ missingDrivers++; continue; }
    bounds.push(ll);

    const m = L.marker(ll, { icon: DRIVER_ICON, riseOnHover: true });

    const cap = (d.capacity ?? "");
    const lines = [
      escapeHtml(d.email||""),
      cap !== "" ? `Capacidad: <strong>${escapeHtml(String(cap))}</strong>` : "",
      d.phone ? `Tel: ${escapeHtml(d.phone)}` : ""
    ];

    m.bindPopup(popupHtml({
      title: `🚗 ${escapeHtml(fullName(d))}`,
      lines
    }), { closeButton: true });

    driversLayer.addLayer(m);
  }

  for (const p of passengers){
    const ll = pickLatLng(p);
    if (!ll){ missingPassengers++; continue; }
    bounds.push(ll);

    const meta = p._event || {};
    const phaseId = (STATE.event?.activePhaseId || "ida");
    const assignedId = (meta.assigned && meta.assigned[phaseId]) ? meta.assigned[phaseId] : (phaseId==="ida" ? (meta.assignedDriverId||"") : "");
    const assigned = assignedId ? `Asignado: <strong>${escapeHtml(driverNameById(assignedId))}</strong>` : `No asignado`;
    const status = escapeHtml(meta.trackingStatus || meta.status || "Pendiente");

    const m = L.marker(ll, { icon: PASSENGER_ICON, riseOnHover: true });

    const lines = [
      `Estado: <strong>${status}</strong>`,
      assigned,
      p.phone ? `Tel: ${escapeHtml(p.phone)}` : "",
      p.address ? `Dir: ${escapeHtml(p.address)}` : "",
      p.localidad ? `Loc: ${escapeHtml(p.localidad)}` : ""
    ];

    m.bindPopup(popupHtml({
      title: `🧍 ${escapeHtml(fullName(p))}`,
      lines
    }), { closeButton: true });

    passengersLayer.addLayer(m);
  }

  applyFilter();

  if (bounds.length){
    const b = L.latLngBounds(bounds);
    map.fitBounds(b.pad(0.15));
  } else {
    map.setView([-32.9468, -60.6393], 12);
  }

  renderStats({
    driversShown: drivers.length - missingDrivers,
    passengersShown: passengers.length - missingPassengers,
    driversTotal: drivers.length,
    passengersTotal: passengers.length,
    missingDrivers,
    missingPassengers
  });

  if ((drivers.length + passengers.length) && (bounds.length === 0)){
    toast("No hay coordenadas (lat/lng) para mostrar en el mapa");
  }
}

function wireUI(){
  $("btnShowAll")?.addEventListener("click", () => setActiveFilter("all"));
  $("btnShowDrivers")?.addEventListener("click", () => setActiveFilter("drivers"));
  $("btnShowPassengers")?.addEventListener("click", () => setActiveFilter("passengers"));

  $("btnRefreshMap")?.addEventListener("click", async () => {
    await loadMasterDrivers();
    await loadMasterPassengers();
    await loadEventContext(getSelectedEventId());
    rebuildLayers();
    toast("Mapa actualizado");
  });
}

(async function init(){
  try{
    await initCorePage({ page: "map" });
    if (!STATE.auth.user) return;

    wireUI();
    setActiveFilter("all");

    await loadMasterDrivers();
    await loadMasterPassengers();
    await loadEventContext(getSelectedEventId());

    rebuildLayers();

    document.addEventListener("eventChanged", async () => {
      await loadEventContext(getSelectedEventId());
      rebuildLayers();
    });
  }catch(e){
    console.error("INIT ERROR:", e);
    toast(e.message || String(e));
  }
})();
