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
  if (!dateStr) {
    return new Date().toISOString();
  }

  const t = timeStr && timeStr.length >= 4 ? timeStr : "00:00";
  const d = new Date(`${dateStr}T${t}:00`);

  if (isNaN(d.getTime())) {
    return new Date().toISOString();
  }

  return d.toISOString();
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
    phases.push({
      id: "ida",
      name: "Ida",
      address: destAddress,
      city: destCity,
      time: r.phases.ida.time || ""
    });
  }

  if (r.phases?.vuelta?.enabled) {
    phases.push({
      id: "vuelta",
      name: "Vuelta",
      address: destAddress,
      city: destCity,
      time: r.phases.vuelta.time || ""
    });
  }

  return phases;
}

/* ---------------- CONVERSIÓN ---------------- */

async function findPassengerByPhone(phone) {
  const ph = normalizePhone(phone);
  if (!ph) return null;

  const qy = query(
    collection(db, "passengers"),
    where("phone", "==", ph),
    limit(1)
  );

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

  const newDoc = {
    firstName,
    lastName,
    phone,
    address: p.pickupAddress || "",
    localidad: p.pickupCity || "",
    active: true,
    updatedAt: serverTimestamp()
  };

  const ref = await addDoc(collection(db, "passengers"), newDoc);
  return ref.id;
}

async function convertRequestToEvent(requestId) {
  if (!STATE.auth?.isAdmin) throw new Error("Solo admin");

  const snap = await getDoc(doc(db, "tripRequests", requestId));
  if (!snap.exists()) throw new Error("No existe la solicitud");

  const r = { id: snap.id, ...snap.data() };

  if (r.status === "converted") {
    toast("Ya estaba convertida");
    return;
  }

  const dateStr = r.event?.date || "";

  const startIso = safeIso(
    dateStr,
    r.phases?.ida?.time || r.phases?.vuelta?.time
  );

  const endIso = r.phases?.vuelta?.enabled
    ? safeIso(dateStr, r.phases?.vuelta?.time)
    : addHoursIso(startIso, 2);

  const eventDoc = {
    name: r.event?.title || "Evento",
    address: r.event?.destinationAddress || "",
    localidad: r.event?.destinationCity || "",
    dateStart: startIso,
    dateEnd: endIso,
    phases: buildEventPhases(r),
    updatedAt: serverTimestamp()
  };

  const evRef = await addDoc(collection(db, "events"), eventDoc);

  const pax = Array.isArray(r.passengers) ? r.passengers : [];

  for (const p of pax) {
    const passengerId = await upsertMasterPassenger(p);

    await setDoc(
      doc(db, "events", evRef.id, "eventPassengers", passengerId),
      {
        requestId: r.id,
        notes: [
          p.notes || "",
          p.isMinor
            ? `Menor. Adulto: ${p.adultName || ""} (${p.adultPhone || ""})`
            : ""
        ].filter(Boolean).join(" | "),
        geo: null,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

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
