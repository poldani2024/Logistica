import { initCorePage, STATE, $, toast, escapeHtml } from "./core.js";
import { db } from "./firebase-init.js";

import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit,
  addDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

/* ---------------- UTIL ---------------- */

function normalizePhone(p) {
  return (p || "").replace(/[^\d+]/g, "");
}

function safeIso(dateStr, timeStr) {
  if (!dateStr) return new Date().toISOString();
  const t = timeStr && timeStr.length >= 4 ? timeStr : "00:00";
  const d = new Date(`${dateStr}T${t}:00`);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function addHoursIso(iso, hours) {
  const d = new Date(iso);
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function splitName(full) {
  const s = (full || "").trim();
  if (!s) return { firstName: "", lastName: "" };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { lastName: parts[0], firstName: parts.slice(1).join(" ") };
}

function buildEventPhases(r) {
  const destAddress = r.event?.destinationAddress || "";
  const destCity = r.event?.destinationCity || "";
  const phases = [];

  if (r.phases?.ida?.enabled) {
    phases.push({ id: "ida", name: "Ida", address: destAddress, city: destCity, time: r.phases.ida.time || "" });
  }

  if (r.phases?.vuelta?.enabled) {
    phases.push({ id: "vuelta", name: "Vuelta", address: destAddress, city: destCity, time: r.phases.vuelta.time || "" });
  }

  return phases;
}

/* ---------------- LISTADO ---------------- */

async function fetchRequests(status) {
  const col = collection(db, "tripRequests");

  let qy;
  if (!status || status === "all") {
    qy = query(col, orderBy("createdAt", "desc"), limit(200));
  } else {
    qy = query(col, where("status", "==", status), orderBy("createdAt", "desc"), limit(200));
  }

  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
            <td>${r.phases?.ida?.enabled ? "Ida " : ""}${r.phases?.vuelta?.enabled ? "+ Vuelta" : ""}</td>
            <td>${escapeHtml(r.createdByEmail || "")}</td>
            <td>${escapeHtml(r.status || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : `<p class="muted">No hay solicitudes.</p>`;

  document.querySelectorAll("[data-rq]").forEach(tr => {
    tr.addEventListener("click", () => loadDetail(tr.dataset.rq));
  });
}

/* ---------------- DETALLE ---------------- */

async function loadDetail(requestId) {
  const snap = await getDoc(doc(db, "tripRequests", requestId));
  if (!snap.exists()) {
    $("rqDetail").innerHTML = `<p class="muted">No existe.</p>`;
    return;
  }

  const r = { id: snap.id, ...snap.data() };
  window.__RQ = r;

  $("rqDetail").innerHTML = `
    <h3>${escapeHtml(r.event?.title || "")}</h3>
    <p><strong>Fecha:</strong> ${escapeHtml(r.event?.date || "")}</p>
    <p><strong>Destino:</strong> ${escapeHtml(r.event?.destinationAddress || "")} · ${escapeHtml(r.event?.destinationCity || "")}</p>
    <p><strong>Estado:</strong> ${escapeHtml(r.status || "")}</p>

    <div class="row" style="gap:10px; margin-top:10px;">
      <button id="btnReview" class="btnSecondary">Review</button>
      <button id="btnReject" class="btnSecondary">Rechazar</button>
      <button id="btnConvert" class="btnPrimary">Convertir a evento</button>
    </div>
  `;

  $("btnReview").onclick = () => setStatus(r.id, "review");
  $("btnReject").onclick = () => setStatus(r.id, "rejected");
  $("btnConvert").onclick = () => convertRequestToEvent(r.id);
}

async function setStatus(requestId, status) {
  await updateDoc(doc(db, "tripRequests", requestId), {
    status,
    "admin.updatedAt": serverTimestamp(),
    "admin.updatedBy": STATE.auth.user?.email || ""
  });
  toast("Estado actualizado");
  await refresh();
}

/* ---------------- CONVERSIÓN ---------------- */

async function findPassengerByPhone(phone) {
  const ph = normalizePhone(phone);
  if (!ph) return null;
  const qy = query(collection(db, "passengers"), where("phone", "==", ph), limit(1));
  const snap = await getDocs(qy);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

async function upsertMasterPassenger(p) {
  const phone = normalizePhone(p.phone || "");
  if (phone) {
    const existing = await findPassengerByPhone(phone);
    if (existing) return existing.id;
  }

  const { firstName, lastName } = splitName(p.fullName || "");

  const ref = await addDoc(collection(db, "passengers"), {
    firstName,
    lastName,
    phone,
    address: p.pickupAddress || "",
    localidad: p.pickupCity || "",
    active: true,
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

async function convertRequestToEvent(requestId) {
  const snap = await getDoc(doc(db, "tripRequests", requestId));
  const r = { id: snap.id, ...snap.data() };

  const startIso = safeIso(r.event?.date, r.phases?.ida?.time || r.phases?.vuelta?.time);
  const endIso = r.phases?.vuelta?.enabled
    ? safeIso(r.event?.date, r.phases?.vuelta?.time)
    : addHoursIso(startIso, 2);

  const evRef = await addDoc(collection(db, "events"), {
    name: r.event?.title || "Evento",
    address: r.event?.destinationAddress || "",
    localidad: r.event?.destinationCity || "",
    dateStart: startIso,
    dateEnd: endIso,
    phases: buildEventPhases(r),
    updatedAt: serverTimestamp()
  });

  for (const p of r.passengers || []) {
    const pid = await upsertMasterPassenger(p);
    await setDoc(doc(db, "events", evRef.id, "eventPassengers", pid), {
      requestId: r.id,
      updatedAt: serverTimestamp()
    });
  }

  await updateDoc(doc(db, "tripRequests", r.id), {
    status: "converted",
    "admin.convertedEventId": evRef.id,
    "admin.convertedAt": serverTimestamp()
  });

  toast("Convertido a evento");
  await refresh();
  await loadDetail(r.id);
}

/* ---------------- INIT ---------------- */

async function refresh() {
  const status = $("selRqStatus").value;
  const list = await fetchRequests(status);
  renderList(list);
}

(async function init() {
  await initCorePage({ page: "requests_admin" });

  if (!STATE.auth?.isAdmin) {
    document.body.innerHTML = "<p style='padding:20px'>Solo admin.</p>";
    return;
  }

  $("btnRefresh").onclick = refresh;
  $("selRqStatus").onchange = refresh;

  await refresh();
})();
