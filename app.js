// app.js (module)
import { app, db, auth } from "./firebase-init.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================
   STATE
========================= */
const STATE = {
  auth: {
    user: null,
    isAdmin: false,
    driver: null, // driver master record (by email)
  },
  events: [],
  eventId: null,

  // master data
  drivers: [],
  passengers: [],

  // per-event
  eventDrivers: [],      // [{id: driverId, ...linkDoc}]
  eventPassengers: [],   // [{id: passengerId, ...linkDoc}]
  assignments: [],       // [{id: driverId, driverId, passengerIds:[]}]
};

/* =========================
   Helpers
========================= */
const $ = (id) => document.getElementById(id);

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function escapeHtml(s) {
  s = String(s ?? "");
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fullName(x) {
  return `${x?.lastName || ""} ${x?.firstName || ""}`.trim();
}

function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

function ensureEventSelected() {
  if (!STATE.eventId) {
    throw new Error("No hay evento seleccionado.");
  }
}

/* =========================
   Auth UI
========================= */
function showAuthGate(hint) {
  const g = $("authGate");
  if (!g) return;
  g.classList.add("show");
  $("authGateHint").textContent = hint || "";
}

function hideAuthGate() {
  const g = $("authGate");
  if (!g) return;
  g.classList.remove("show");
  $("authGateHint").textContent = "";
}

function isAdminEmail(email) {
  return normEmail(email) === "pedro.l.oldani@gmail.com";
}

async function loginGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    // popup primero
    await signInWithPopup(auth, provider);
  } catch (e) {
    // en mobile suele fallar popup
    await signInWithRedirect(auth, provider);
  }
}

function wireGlobalAuthUI() {
  $("btnGoogleLogin")?.addEventListener("click", loginGoogle);
  $("btnGoogleLogin2")?.addEventListener("click", loginGoogle);

  $("btnLogout")?.addEventListener("click", async () => {
    await signOut(auth);
  });
}

/* =========================
   Navigation (tabs)
========================= */
function wireTabs() {
  document.querySelectorAll(".tab[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const v = btn.dataset.view;
      document.querySelectorAll(".view").forEach((s) => s.classList.remove("active"));
      const sec = $(`view-${v}`);
      if (sec) sec.classList.add("active");

      if (v === "map") {
        setTimeout(() => {
          try { renderMap(); } catch {}
        }, 50);
      }
    });
  });
}

/* =========================
   Loaders (Firestore)
========================= */
async function loadEvents() {
  const ref = collection(db, "events");
  const snap = await getDocs(query(ref, orderBy("dateStart", "desc")));
  STATE.events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadDriversAll() {
  const ref = collection(db, "drivers");
  const snap = await getDocs(query(ref, orderBy("lastName", "asc")));
  STATE.drivers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadPassengersAll() {
  const ref = collection(db, "passengers");
  const snap = await getDocs(query(ref, orderBy("lastName", "asc")));
  STATE.passengers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadEventDrivers() {
  ensureEventSelected();
  const ref = collection(db, `events/${STATE.eventId}/eventDrivers`);
  const snap = await getDocs(ref);
  STATE.eventDrivers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadEventPassengers() {
  ensureEventSelected();
  const ref = collection(db, `events/${STATE.eventId}/eventPassengers`);
  const snap = await getDocs(ref);
  STATE.eventPassengers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadAssignments() {
  ensureEventSelected();
  const ref = collection(db, `events/${STATE.eventId}/assignments`);
  const snap = await getDocs(ref);
  STATE.assignments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* =========================
   Event selector
========================= */
function renderEventSelect() {
  const sel = $("eventSelect");
  if (!sel) return;

  const saved = localStorage.getItem("selectedEventId");
  const found = saved ? STATE.events.find((e) => e.id === saved) : null;

  STATE.eventId = found ? found.id : (STATE.events[0]?.id || null);

  sel.innerHTML = (STATE.events || [])
    .map((e) => {
      const label = e.name || e.title || "Evento sin nombre";
      const ds = e.dateStart ? new Date(e.dateStart).toLocaleDateString("es-AR") : "";
      const de = e.dateEnd ? new Date(e.dateEnd).toLocaleDateString("es-AR") : "";
      const range = (ds || de) ? ` (${ds}${de ? " → " + de : ""})` : "";
      return `<option value="${e.id}">${escapeHtml(label + range)}</option>`;
    })
    .join("");

  if (STATE.eventId) sel.value = STATE.eventId;

  sel.addEventListener("change", async () => {
    STATE.eventId = sel.value || null;
    localStorage.setItem("selectedEventId", STATE.eventId || "");
    document.dispatchEvent(new CustomEvent("eventChanged"));
  });
}

async function refreshAll() {
  await loadDriversAll();
  await loadPassengersAll();

  if (STATE.eventId) {
    await loadEventDrivers();
    await loadEventPassengers();
    await loadAssignments();
  } else {
    STATE.eventDrivers = [];
    STATE.eventPassengers = [];
    STATE.assignments = [];
  }

  ensureDriversZoneFilter();
  ensurePassengersZoneFilter();
  ensureMapZoneFilter();
  ensureAssignmentZoneFilter();

  renderDashboard();
  renderDriversTable();
  renderPassengersTable();
  renderAssignments();
  renderTracking();
  renderMap();
}

/* =========================
   Master data finders
========================= */
function driverById(id) {
  return (STATE.drivers || []).find((d) => d.id === id) || null;
}

function passengerById(id) {
  return (STATE.passengers || []).find((p) => p.id === id) || null;
}

function driverByEmail(email) {
  const e = normEmail(email);
  if (!e) return null;
  return (STATE.drivers || []).find((d) => normEmail(d.email) === e) || null;
}

/* =========================
   Per-event helpers
========================= */
function isDriverInEvent(driverId) {
  return !!STATE.eventDrivers.find((x) => x.id === driverId);
}
function isPassengerInEvent(passengerId) {
  return !!STATE.eventPassengers.find((x) => x.id === passengerId);
}

function driverAssignment(driverId) {
  return (STATE.assignments || []).find((a) => a.id === driverId) || null;
}

function assignedCount(driverId) {
  const a = driverAssignment(driverId);
  return Array.isArray(a?.passengerIds) ? a.passengerIds.length : 0;
}

function getAssignedPassengersForDriver(driverId) {
  const a = driverAssignment(driverId);
  const ids = a?.passengerIds || [];
  return ids.map((pid) => passengerById(pid)).filter(Boolean);
}

function passengerAssignedDriverId(passengerId) {
  for (const a of STATE.assignments || []) {
    if ((a.passengerIds || []).includes(passengerId)) return a.id;
  }
  return null;
}

function passengerEventDoc(passengerId) {
  return STATE.eventPassengers.find((x) => x.id === passengerId) || null;
}

/* =========================
   Dashboard (EVENT)
========================= */
function renderDashboard() {
  const elP = $("statPassengers");
  if (!elP) return; // si estás en otra página

  const passengersInEvent = (STATE.eventPassengers || []).length;
  const driversInEvent = (STATE.eventDrivers || []).length;

  const assignedPassengers = new Set();
  for (const a of STATE.assignments || []) {
    for (const pid of a.passengerIds || []) assignedPassengers.add(pid);
  }
  const assigned = assignedPassengers.size;
  const pending = Math.max(0, passengersInEvent - assigned);

  const capTotal = (STATE.eventDrivers || [])
    .map((x) => driverById(x.id))
    .filter(Boolean)
    .reduce((acc, d) => acc + (Number(d.capacity) || 4), 0);

  const capUsed = (STATE.assignments || []).reduce((acc, a) => acc + (a.passengerIds?.length || 0), 0);

  $("statPassengers").textContent = passengersInEvent;
  $("statPassengers2").textContent = `${assigned} asignados • ${pending} pendientes`;

  $("statDrivers").textContent = driversInEvent;
  $("statDrivers2").textContent = `${capTotal} lugares totales`;

  $("statCapacity").textContent = `${capUsed}/${capTotal}`;
  $("statCapacity2").textContent = `${Math.max(0, capTotal - capUsed)} lugares libres`;

  // pendientes por zona (evento)
  const map = new Map();
  for (const ep of STATE.eventPassengers || []) {
    const pid = ep.id;
    const p = passengerById(pid);
    if (!p) continue;
    const hasDriver = !!passengerAssignedDriverId(pid);
    if (!hasDriver) {
      const z = (p.zone || "Sin zona");
      map.set(z, (map.get(z) || 0) + 1);
    }
  }

  const rows = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  $("pendingByZone").innerHTML = `
    <table>
      <thead><tr><th>Zona</th><th>Pendientes</th></tr></thead>
      <tbody>
        ${rows.map(([z, c]) => `<tr><td>${escapeHtml(z)}</td><td>${c}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

$("btnRefreshDashboard")?.addEventListener("click", () => refreshAll().catch(console.warn));

/* =========================
   DRIVERS UI (MASTER)
========================= */
function ensureDriversZoneFilter() {
  const sel = $("driverZoneFilter");
  if (!sel) return;

  const zones = Array.from(
    new Set((STATE.drivers || [])
      .map((d) => String(d.zone || "").trim())
      .filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const current = sel.value || "";
  sel.innerHTML = `<option value="">Todas las zonas</option>` +
    zones.map((z) => `<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join("");

  if (current && zones.includes(current)) sel.value = current;
}

$("driverSearch")?.addEventListener("input", renderDriversTable);
$("driverZoneFilter")?.addEventListener("change", renderDriversTable);
$("btnRefreshDrivers")?.addEventListener("click", () => refreshAll().catch(console.warn));
$("btnNewDriver")?.addEventListener("click", () => renderDriverDetailForm(null));

function renderDriversTable() {
  const wrap = $("driversTable");
  if (!wrap) return;

  const q = ($("driverSearch")?.value || "").toLowerCase().trim();
  const zf = ($("driverZoneFilter")?.value || "");

  const list = (STATE.drivers || []).filter((d) => {
    if (zf && String(d.zone || "") !== zf) return false;
    const hay = `${d.firstName || ""} ${d.lastName || ""} ${d.phone || ""} ${d.email || ""} ${d.zone || ""}`.toLowerCase();
    return !q || hay.includes(q);
  });

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Chofer</th><th>Tel</th><th>Email</th><th>Zona</th><th>Cap</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${list
