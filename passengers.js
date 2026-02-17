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

/* ---------------------------
   GEO LOG (UI + persistence)
----------------------------*/
const GEO_LOG_KEY = "geoLogPassengers";
let GEO_LOG = [];

function loadGeoLog(){
  try{
    const raw = localStorage.getItem(GEO_LOG_KEY);
    GEO_LOG = raw ? (JSON.parse(raw) || []) : [];
  }catch{ GEO_LOG = []; }
}
function saveGeoLog(){
  try{
    localStorage.setItem(GEO_LOG_KEY, JSON.stringify(GEO_LOG.slice(-200)));
  }catch{}
}
function geoLog(entry){
  const row = { at: new Date().toISOString(), ...entry };
  GEO_LOG.push(row);
  GEO_LOG = GEO_LOG.slice(-200);
  saveGeoLog();
  console.info("[GEO]", row);
  renderGeoLog();
}
function renderGeoLog(){
  const box = document.getElementById("geoLogBox");
  if (!box) return;
  if (!GEO_LOG.length){
    box.textContent = "(sin logs todavía)";
    return;
  }
  const lines = GEO_LOG.slice(-80).map(l => {
    const who = l.name ? ` | ${l.name}` : "";
    const pid = l.passengerId ? ` | id:${l.passengerId}` : "";
    const q = l.query ? `\n  query: ${l.query}` : "";
    const url = l.url ? `\n  url: ${l.url}` : "";
    const http = (l.httpStatus != null) ? `\n  http: ${l.httpStatus}${l.httpOk===false ? " (not ok)" : ""}` : "";
    const resp = (l.resultSummary != null) ? `\n  result: ${l.resultSummary}` : "";
    const err = l.error ? `\n  error: ${l.error}` : "";
    return `${l.at} | ${l.type}${who}${pid}${q}${url}${http}${resp}${err}`;
  });
  box.textContent = lines.join("\n\n");
}
function wireGeoLogButtons(){
  document.getElementById("btnClearGeoLog")?.addEventListener("click", () => {
    const ok = confirm("¿Limpiar el log de geolocalización?");
    if (!ok) return;
    GEO_LOG = [];
    saveGeoLog();
    renderGeoLog();
    toast("Log limpiado");
  });

  document.getElementById("btnCopyGeoLog")?.addEventListener("click", async () => {
    try{
      const txt = document.getElementById("geoLogBox")?.textContent || "";
      await navigator.clipboard.writeText(txt);
      toast("Log copiado");
    }catch(e){
      console.error(e);
      toast("No se pudo copiar (permiso del navegador)");
    }
  });
}

/* ---------------------------
   UI / CRUD
----------------------------*/
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
import { addPassengerToEvent, loadEventContext, STATE, toast } from "./core.js";

const btn = document.getElementById("btnAddPassengerToEvent");
const hint = document.getElementById("addToEventHint");

const activeEventId = STATE.event?.id;
hint.textContent = activeEventId
  ? `Evento activo: ${STATE.event?.title || activeEventId}`
  : "No hay evento activo. Seleccioná un evento en Home.";

btn.disabled = !activeEventId || !passenger?.id; // si es nuevo y todavía no guardaste, deshabilitá

btn.addEventListener("click", async () => {
  try {
    const eventId = STATE.event?.id;
    if (!eventId) return toast("Seleccioná un evento primero.");
    if (!passenger?.id) return toast("Guardá el pasajero antes de asignarlo al evento.");

    await addPassengerToEvent(eventId, passenger.id);

    // refrescar contexto del evento para que Asignaciones lo vea sin recargar página
    await loadEventContext(eventId);

    toast("Pasajero agregado al evento");
  } catch (e) {
    console.error(e);
    toast(e.message || String(e));
  }
});

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
      <div class="row" style="gap:10px; align-items:center; margin-top:10px;">
        <button id="btnAddPassengerToEvent" class="btnSecondary">Agregar al evento activo</button>
        <span id="addToEventHint" class="muted"></span>
      </div>
      ${isNew ? `<button id="btnCancelPassenger" class="btnSecondary">Cancelar</button>` : ``}
    </div>

    <p class="muted" style="margin-top:10px;">Master Data: la asignación de chofer es por evento (Asignaciones).</p>
  `;
}

function wireFormButtons({ isNew }){
  $("btnSavePassenger")?.addEventListener("click", savePassenger);
  $("btnGeocodeOne")?.addEventListener("click", async () => {
    try{
      const base = getPayloadFromForm();
      const nm = `${base.lastName||""} ${base.firstName||""}`.trim();
      const upd = await geocodePassengerIfNeeded(base, { force:true, passengerId: currentPassengerId, passengerName: nm || base.firstName || base.lastName });
      if (upd && (upd.lat != null) && (upd.lng != null)){
        $("p_lat").value = String(upd.lat);
        $("p_lng").value = String(upd.lng);
        toast("Geolocalizado");
      } else {
        toast("No se pudo geolocalizar (revisá dirección/localidad)");
      }
      document.getElementById("geoLogDetails")?.setAttribute("open", "open");
    }catch(e){
      console.error(e);
      geoLog({ type:"ERROR", passengerId: currentPassengerId, name:"(detalle)", error: e.message || String(e) });
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

/* ---------------------------
   GEOCODING (Nominatim)
----------------------------*/
function buildQuery({ address, localidad }){
  return [address, localidad, "Santa Fe", "Argentina"].filter(Boolean).join(", ");
}

async function geocodeQuery({ address, localidad, passengerId, name }){
  // Normalización mínima
  const addrRaw = String(address || "").trim().replace(/\s+/g, " ");
  const cityRaw = String(localidad || "").trim().replace(/\s+/g, " ");

  const country = "Argentina";
  const state = "Santa Fe";

  const fullWithState = [addrRaw, cityRaw, state, country].filter(Boolean).join(", ");
  const fullNoState   = [addrRaw, cityRaw, country].filter(Boolean).join(", ");

  // helper fetch+parse with logging
  async function fetchJson(url, meta){
    geoLog({ type: "REQUEST", passengerId, name, query: meta.query, url, resultSummary: meta.note || "" });

    let res, text = "";
    try{
      res = await fetch(url, { headers: { "Accept": "application/json", "Accept-Language": "es" }});
      geoLog({ type: "HTTP", passengerId, name, query: meta.query, url, httpStatus: res.status, httpOk: res.ok, resultSummary: meta.note || "" });
      text = await res.text();
    }catch(e){
      geoLog({ type: "ERROR", passengerId, name, query: meta.query, url, error: `fetch: ${e.message || String(e)}`, resultSummary: meta.note || "" });
      return null;
    }

    let data = null;
    try{
      data = JSON.parse(text);
    }catch(e){
      geoLog({ type: "ERROR", passengerId, name, query: meta.query, url, error: `json: ${e.message || String(e)}`, resultSummary: (text || "").slice(0, 240) });
      return null;
    }

    if (!Array.isArray(data) || !data.length) return [];
    return data;
  }

  function pickBest(data){
    const first = data[0] || {};
    const lat = Number(first.lat);
    const lon = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lng: lon, source: "nominatim", first, count: data.length };
  }

  // street-only fallback
  const addrNoNumber = addrRaw.replace(/\b\d+\w*\b/g, "").replace(/\s+/g, " ").trim();
  const streetOnlyWithState = [addrNoNumber, cityRaw, state, country].filter(Boolean).join(", ");
  const streetOnlyNoState   = [addrNoNumber, cityRaw, country].filter(Boolean).join(", ");

  // Attempts order requested:
  const attempts = [
    // WITH state
    {
      label: "STRUCTURED_WITH_STATE",
      url: `https://nominatim.openstreetmap.org/search?format=json&limit=3&street=${encodeURIComponent(addrRaw)}&city=${encodeURIComponent(cityRaw)}&state=${encodeURIComponent(state)}&country=${encodeURIComponent(country)}`,
      query: fullWithState,
      note: "structured with state"
    },
    {
      label: "Q_WITH_STATE",
      url: `https://nominatim.openstreetmap.org/search?format=json&limit=3&q=${encodeURIComponent(fullWithState)}`,
      query: fullWithState,
      note: "q with state"
    },
    // WITHOUT state
    {
      label: "STRUCTURED_NO_STATE",
      url: `https://nominatim.openstreetmap.org/search?format=json&limit=3&street=${encodeURIComponent(addrRaw)}&city=${encodeURIComponent(cityRaw)}&country=${encodeURIComponent(country)}`,
      query: fullNoState,
      note: "structured no state"
    },
    {
      label: "Q_NO_STATE",
      url: `https://nominatim.openstreetmap.org/search?format=json&limit=3&q=${encodeURIComponent(fullNoState)}`,
      query: fullNoState,
      note: "q no state"
    },
  ];

  if (addrNoNumber && addrNoNumber !== addrRaw){
    attempts.push(
      // street-only WITH state
      {
        label: "STRUCTURED_STREET_ONLY_WITH_STATE",
        url: `https://nominatim.openstreetmap.org/search?format=json&limit=3&street=${encodeURIComponent(addrNoNumber)}&city=${encodeURIComponent(cityRaw)}&state=${encodeURIComponent(state)}&country=${encodeURIComponent(country)}`,
        query: streetOnlyWithState,
        note: "street-only structured with state"
      },
      {
        label: "Q_STREET_ONLY_WITH_STATE",
        url: `https://nominatim.openstreetmap.org/search?format=json&limit=3&q=${encodeURIComponent(streetOnlyWithState)}`,
        query: streetOnlyWithState,
        note: "street-only q with state"
      },
      // street-only WITHOUT state
      {
        label: "STRUCTURED_STREET_ONLY_NO_STATE",
        url: `https://nominatim.openstreetmap.org/search?format=json&limit=3&street=${encodeURIComponent(addrNoNumber)}&city=${encodeURIComponent(cityRaw)}&country=${encodeURIComponent(country)}`,
        query: streetOnlyNoState,
        note: "street-only structured no state"
      },
      {
        label: "Q_STREET_ONLY_NO_STATE",
        url: `https://nominatim.openstreetmap.org/search?format=json&limit=3&q=${encodeURIComponent(streetOnlyNoState)}`,
        query: streetOnlyNoState,
        note: "street-only q no state"
      }
    );
  }

  for (let i=0; i<attempts.length; i++){
    const a = attempts[i];
    const data = await fetchJson(a.url, { query: a.query, note: `${a.note} (${a.label})` });
    if (data === null) continue;

    if (!data.length){
      geoLog({ type: "NO_RESULT", passengerId, name, query: a.query, url: a.url, resultSummary: `[] (${a.label})` });
      continue;
    }

    geoLog({
      type: "RESULT",
      passengerId, name,
      query: a.query,
      url: a.url,
      resultSummary: `count=${data.length} | first.display_name=${(data[0]?.display_name||"").slice(0,120)} | lat=${data[0]?.lat} lon=${data[0]?.lon} (${a.label})`
    });

    const picked = pickBest(data);
    if (!picked){
      geoLog({ type: "ERROR", passengerId, name, query: a.query, url: a.url, error: `coords inválidas (${a.label})`, resultSummary: JSON.stringify(data[0]||{}).slice(0,240) });
      continue;
    }

    if (i > 0){
      geoLog({ type: "FALLBACK_USED", passengerId, name, query: a.query, url: a.url, resultSummary: `used ${a.label}` });
    }

    return { ...picked, query: a.query, usedAttempt: a.label };
  }

  return null;
}


async function geocodePassengerIfNeeded(payload, { force=false, passengerId=null, passengerName="" } = {}){
  const has = Number.isFinite(Number(payload.lat)) && Number.isFinite(Number(payload.lng));
  if (has && !force) return null;

  const address = (payload.address || "").trim();
  const localidad = (payload.localidad || "").trim();

  if (!address || !localidad){
    geoLog({ type: "SKIP", passengerId, name: passengerName, query: buildQuery({ address, localidad }), error: "Falta dirección o localidad" });
    return null;
  }

  const r = await geocodeQuery({ address, localidad, passengerId, name: passengerName });
  if (!r) return null;

  return { lat: r.lat, lng: r.lng, geocodeSource: r.source, geocodeQuery: r.query, geocodedAt: serverTimestamp() };
}

/* ---------------------------
   Save / Delete + bulk geocode
----------------------------*/
async function savePassenger(){
  try{
    if (!isAdmin()) throw new Error("Solo Admin");

    const base = getPayloadFromForm();
    if (!base.firstName && !base.lastName) throw new Error("Poné nombre o apellido");

    const nm = `${base.lastName||""} ${base.firstName||""}`.trim() || base.firstName || base.lastName || "(sin nombre)";

    const geo = await geocodePassengerIfNeeded(base, { force:false, passengerId: currentPassengerId, passengerName: nm });
    if (geo) await sleep(1100);

    const payload = { ...base, ...(geo ? { lat: geo.lat, lng: geo.lng, geocodeSource: geo.geocodeSource, geocodeQuery: geo.geocodeQuery, geocodedAt: geo.geocodedAt } : {}), updatedAt: serverTimestamp() };

    if (!currentPassengerId){
      const ref = await addDoc(collection(db, "passengers"), { ...payload, createdAt: serverTimestamp() });
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
    geoLog({ type:"ERROR", passengerId: currentPassengerId, name:"(save)", error: e.message || String(e) });
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
    geoLog({ type:"ERROR", passengerId: currentPassengerId, name:"(delete)", error: e.message || String(e) });
    toast(e.message || String(e));
  }
}

async function geocodeMissingPassengers(){
  try{
    if (!isAdmin()) throw new Error("Solo Admin");
    toast("Geocodificando faltantes…");

    const snap = await getDocs(collection(db, "passengers"));
    const list = snap.docs.map(d => ({ id:d.id, ...d.data() }));

    // Tomamos TODOS los que NO tienen lat/lng válidos.
    const targets = list.filter(p => {
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      const has = Number.isFinite(lat) && Number.isFinite(lng);
      return !has;
    });

    geoLog({ type: "BULK_START", resultSummary: `targets(no-geo)=${targets.length}` });

    if (!targets.length){
      toast("No hay pasajeros para geocodificar");
      geoLog({ type: "BULK_DONE", resultSummary: "0 (sin targets)" });
      return;
    }

    let okCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (const p of targets){
      const nm = `${p.lastName||""} ${p.firstName||""}`.trim() || "(sin nombre)";
      const address = (p.address || "").trim();
      const localidad = (p.localidad || "").trim();

      // Si falta info mínima, lo registramos como SKIP (antes quedaba afuera y parecía “bug”)
      if (!address || !localidad){
        skipCount++;
        geoLog({
          type: "SKIP",
          passengerId: p.id,
          name: nm,
          query: [address, localidad].filter(Boolean).join(", "),
          error: `Falta ${!address && !localidad ? "dirección y localidad" : (!address ? "dirección" : "localidad")}`
        });
        continue;
      }

      const r = await geocodeQuery({ address, localidad, passengerId: p.id, name: nm });
      if (r){
        await setDoc(doc(db, "passengers", p.id), {
          lat: r.lat,
          lng: r.lng,
          geocodeSource: r.source,
          geocodeQuery: r.query,
          geocodedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge:true });

        okCount++;
        geoLog({ type: "SAVE_OK", passengerId: p.id, name: nm, resultSummary: `lat=${r.lat} lng=${r.lng}` });
      } else {
        failCount++;
        geoLog({ type: "SAVE_FAIL", passengerId: p.id, name: nm, error: "Sin resultado / error (ver entradas previas)" });
      }

      // Rate limit Nominatim
      await sleep(1100);
    }

    geoLog({ type: "BULK_DONE", resultSummary: `ok=${okCount} skip=${skipCount} fail=${failCount}` });

    await loadMasterPassengers();
    renderAll();
    toast(`Geocodificados: ${okCount} · Saltados: ${skipCount} · Fallidos: ${failCount}`);
    document.getElementById("geoLogDetails")?.setAttribute("open", "open");
    renderGeoLog();
  }catch(e){
    console.error(e);
    geoLog({ type: "ERROR", error: e.message || String(e) });
    toast(e.message || String(e));
  }
}


/* ---------------------------
   init
----------------------------*/
(async function init(){
  try{
    await initCorePage({ page: "passengers" });
    if (!STATE.auth.user) return;

    loadGeoLog();
    renderGeoLog();
    wireGeoLogButtons();

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
