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
    if (driversLayer) driversLayer.addTo(map);
    if (passengersLayer) passengersLayer.addTo(map);
  } else if (currentFilter === "drivers"){
    if (driversLayer) driversLayer.addTo(map);
  } else if (currentFilter === "passengers"){
    if (passengersLayer) passengersLayer.addTo(map);
  }
}

function divEmojiIcon(emoji){
  return L.divIcon({
    className: "",
    html: `<div class="emojiIcon">${emoji}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -10]
  });
}

function pickLatLng(obj){
  // Soporta varias formas comunes:
  // - obj.lat / obj.lng
  // - obj.latitude / obj.longitude
  // - obj.location = { lat, lng }
  // - obj.geo = { lat, lng }
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

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
}

function rebuildLayers(){
  ensureMap();

  // borrar layers previos
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
    const m = L.marker(ll, { icon: divEmojiIcon("🚗") });
    const cap = d.capacity ?? "";
    const phone = d.phone ? `<div class="subtitle">${escapeHtml(d.phone)}</div>` : "";
    m.bindPopup(`
      <div style="font-weight:800;">🚗 ${escapeHtml(fullName(d))}</div>
      <div class="subtitle">${escapeHtml(d.email||"")}${cap!=="" ? " · Cap: " + escapeHtml(String(cap)) : ""}</div>
      ${phone}
    `);
    driversLayer.addLayer(m);
  }

  for (const p of passengers){
    const ll = pickLatLng(p);
    if (!ll){ missingPassengers++; continue; }
    bounds.push(ll);

    const meta = p._event || {};
    const assigned = meta.assignedDriverId ? `<div class="subtitle">Asignado: ${escapeHtml(meta.assignedDriverId)}</div>` : `<div class="subtitle">No asignado</div>`;
    const status = meta.trackingStatus || meta.status || "Pendiente";

    const m = L.marker(ll, { icon: divEmojiIcon("🧍") });
    m.bindPopup(`
      <div style="font-weight:800;">🧍 ${escapeHtml(fullName(p))}</div>
      <div class="subtitle">${escapeHtml(status)}</div>
      ${assigned}
      ${p.phone ? `<div class="subtitle">${escapeHtml(p.phone)}</div>` : ""}
      ${p.address ? `<div class="subtitle">${escapeHtml(p.address)}</div>` : ""}
      ${p.localidad ? `<div class="subtitle">${escapeHtml(p.localidad)}</div>` : ""}
    `);
    passengersLayer.addLayer(m);
  }

  applyFilter();

  // Fit bounds
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
