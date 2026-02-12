import {
  initCorePage, STATE, $, toast,
  loadMasterDrivers, loadMasterPassengers,
  loadEventContext, driversInEvent, passengersInEvent
} from "./core.js";

let map = null;
let layer = null;

function initMap() {
  if (map) return;
  map = L.map("map").setView([-32.95, -60.66], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
}

function draw() {
  initMap();
  setTimeout(()=> map.invalidateSize(), 50);

  if (layer) layer.remove();
  layer = L.layerGroup().addTo(map);

  const ds = driversInEvent();
  const ps = passengersInEvent();

  // zonas (placeholder simple, ajustable)
  const zones = [
    { name:"Centro",  bounds:[[-32.99,-60.72],[-32.93,-60.62]] },
    { name:"Norte",   bounds:[[-32.93,-60.72],[-32.86,-60.62]] },
    { name:"Sur",     bounds:[[-33.05,-60.72],[-32.99,-60.62]] },
  ];
  zones.forEach(z => L.rectangle(z.bounds, { weight:1, fillOpacity:0.05 }).bindTooltip(z.name).addTo(layer));

  // pasajeros
  ps.forEach(p => {
    if (p.lat == null || p.lng == null) return;
    const meta = p._event || {};
    const assigned = !!meta.assignedDriverId;
    const color = assigned ? "green" : "red";
    L.circleMarker([p.lat, p.lng], { radius:7, weight:2, fillOpacity:0.8, color, fillColor: color })
      .bindPopup(`<b>Pasajero</b><br/>${p.lastName||""} ${p.firstName||""}<br/>${p.address||""}<br/>${p.localidad||""}`)
      .addTo(layer);
  });

  // choferes
  ds.forEach(d => {
    if (d.lat == null || d.lng == null) return;
    L.marker([d.lat, d.lng])
      .bindPopup(`<b>Chofer</b><br/>${d.lastName||""} ${d.firstName||""}<br/>${d.phone||""}`)
      .addTo(layer);
  });

  const hint = $("eventHint");
  if (hint) hint.textContent = STATE.event.id ? `Evento activo: ${STATE.event.id}` : "No hay evento seleccionado";
}

async function refreshAll() {
  await loadMasterDrivers();
  await loadMasterPassengers();
  await loadEventContext(STATE.event.id);
  draw();
}

(async function init(){
  await initCorePage({ page: "map" });

  $("btnRefreshMap").addEventListener("click", draw);
  document.addEventListener("eventChanged", refreshAll);

  await refreshAll();
})();

