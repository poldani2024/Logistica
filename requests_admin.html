import { initCorePage, STATE, $, toast, escapeHtml } from "./core.js";
import { db } from "./firebase-init.js";

import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit,
  addDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

function fullNameObj(x){
  const ln = x?.lastName || "";
  const fn = x?.firstName || "";
  return `${ln} ${fn}`.trim();
}

function normalizePhone(p){
  return (p || "").replace(/[^\d+]/g, "");
}

async function fetchRequests(status) {
  const col = collection(db, "tripRequests");

  let qy;
  if (!status || status === "all") {
    qy = query(col, orderBy("createdAt", "desc"), limit(100));
  } else {
    qy = query(col, where("status", "==", status), orderBy("createdAt", "desc"), limit(100));
  }

  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function phasesLabel(r){
  const out = [];
  if (r.phases?.ida?.enabled) out.push("Ida");
  if (r.phases?.vuelta?.enabled) out.push("Vuelta");
  return out.join(" + ") || "-";
}

function renderList(list) {
  $("rqList").innerHTML = list.length ? `
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Evento</th>
          <th>Fases</th>
          <th>Creador</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(r => `
          <tr data-rq="${escapeHtml(r.id)}" class="rowHover">
            <td>${escapeHtml(r.event?.date || "")}</td>
            <td><strong>${escapeHtml(r.event?.title || "")}</strong></td>
            <td>${escapeHtml(phasesLabel(r))}</td>
            <td>${escapeHtml(r.createdByEmail || "")}</td>
            <td>${escapeHtml(r.status || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : `<p class="muted">No hay solicitudes.</p>`;

  document.querySelectorAll("[data-rq]").forEach(tr => {
    tr.addEventListener("click", () => {
      const id = tr.dataset.rq;
      loadDetail(id);
    });
  });
}

async function loadDetail(requestId){
  const ref = doc(db, "tripRequests", requestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    $("rqDetail").innerHTML = `<p class="muted">No existe.</p>`;
    return;
  }
  const r = { id: snap.id, ...snap.data() };
  window.__RQ = r;

  const pax = Array.isArray(r.passengers) ? r.passengers : [];
  const ida = r.phases?.ida || {};
  const vuelta = r.phases?.vuelta || {};

  $("rqDetail").innerHTML = `
    <div class="grid2">
      <div>
        <div class="muted">ID</div><div><code>${escapeHtml(r.id)}</code></div>
      </div>
      <div>
        <div class="muted">Estado</div><div><strong>${escapeHtml(r.status || "")}</strong></div>
      </div>
      <div>
        <div class="muted">Evento</div><div><strong>${escapeHtml(r.event?.title || "")}</strong></div>
      </div>
      <div>
        <div class="muted">Fecha</div><div>${escapeHtml(r.event?.date || "")}</div>
      </div>
      <div>
        <div class="muted">Destino</div><div>${escapeHtml(r.event?.destinationAddress || "")} · ${escapeHtml(r.event?.destinationCity || "")}</div>
      </div>
      <div>
        <div class="muted">Contacto</div><div>${escapeHtml(r.contactPhone || "")} (${escapeHtml(r.createdByEmail || "")})</div>
      </div>
    </div>

    <hr />

    <div class="grid2">
      <div class="card2">
        <strong>Ida</strong>
        <div class="muted">Incluida: ${ida.enabled ? "Sí" : "No"}</div>
        ${ida.enabled ? `
          <div>${escapeHtml(ida.pickupAddress || "")} · ${escapeHtml(ida.pickupCity || "")}</div>
          <div>Hora: <strong>${escapeHtml(ida.time || "")}</strong></div>
        ` : ""}
      </div>

      <div class="card2">
        <strong>Vuelta</strong>
        <div class="muted">Incluida: ${vuelta.enabled ? "Sí" : "No"}</div>
        ${vuelta.enabled ? `
          <div>${escapeHtml(vuelta.dropoffAddress || "")} · ${escapeHtml(vuelta.dropoffCity || "")}</div>
          <div>Hora: <strong>${escapeHtml(vuelta.time || "")}</strong></div>
        ` : ""}
      </div>
    </div>

    <hr />

    <h3>Pasajeros (${pax.length})</h3>
    ${pax.length ? `
      <table>
        <thead><tr><th>Nombre</th><th>Tel</th><th>Domicilio (ida)</th><th>Menor</th><th>Obs</th></tr></thead>
        <tbody>
          ${pax.map(p => `
            <tr>
              <td><strong>${escapeHtml(p.fullName || "")}</strong></td>
              <td>${escapeHtml(p.phone || "")}</td>
              <td>${escapeHtml(p.pickupAddress || "")} · ${escapeHtml(p.pickupCity || "")}</td>
              <td>${p.isMinor ? `Sí (${escapeHtml(p.adultName||"")})` : "No"}</td>
              <td>${escapeHtml(p.notes || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : `<p class="muted">Sin pasajeros.</p>`}

    <div class="row" style="justify-content:flex-end; gap:10px; margin-top:12px;">
      <button id="btnReview" class="btnSecondary">Marcar review</button>
      <button id="btnReject" class="btnSecondary">Rechazar</button>
      <button id="btnConvert" class="btnPrimary">Convertir a evento</button>
    </div>

    ${r.admin?.convertedEventId ? `<p class="muted">Evento creado: <code>${escapeHtml(r.admin.convertedEventId)}</code></p>` : ""}
  `;

  $("btnReview").addEventListener("click", () => setStatus(r.id, "review"));
  $("btnReject").addEventListener("click", () => setStatus(r.id, "rejected"));
  $("btnConvert").addEventListener("click", () => convertRequestToEvent(r.id));
}

async function setStatus(requestId, status){
  await updateDoc(doc(db, "tripRequests", requestId), {
    status,
    "admin.updatedAt": serverTimestamp(),
    "admin.updatedBy": STATE.auth.user?.email || ""
  });
  toast(`Estado: ${status}`);
  await refresh();
}

async function findPassengerByPhone(phone){
  const ph = normalizePhone(phone);
  if (!ph) return null;

  const qy = query(collection(db, "passengers"), where("phone", "==", ph), limit(1));
  const snap = await getDocs(qy);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

function splitName(full){
  const s = (full || "").trim();
  if (!s) return { firstName:"", lastName:"" };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(1).join(" "), lastName: parts[0] }; // simple: primer token como apellido
}

async function upsertMasterPassenger(p){
  const phone = normalizePhone(p.phone || "");
  if (phone) {
    const existing = await findPassengerByPhone(phone);
    if (existing) return existing.id;
  }

  const { firstName, lastName } = splitName(p.fullName || "");
  const newDoc = {
    firstName,
    lastName,
    phone,
    address: p.pickupAddress || "",
    localidad: p.pickupCity || "",
    active: true,
    createdAt: serverTimestamp()
  };

  const ref = await addDoc(collection(db, "passengers"), newDoc);
  return ref.id;
}

function buildPhasesFromRequest(r){
  const phases = [];
  if (r.phases?.ida?.enabled) {
    phases.push({
      id: "ida",
      name: "Ida",
      address: r.event?.destinationAddress || "",
      city: r.event?.destinationCity || "",
      time: r.phases.ida.time || ""
    });
  }
  if (r.phases?.vuelta?.enabled) {
    phases.push({
      id: "vuelta",
      name: "Vuelta",
      address: r.event?.destinationAddress || "",
      city: r.event?.destinationCity || "",
      time: r.phases.vuelta.time || ""
    });
  }
  return phases;
}

async function convertRequestToEvent(requestId){
  if (!STATE.auth.isAdmin) throw new Error("Solo admin");

  const snap = await getDoc(doc(db, "tripRequests", requestId));
  if (!snap.exists()) throw new Error("No existe la solicitud");
  const r = { id: snap.id, ...snap.data() };

  if (r.status === "converted" && r.admin?.convertedEventId) {
    toast("Ya estaba convertida");
    return;
  }

  // 1) Crear evento
  const phases = buildPhasesFromRequest(r);

  const ev = {
    title: r.event?.title || "Evento",
    date: r.event?.date || "",
    location: `${r.event?.destinationAddress || ""} · ${r.event?.destinationCity || ""}`.trim(),
    phases
  };

  const evRef = await addDoc(collection(db, "events"), ev);

  // 2) Crear eventPassengers
  const pax = Array.isArray(r.passengers) ? r.passengers : [];

  for (const p of pax) {
    const passengerId = await upsertMasterPassenger(p);

    // vincular al evento
    await setDoc(doc(db, "events", evRef.id, "eventPassengers", passengerId), {
      requestId: r.id,
      notes: [
        p.notes || "",
        p.isMinor ? `Menor. Adulto: ${p.adultName || ""} (${p.adultPhone || ""})` : ""
      ].filter(Boolean).join(" | "),
      geo: null
    }, { merge: true });
  }

  // 3) Marcar solicitud convertida
  await updateDoc(doc(db, "tripRequests", r.id), {
    status: "converted",
    "admin.convertedAt": serverTimestamp(),
    "admin.convertedBy": STATE.auth.user?.email || "",
    "admin.convertedEventId": evRef.id
  });

  toast("Convertida a evento");
  await refresh();
  await loadDetail(r.id);
}

let _lastList = [];

async function refresh(){
  const status = $("selRqStatus").value;
  _lastList = await fetchRequests(status);
  renderList(_lastList);
}

(async function init(){
  await initCorePage({ page: "requests_admin" });

  if (!STATE.auth.isAdmin) {
    document.body.innerHTML = "<p style='padding:20px'>Solo admin.</p>";
    return;
  }

  $("btnRefresh").addEventListener("click", refresh);
  $("selRqStatus").addEventListener("change", refresh);

  await refresh();
})();
