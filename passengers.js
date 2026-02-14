import {
  initCorePage, STATE, $, toast, escapeHtml,
  loadMasterPassengers
} from "./core.js";

import { db } from "./firebase-init.js";

import {
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

function fullName(p){ return `${p.lastName||""} ${p.firstName||""}`.trim() || "(sin nombre)"; }

let currentPassengerId = null;

function isAdmin(){ return !!STATE.auth.isAdmin; }

function hasGeo(p){
  const lat = Number(p?.lat);
  const lng = Number(p?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function getFiltered(){
  const q = (($("passSearch")?.value || "").trim()).toLowerCase();
  const list = (STATE.master.passengers || []).filter(p => {
    const hay = `${p.firstName||""} ${p.lastName||""} ${p.phone||""} ${p.address||""} ${p.localidad||""}`.toLowerCase();
    return !q || hay.includes(q);
  });
  list.sort((a,b)=> `${a.lastName||""} ${a.firstName||""}`.localeCompare(`${b.lastName||""} ${b.firstName||""}`));
  return list;
}

function renderTable(){
  const tbody = $("passengersTableBody");
  if (!tbody) return;

  const list = getFiltered();
  tbody.innerHTML = list.map(p => `
    <tr>
      <td><strong>${escapeHtml(fullName(p))}</strong><div class="muted">${escapeHtml(p.address||"")}</div></td>
      <td>${escapeHtml(p.localidad||"")}</td>
      <td>${escapeHtml(p.phone||"")}</td>
      <td>${hasGeo(p) ? "✅" : "—"}</td>
      <td><button class="btn" data-id="${escapeHtml(p.id)}">Ver</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll("button[data-id]").forEach(b => {
    b.addEventListener("click", () => openDetail(b.dataset.id));
  });
}

function renderCards(){
  const wrap = $("passengersCards");
  if (!wrap) return;

  const list = getFiltered();
  wrap.innerHTML = list.map(p => `
    <div class="card" style="padding:14px;">
      <div class="rowBetween">
        <div>
          <div style="font-weight:800;">${escapeHtml(fullName(p))}</div>
          <div class="subtitle">${escapeHtml(p.phone||"")}${p.localidad ? " · " + escapeHtml(p.localidad) : ""}</div>
          <div class="subtitle">${escapeHtml(p.address||"")}</div>
        </div>
        <div class="row">
          <span class="pillSmall" style="padding:6px 10px;">${hasGeo(p) ? "📍" : "—"}</span>
          <button class="btn" data-id="${escapeHtml(p.id)}">Ver</button>
        </div>
      </div>
    </div>
  `).join("");

  wrap.querySelectorAll("button[data-id]").forEach(b => {
    b.addEventListener("click", () => openDetail(b.dataset.id));
  });
}

function renderAll(){ renderTable(); renderCards(); }

function openDetailNew(){
  currentPassengerId = null;
  $("detailMode").textContent = "Alta de pasajero";
  $("btnDeletePassenger").style.display = "none";

  $("passengerDetail").innerHTML = formHtml({
    firstName:"", lastName:"", phone:"", localidad:"", address:"", zone:"",
    lat:"", lng:""
  }, true);

  wireFormButtons({ isNew:true });
}

function openDetail(id){
  const p = (STATE.master.passengers || []).find(x => x.id === id) || null;
  if (!p) return;

  currentPassengerId = id;
  $("detailMode").textContent = "Edición";
  $("btnDeletePassenger").style.display = isAdmin() ? "inline-block" : "none";

  $("passengerDetail").innerHTML = formHtml(p, false);
  wireFormButtons({ isNew:false });

  $("btnDeletePassenger").onclick = deleteCurrent;
}

function formHtml(p, isNew){
  return `
    <div class="grid2">
      <div class="field"><label>Nombre</label><input id="p_firstName" value="${escapeHtml(p.firstName||"")}" placeholder="Nombre"></div>
      <div class="field"><label>Apellido</label><input id="p_lastName" value="${escapeHtml(p.lastName||"")}" placeholder="Apellido"></div>

      <div class="field"><label>Teléfono</label><input id="p_phone" value="${escapeHtml(p.phone||"")}" placeholder="(sin guiones)"></div>
      <div class="field"><label>Localidad</label><input id="p_localidad" value="${escapeHtml(p.localidad||"")}" placeholder="Rosario / Funes / ..."></div>

      <div class="field" style="grid-column:1/-1;"><label>Dirección</label><input id="p_address" value="${escapeHtml(p.address||"")}" placeholder="Calle y número"></div>

      <div class="field"><label>Zona</label><input id="p_zone" value="${escapeHtml(p.zone||"")}" placeholder="Zona"></div>
      <div class="field"><label>Lat</label><input id="p_lat" value="${escapeHtml(String(p.lat ?? ""))}" placeholder="-32.94"></div>
      <div class="field"><label>Lng</label><input id="p_lng" value="${escapeHtml(String(p.lng ?? ""))}" placeholder="-60.64"></div>
    </div>

    <div class="row" style="margin-top:12px; flex-wrap:wrap;">
      <button id="btnSavePassenger" class="btnPrimary primary">Guardar</button>
      <button id="btnGeocodeOne" class="btn">📍 Geolocalizar</button>
      ${isNew ? `<button id="btnCancelPassenger" class="btnSecondary">Cancelar</button>` : ``}
    </div>

    <p class="muted" style="margin-top:10px;">Master Data: la asignación de chofer es por evento (Asignaciones).</p>
  `;
}

function wireFormButtons({ isNew }){
  $("btnSavePassenger")?.addEventListener("click", savePassenger);
  $("btnGeocodeOne")?.addEventListener("click", async () => {
    try{
      const payload = getPayloadFromForm();
      const upd = await geocodePassengerIfNeeded(payload, { force:true });
      // pintar en inputs
      if (upd && (upd.lat != null) && (upd.lng != null)){
        $("p_lat").value = String(upd.lat);
        $("p_lng").value = String(upd.lng);
        toast("Geolocalizado");
      } else {
        toast("No se pudo geolocalizar (revisá dirección/localidad)");
      }
    }catch(e){
      console.error(e);
      toast(e.message || String(e));
    }
  });

  if (isNew){
    $("btnCancelPassenger")?.addEventListener("click", () => {
      $("passengerDetail").innerHTML = '<span class="muted">Seleccioná un pasajero…</span>';
      $("detailMode").textContent = "Seleccioná un pasajero…";
    });
  }
}

function getPayloadFromForm(){
  const latRaw = ($("p_lat")?.value || "").trim();
  const lngRaw = ($("p_lng")?.value || "").trim();
  const lat = latRaw === "" ? null : Number(latRaw);
  const lng = lngRaw === "" ? null : Number(lngRaw);

  return {
    firstName: ($("p_firstName")?.value || "").trim(),
    lastName: ($("p_lastName")?.value || "").trim(),
    phone: ($("p_phone")?.value || "").trim(),
    localidad: ($("p_localidad")?.value || "").trim(),
    address: ($("p_address")?.value || "").trim(),
    zone: ($("p_zone")?.value || "").trim(),
    lat: (lat != null && Number.isFinite(lat)) ? lat : null,
    lng: (lng != null && Number.isFinite(lng)) ? lng : null
  };
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function geocodeQuery({ address, localidad }){
  const q = [address, localidad, "Santa Fe", "Argentina"].filter(Boolean).join(", ");
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;

  // Nominatim pide rate-limit y uso responsable.
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "es"
    }
  });
  if (!res.ok) throw new Error("Geocoding: respuesta no OK");
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;

  const lat = Number(data[0].lat);
  const lon = Number(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { lat, lng: lon, query: q, source: "nominatim" };
}

async function geocodePassengerIfNeeded(payload, { force=false } = {}){
  const has = Number.isFinite(Number(payload.lat)) && Number.isFinite(Number(payload.lng));
  if (has && !force) return null;

  const address = (payload.address || "").trim();
  const localidad = (payload.localidad || "").trim();
  if (!address || !localidad) return null;

  const r = await geocodeQuery({ address, localidad });
  if (!r) return null;

  return {
    lat: r.lat,
    lng: r.lng,
    geocodeSource: r.source,
    geocodeQuery: r.query,
    geocodedAt: serverTimestamp()
  };
}

async function savePassenger(){
  try{
    if (!isAdmin()) throw new Error("Solo Admin");

    const base = getPayloadFromForm();
    if (!base.firstName && !base.lastName) throw new Error("Poné nombre o apellido");

    // Auto-geolocalizar si faltan coords y hay dirección+localidad
    let geo = await geocodePassengerIfNeeded(base, { force:false });
    // Rate-limit friendly (si geocodificó)
    if (geo) await sleep(1100);

    const payload = {
      ...base,
      ...(geo ? { lat: geo.lat, lng: geo.lng, geocodeSource: geo.geocodeSource, geocodeQuery: geo.geocodeQuery, geocodedAt: geo.geocodedAt } : {}),
      updatedAt: serverTimestamp()
    };

    if (!currentPassengerId){
      const ref = await addDoc(collection(db, "passengers"), {
        ...payload,
        createdAt: serverTimestamp()
      });
      currentPassengerId = ref.id;
      toast("Pasajero creado");
    } else {
      await setDoc(doc(db, "passengers", currentPassengerId), payload, { merge:true });
      toast("Pasajero actualizado");
    }

    await loadMasterPassengers();
    renderAll();
    openDetail(currentPassengerId);
  }catch(e){
    console.error(e);
    toast(e.message || String(e));
  }
}

async function deleteCurrent(){
  try{
    if (!isAdmin()) throw new Error("Solo Admin");
    if (!currentPassengerId) return;

    const ok = confirm("¿Eliminar este pasajero?");
    if (!ok) return;

    await deleteDoc(doc(db, "passengers", currentPassengerId));
    toast("Pasajero eliminado");
    currentPassengerId = null;

    await loadMasterPassengers();
    renderAll();
    $("passengerDetail").innerHTML = '<span class="muted">Seleccioná un pasajero…</span>';
    $("detailMode").textContent = "Seleccioná un pasajero…";
    $("btnDeletePassenger").style.display = "none";
  }catch(e){
    console.error(e);
    toast(e.message || String(e));
  }
}

// Geocodificar SOLO los que no tienen lat/lng (master)
async function geocodeMissingPassengers(){
  try{
    if (!isAdmin()) throw new Error("Solo Admin");
    toast("Geocodificando faltantes…");

    // Releer colección para asegurar datos completos (y no cache viejo)
    // (igual podrías usar STATE.master.passengers)
    const snap = await getDocs(collection(db, "passengers"));
    const list = snap.docs.map(d => ({ id:d.id, ...d.data() }));

    const targets = list.filter(p => {
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      const has = Number.isFinite(lat) && Number.isFinite(lng);
      const okAddr = (p.address || "").trim() && (p.localidad || "").trim();
      return !has && !!okAddr;
    });

    if (!targets.length){
      toast("No hay pasajeros para geocodificar");
      return;
    }

    let done = 0;
    for (const p of targets){
      const r = await geocodeQuery({ address: p.address, localidad: p.localidad });
      if (r){
        await setDoc(doc(db, "passengers", p.id), {
          lat: r.lat,
          lng: r.lng,
          geocodeSource: r.source,
          geocodeQuery: r.query,
          geocodedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge:true });
        done++;
      }
      // Rate limit Nominatim
      await sleep(1100);
    }

    await loadMasterPassengers();
    renderAll();
    toast(`Geocodificados: ${done}/${targets.length}`);
  }catch(e){
    console.error(e);
    toast(e.message || String(e));
  }
}

(async function init(){
  try{
    await initCorePage({ page: "passengers" });
    if (!STATE.auth.user) return;

    $("passSearch")?.addEventListener("input", renderAll);
    $("btnReloadPassengers")?.addEventListener("click", async () => {
      await loadMasterPassengers();
      renderAll();
      toast("Pasajeros recargados");
    });

    $("btnAddPassenger")?.addEventListener("click", openDetailNew);
    $("btnGeocodeMissing")?.addEventListener("click", geocodeMissingPassengers);

    await loadMasterPassengers();
    renderAll();
  }catch(e){
    console.error("INIT ERROR:", e);
    toast(e.message || String(e));
  }
})();
