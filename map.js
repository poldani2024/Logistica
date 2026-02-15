
import { startAuth, ensureHeader, loadMasterData, loadEventContext, STATE, getSelectedEventId, driverName, passengerName } from "./core.js";

let map, layerGroup;

function initMap(){
  map = L.map("map");
  layerGroup = L.layerGroup().addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  map.setView([-32.95, -60.66], 12); // Rosario aprox
}

function addMarker(lat, lon, label){
  const m = L.marker([lat, lon]);
  m.bindTooltip(label, { permanent:false, direction:"top" });
  m.addTo(layerGroup);
}

function render(){
  const hint = document.getElementById("mapHint");
  const filter = document.getElementById("mapFilter").value;

  layerGroup.clearLayers();

  const drivers = STATE.master.drivers;
  const passengers = STATE.master.passengers;

  // Center: si hay pasajeros con coords, centrar en el primero
  const any = passengers.find(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if(any) map.setView([any.lat, any.lon], 12);

  if(filter === "all" || filter === "drivers"){
    for(const d of drivers){
      // opcional: si algún chofer tuviera lat/lon
      if(Number.isFinite(d.lat) && Number.isFinite(d.lon)){
        addMarker(d.lat, d.lon, `🚗 ${d.name || d.id}`);
      }
    }
  }

  if(filter === "all" || filter === "passengers"){
    // mostrar pasajeros del evento si hay evento
    const ids = STATE.event?.passengersIds ? new Set(STATE.event.passengersIds) : null;
    for(const p of passengers){
      if(ids && !ids.has(p.id)) continue;
      if(Number.isFinite(p.lat) && Number.isFinite(p.lon)){
        // mostrar nombre de chofer asignado (si está asignado en cualquier doc)
        let assignedDriver = null;
        for(const [driverId, a] of STATE.event.assignments.entries()){
          if((a.passengerIds || []).includes(p.id)){ assignedDriver = driverId; break; }
        }
        const extra = assignedDriver ? ` — 🚗 ${driverName(assignedDriver)}` : "";
        addMarker(p.lat, p.lon, `👤 ${p.name || p.id}${extra}`);
      }
    }
  }

  hint.textContent = STATE.event?.id ? "Mostrando pasajeros vinculados al evento (si tienen lat/lon)." : "Mostrando master data con coordenadas.";
}

(async function(){
  await startAuth();
  await ensureHeader();
  await loadMasterData();

  const eventId = getSelectedEventId();
  if(eventId) await loadEventContext(eventId);

  initMap();
  document.getElementById("mapFilter").onchange = render;
  render();
})();
