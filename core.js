// core.js (Firebase v10+ modular, multipágina, GitHub Pages)
// - NO usa `firebase.*` global
// - Exporta helpers y mantiene STATE
// - Centraliza auth + carga de masters + eventos + contexto de evento

import { app, db } from "./firebase-init.js";

// Auth (modular)
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js";

// Firestore (modular)
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
  getDoc,
  serverTimestamp,
  runTransaction,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

/* -------------------------
 * Constantes + helpers DOM
 * ------------------------- */

export const $ = (id) => document.getElementById(id);

const PREF_KEYS = {
  theme: "uiThemeMode",
  fontScale: "uiFontScale"
};

function isAdmin(){
  const email = (STATE.auth.user?.email || "").trim().toLowerCase();
  if (!email) return false;
  const superAdmins = STATE.config?.superAdmins || [];
  if (superAdmins.some(e => e.trim().toLowerCase() === email)) return true;
  return false;
}

/* -------------------------
 * Users + permisos
 * ------------------------- */

export async function ensureUserProfile() {
  const u = STATE.auth?.user;
  if (!u) return;

  const ref = doc(db, "users", u.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      firstName: "",
      lastName: "",
      phone: "",
      email: (u.email || "").trim(),
      active: true,
      perms: {},
      updatedAt: serverTimestamp(),
      updatedBy: (u.email || "").trim()
    }, { merge: true });
  } else {
    const data = snap.data() || {};
    if (data.active === undefined) {
      await setDoc(ref, { active: true, updatedAt: serverTimestamp() }, { merge: true });
    }
  }
}

async function applyInviteIfExists() {
  const u = STATE.auth?.user;
  if (!u) return null;

  const email = (u.email || "").trim().toLowerCase();
  if (!email) return null;

  const userRef = doc(db, "users", u.uid);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.exists() ? (userSnap.data() || {}) : {};

  // Solo aplicar una vez
  if (userData.inviteAppliedAt) return null;

  const invRef = doc(db, "invites", email);
  const invSnap = await getDoc(invRef);
  if (!invSnap.exists()) return null;

  const inv = invSnap.data() || {};
  const patch = {
    email: (u.email || "").trim(),
    firstName: (inv.firstName || userData.firstName || "").trim(),
    lastName: (inv.lastName || userData.lastName || "").trim(),
    phone: (inv.phone || userData.phone || "").trim(),
    active: (inv.active === false) ? false : true,
    perms: (inv.perms && typeof inv.perms === "object") ? inv.perms : (userData.perms || {}),
    inviteAppliedAt: serverTimestamp(),
    inviteEmail: email,
    updatedAt: serverTimestamp(),
    updatedBy: (u.email || "").trim()
  };

  await setDoc(userRef, patch, { merge: true });

  // Marcar invitación como usada (no se elimina)
  await setDoc(invRef, {
    usedAt: serverTimestamp(),
    usedByUid: u.uid,
    usedByEmail: (u.email || "").trim()
  }, { merge: true });

  return patch;
}

export async function loadUserProfile() {
  const u = STATE.auth?.user;
  if (!u) return null;

  const ref = doc(db, "users", u.uid);
  const snap = await getDoc(ref);

  let profile = snap.exists() ? (snap.data() || {}) : null;

  // Si hay invitación pendiente, aplicarla y re-leer para tener permisos/active actualizados
  const applied = await applyInviteIfExists();
  if (applied) {
    const snap2 = await getDoc(ref);
    profile = snap2.exists() ? (snap2.data() || {}) : profile;
  }

  STATE.auth.profile = profile;

  const active = (profile && profile.active === false) ? false : true;
  STATE.auth.isActive = active;

  const base = (profile?.perms && typeof profile.perms === "object") ? profile.perms : {};
  const adminTotal = isAdmin() || !!base["Admin"];

  if (!active && !isAdmin()) {
    STATE.auth.perms = {};
    STATE.auth.isAdmin = false;
    return profile;
  }

  if (adminTotal) {
    STATE.auth.perms = {
      "Admin": true,
      "Eventos": true,
      "Solicitudes": true,
      "Admin.Solicitudes": true,
      "Choferes": true,
      "Pasajeros": true,
      "ChoferesXFase": true,
      "Asignaciones": true,
      "Tracking": true,
      "Mapa": true,
      "Permisos": true,
      "AceptInv": true
    };
    STATE.auth.isAdmin = true;
  } else {
    STATE.auth.perms = {
      "Admin": false,
      "Eventos": !!base["Eventos"],
      "Solicitudes": !!base["Solicitudes"],
      "Admin.Solicitudes": !!base["Admin.Solicitudes"],
      "Choferes": !!base["Choferes"],
      "Pasajeros": !!base["Pasajeros"],
      "ChoferesXFase": !!base["ChoferesXFase"],
      "Asignaciones": !!base["Asignaciones"],
      "Tracking": !!base["Tracking"],
      "Mapa": !!base["Mapa"],
      "Permisos": !!base["Permisos"],
      "AceptInv": !!base["AceptInv"]
    };
  }

  return profile;
}

export function can(key) {
  const k = String(key || "").trim();
  if (!k) return false;
  return !!STATE.auth?.perms?.[k];
}


/* -------------------------
 * Estado global
 * ------------------------- */

export const STATE = {
  auth: {
    user: null,
    isAdmin: false,
    isActive: true,
    profile: null,
    perms: {},
    driver: null // objeto driver master si matchea email
  },
  config: {
    superAdmins: [] // emails cargados desde config/superAdmins en Firestore
  },
  events: [],
  master: {
    drivers: [],
    passengers: []
  },
  event: {
    id: null,
    driverPhases: new Map(),          // driverId -> {phaseId:true}
    driverCapacityByPhase: new Map(), // driverId -> {phaseId: number}
    phases: [],
    driversIds: new Set(),
    passengersIds: new Set(),
    passengersMeta: new Map(), // passengerId -> meta (status/tracking/assignedDriverId/etc)
    assignments: new Map()     // driverId -> { driverId, passengerIds: [] }
  }
};

/* -------------------------
 * Red: retry + config
 * ------------------------- */

export async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const isNetworkErr = (
        String(e?.code || "").includes("unavailable") ||
        String(e?.code || "").includes("network") ||
        String(e?.message || "").toLowerCase().includes("network") ||
        String(e?.message || "").toLowerCase().includes("fetch")
      );
      if (!isNetworkErr || attempt === maxAttempts) throw e;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`withRetry: intento ${attempt}/${maxAttempts} fallido, reintentando en ${delay}ms…`, e);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function loadAppConfig() {
  try {
    const snap = await withRetry(() => getDoc(doc(db, "config", "superAdmins")));
    if (snap.exists()) {
      const data = snap.data() || {};
      STATE.config.superAdmins = Array.isArray(data.emails) ? data.emails : [];
    }
  } catch (e) {
    console.warn("loadAppConfig: no se pudo cargar config/superAdmins", e);
    STATE.config.superAdmins = [];
  }
}

export async function addPassengerToEvent(eventId, passengerId, extra = {}) {
  if (!eventId) throw new Error("No hay eventId");
  if (!passengerId) throw new Error("No hay passengerId");

  const ref = doc(db, "events", eventId, "eventPassengers", passengerId);
  await setDoc(ref, {
    notes: "",
    geo: null,
    updatedAt: serverTimestamp(),
    ...extra
  }, { merge: true });
}

// Exponer para debug (multipágina)
window.STATE = STATE;

/* -------------------------
 * UI: escape + toast
 * ------------------------- */

export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let _toastTimer = null;
export function toast(msg) {
  const el = $("toast");
  if (!el) {
    // fallback
    alert(msg);
    return;
  }
  el.textContent = String(msg ?? "");
  el.classList.add("show");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove("show");
    el.textContent = "";
  }, 2200);
}

/* -------------------------
 * Evento seleccionado (localStorage)
 * ------------------------- */

export function getSelectedEventId() {
  return localStorage.getItem("eventId") || "";
}

export function setSelectedEventId(id) {
  const v = (id || "").trim();
  localStorage.setItem("eventId", v);
  STATE.event.id = v || null;
}
export function driversForPhase(phaseId){
  const pid = String(phaseId || STATE.ui?.activePhase || "").trim();
  if (!pid) return [];

  const drivers = STATE.master?.drivers || [];
  const linked = STATE.event?.driversIds; // si usás el modelo viejo con Set()
  const map = STATE.event?.driverPhases;  // Map(driverId -> {phaseId:true})

  return drivers.filter(d => {
    // Si existe vínculo por evento (modelo viejo), respetarlo
    if (linked && typeof linked.has === "function" && !linked.has(d.id)) return false;

    // Si existe driverPhases (modelo nuevo), filtrar por fase
    if (map && typeof map.get === "function") {
      const phasesObj = map.get(d.id) || {};
      return phasesObj[pid] === true;
    }

    // Si no hay info de fases, no filtramos por fase
    return true;
  });
}
export function getActivePhaseId() {
  // compat: algunas versiones no traen STATE.ui
  if (!STATE.ui) STATE.ui = { activePhase: null };

  const phase = STATE.ui.activePhase;
  if (phase) return phase;

  // fallback: primera fase del evento
  const phases = STATE.event?.phases || [];
  return phases.length ? phases[0].id : null;
}

/* -------------------------
 * Auth
 * ------------------------- */

export const auth = getAuth(app);

let _authReadyPromise = null;

/**
 * Inicializa auth una sola vez:
 * - setPersistence(local)
 * - suscribe onAuthStateChanged y completa STATE.auth
 * - devuelve el user (o null)
 */
export async function ensureAuth() {
  if (_authReadyPromise) return _authReadyPromise;

  _authReadyPromise = (async () => {
    // Importante: en algunos browsers puede fallar si storage está bloqueado
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (e) {
      console.warn("setPersistence warning:", e);
      // seguimos igual: auth puede funcionar sin persistencia
    }

    // Soporte mobile/redirect: al volver del flujo OAuth no debe romper init
    try {
      await getRedirectResult(auth);
    } catch (e) {
      console.warn("getRedirectResult warning:", e);
    }

    return new Promise((resolve) => {
      let resolved = false;
      let nullTimer = null;

      const resolveReady = (user) => {
        if (resolved) return;
        resolved = true;
        if (nullTimer) clearTimeout(nullTimer);
        resolve(user || null);
      };

      nullTimer = setTimeout(() => {
        console.warn("onAuthStateChanged timeout: continuing with user=null");
        resolveReady(null);
      }, 4000);

      onAuthStateChanged(auth, (user) => {
        STATE.auth.user = user || null;
        STATE.auth.isAdmin = isAdmin();

        if (typeof refreshAuthUi === "function") refreshAuthUi();

        if (user) {
          resolveReady(user);
          return;
        }

        resolveReady(null);
      });
    });
  })();

  return _authReadyPromise;
}

/** Alias de compatibilidad si alguna página llama waitForAuth */
window.waitForAuth = ensureAuth;

export async function loginGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = String(e?.code || "");
    const msg = String(e?.message || "").toLowerCase();
    const popupBlocked = code.includes("popup") || msg.includes("popup") || msg.includes("blocked");
    const mobileLike = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || "");

    if (popupBlocked || mobileLike) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}

export async function logout() {
  await signOut(auth);
  STATE.auth.user = null;
  STATE.auth.driver = null;
  STATE.auth.isAdmin = false;
  refreshAuthUi();
}

/* -------------------------
 * Carga de master data
 * ------------------------- */

export async function loadMasterDrivers() {
  const snap = await withRetry(() =>
    getDocs(query(collection(db, "drivers"), orderBy("lastName")))
  );
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  arr.sort((a, b) =>
    `${a.lastName || ""} ${a.firstName || ""}`.localeCompare(`${b.lastName || ""} ${b.firstName || ""}`)
  );
  STATE.master.drivers = arr;
  return arr;
}

export async function loadMasterPassengers() {
  const snap = await withRetry(() =>
    getDocs(query(collection(db, "passengers"), orderBy("lastName")))
  );
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  arr.sort((a, b) =>
    `${a.lastName || ""} ${a.firstName || ""}`.localeCompare(`${b.lastName || ""} ${b.firstName || ""}`)
  );
  STATE.master.passengers = arr;
  return arr;
}

export function resolveDriverRoleFromMaster() {
  const email = (STATE.auth.user?.email || "").trim().toLowerCase();
  if (!email) {
    STATE.auth.driver = null;
    return null;
  }
  const d =
    (STATE.master.drivers || []).find(x =>
      String(x.email || "").trim().toLowerCase() === email
    ) || null;

  STATE.auth.driver = d;
  return d;
}

/* -------------------------
 * Eventos
 * ------------------------- */

export async function loadEvents() {
  const snap = await withRetry(() =>
    getDocs(query(collection(db, "events"), orderBy("dateStart")))
  );
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  STATE.events = arr;
  return arr;
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phoneticKey(s) {
  return normalizeText(s)
    .replace(/[bv]/g, "b")
    .replace(/[zsc]/g, "s")
    .replace(/[kgq]/g, "k")
    .replace(/h/g, "")
    .replace(/y/g, "i")
    .replace(/ll/g, "y")
    .replace(/\s+/g, "");
}

function parseEventDateValue(raw) {
  const v = String(raw || "").trim();
  if (!v) return Number.NEGATIVE_INFINITY;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmY = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmY) return Date.UTC(Number(dmY[3]), Number(dmY[2]) - 1, Number(dmY[1]));
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

function eventSortDate(ev) {
  return parseEventDateValue(ev?.dateStart || ev?.startDate || ev?.dateEnd || ev?.endDate || "");
}

export function renderEventSelect() {
  const sel = $("eventSelect");
  if (!sel) return;

  const allEvents = STATE.events || [];
  const eventLabel = (ev) => (ev?.name || ev?.title || "Evento sin nombre").trim();

  const sortedByRecent = [...allEvents].sort((a, b) => eventSortDate(b) - eventSortDate(a));
  const activeEvents = sortedByRecent.filter(ev => String(ev?.status || "").trim().toLowerCase() === "activo");

  const opts = sortedByRecent.map(ev => `<option value="${escapeHtml(ev.id)}">${escapeHtml(eventLabel(ev))}</option>`);
  sel.innerHTML = opts.join("") || `<option value="">(sin eventos)</option>`;

  const current = getSelectedEventId();
  const currentEv = sortedByRecent.find(ev => ev.id === current) || null;
  const currentIsActive = String(currentEv?.status || "").trim().toLowerCase() === "activo";
  const fallbackEv = activeEvents[0] || sortedByRecent[0] || null;
  const selectedEv = (currentEv && currentIsActive) ? currentEv : fallbackEv;

  if (selectedEv?.id) {
    setSelectedEventId(selectedEv.id);
    sel.value = selectedEv.id;
  }

  sel.style.display = "none";

  const field = sel.parentElement;
  if (!field) return;

  let activeWrap = field.querySelector("#eventActiveWrap");
  if (!activeWrap) {
    activeWrap = document.createElement("div");
    activeWrap.id = "eventActiveWrap";
    activeWrap.className = "row";
    activeWrap.style.gap = "8px";

    const activeInput = document.createElement("input");
    activeInput.id = "eventActiveDisplay";
    activeInput.className = "input";
    activeInput.readOnly = true;
    activeInput.setAttribute("aria-label", "Evento activo");
    activeInput.style.flex = "1";

    const btn = document.createElement("button");
    btn.id = "btnOpenEventPicker";
    btn.className = "btn";
    btn.type = "button";
    btn.textContent = "Cambiar";

    activeWrap.append(activeInput, btn);
    field.insertBefore(activeWrap, sel);
  }

  const activeInput = field.querySelector("#eventActiveDisplay");
  if (activeInput) activeInput.value = selectedEv ? eventLabel(selectedEv) : "Sin evento";

  const hint = $("eventHint");
  if (hint) {
    hint.textContent = selectedEv
      ? `Evento activo: ${eventLabel(selectedEv)}`
      : "No hay evento seleccionado";
  }

  let modal = document.getElementById("eventPickerModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "eventPickerModal";
    modal.className = "eventPickerModal";
    modal.innerHTML = `
      <div class="eventPickerCard">
        <div class="rowBetween" style="margin-bottom:10px;">
          <div>
            <div class="cardTitle" style="margin:0">Seleccionar evento</div>
            <div class="subtitle">Ordenado por fecha (más actual primero)</div>
          </div>
          <button class="btn" id="btnCloseEventPicker" type="button">Cerrar</button>
        </div>

        <div class="field" style="margin-bottom:10px;">
          <label>Buscar (fonética)</label>
          <input id="eventPickerSearch" class="input" type="search" placeholder="Ej: ombu, embu, hombu..." />
        </div>

        <div class="tableWrap" style="max-height:52vh; overflow:auto;">
          <table>
            <thead>
              <tr>
                <th>Evento</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Estado</th>
                <th>Localidad</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="eventPickerBody"></tbody>
          </table>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const renderPickerList = (query = "") => {
    const body = document.getElementById("eventPickerBody");
    if (!body) return;

    const qNorm = normalizeText(query);
    const qPh = phoneticKey(query);

    const filtered = !qNorm
      ? sortedByRecent
      : sortedByRecent.filter(ev => {
          const blob = [
            eventLabel(ev),
            ev?.localidad || "",
            ev?.address || "",
            ev?.dateStart || ev?.startDate || "",
            ev?.status || "",
          ].join(" ");
          const norm = normalizeText(blob);
          const pho = phoneticKey(blob);
          return norm.includes(qNorm) || pho.includes(qPh);
        });

    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted">No se encontraron eventos.</td></tr>';
      return;
    }

    body.innerHTML = filtered.map(ev => {
      const id = ev.id;
      const isActive = id === getSelectedEventId();
      const start = escapeHtml(String(ev?.dateStart || ev?.startDate || "-"));
      const end = escapeHtml(String(ev?.dateEnd || ev?.endDate || "-"));
      return `
        <tr style="${isActive ? "background: rgba(255,255,255,.09);" : ""}">
          <td><strong>${escapeHtml(eventLabel(ev))}</strong></td>
          <td>${start}</td>
          <td>${end}</td>
          <td>${escapeHtml(ev?.status || "-")}</td>
          <td>${escapeHtml(ev?.localidad || "-")}</td>
          <td>
            <button class="btn primary" data-pick-event="${escapeHtml(id)}" type="button">Seleccionar</button>
          </td>
        </tr>
      `;
    }).join("");

    body.querySelectorAll("button[data-pick-event]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.pickEvent;
        if (!id) return;
        setSelectedEventId(id);
        sel.value = id;

        try {
          await loadEventContext(id);
        } catch (e) {
          console.error("loadEventContext error", e);
        }

        const ev = allEvents.find(x => x.id === id);
        if (activeInput) activeInput.value = ev ? eventLabel(ev) : "Sin evento";
        if (hint) hint.textContent = ev ? `Evento activo: ${eventLabel(ev)}` : "No hay evento seleccionado";

        modal?.classList.remove("show");
        document.dispatchEvent(new CustomEvent("eventChanged", { detail: { eventId: id } }));
      });
    });
  };

  const openPicker = () => {
    modal?.classList.add("show");
    const search = document.getElementById("eventPickerSearch");
    if (search) {
      search.value = "";
      renderPickerList("");
      setTimeout(() => search.focus(), 0);
    } else {
      renderPickerList("");
    }
  };

  if (!activeWrap.dataset.bound) {
    activeWrap.querySelector("#btnOpenEventPicker")?.addEventListener("click", openPicker);
    modal?.querySelector("#btnCloseEventPicker")?.addEventListener("click", () => modal?.classList.remove("show"));
    modal?.addEventListener("click", (ev) => {
      if (ev.target === modal) modal.classList.remove("show");
    });

    const search = modal?.querySelector("#eventPickerSearch");
    search?.addEventListener("input", () => renderPickerList(search.value));

    activeWrap.dataset.bound = "1";
  }

  renderPickerList(modal?.querySelector("#eventPickerSearch")?.value || "");
}

/* -------------------------
 * Contexto por evento (subcolecciones)
 * ------------------------- */

export async function loadEventContext(eventId) {
  const id = (eventId || getSelectedEventId() || "").trim();
  STATE.event.id = id || null;

  // reset contexto en memoria
  STATE.event.phases = [];
  STATE.event.driverPhases = new Map();
  STATE.event.driverCapacityByPhase = new Map();
  STATE.event.driversIds = new Set();
  STATE.event.passengersIds = new Set();
  STATE.event.passengersMeta = new Map();
  STATE.event.assignments = new Map();

  if (!STATE.event.id) return;

  // 1) Doc del evento: fases
  const evSnap = await getDoc(doc(db, "events", STATE.event.id));
  if (evSnap.exists()) {
    const ev = evSnap.data() || {};
    const phases = Array.isArray(ev.phases) ? ev.phases : [];
    STATE.event.phases = phases
      .map(p => ({
        id: String(p.id || "").trim(),
        name: String(p.name || p.id || "").trim(),
        originAddress: p.originAddress || "",
        destinationAddress: p.destinationAddress || p.address || "",
        localidad: p.localidad || "",
        date: p.date || "",
        time: p.time || ""
      }))
      .filter(p => p.id);
  }

  // 2) drivers links + disponibilidad por fase
  const dSnap = await getDocs(collection(db, "events", STATE.event.id, "eventDrivers"));
  dSnap.forEach(x => {
    STATE.event.driversIds.add(x.id);
    const data = x.data() || {};
    const phasesObj = (data.phases && typeof data.phases === "object") ? data.phases : {};
    STATE.event.driverPhases.set(x.id, phasesObj);
    const capByPhase = (data.capacityByPhase && typeof data.capacityByPhase === "object") ? data.capacityByPhase : {};
    STATE.event.driverCapacityByPhase.set(x.id, capByPhase);
  });

  // 3) passengers links + meta
  const pSnap = await getDocs(collection(db, "events", STATE.event.id, "eventPassengers"));
  pSnap.forEach(x => {
    STATE.event.passengersIds.add(x.id);
    STATE.event.passengersMeta.set(x.id, x.data() || {});
  });

  // 4) assignments (1 doc por driverId) — soporta fases + compat vieja
  const aSnap = await getDocs(collection(db, "events", STATE.event.id, "assignments"));
  aSnap.forEach(x => {
    const raw = x.data() || {};
    const phases = (raw.phases && typeof raw.phases === "object") ? raw.phases : {};
    // compat: si existe passengerIds (modelo viejo) y no hay phases.ida, mapearlo
    if (!Array.isArray(phases.ida) && Array.isArray(raw.passengerIds)) {
      phases.ida = raw.passengerIds;
    }
    STATE.event.assignments.set(x.id, {
      ...raw,
      driverId: raw.driverId || x.id,
      phases,
      passengerIds: Array.isArray(raw.passengerIds) ? raw.passengerIds : []
    });
  });
}
export async function saveDriverPhase(driverId, phaseId, enabled, capacityForPhase){
  if (!STATE.event?.id) throw new Error("No hay evento seleccionado");
  if (!driverId) throw new Error("Falta driverId");
  if (!phaseId) throw new Error("Falta phaseId");

  const ref = doc(db, "events", STATE.event.id, "eventDrivers", driverId);

  const update = {
    phases: { [phaseId]: !!enabled },
    updatedAt: serverTimestamp()
  };

  const cap = Number(capacityForPhase);
  if (Number.isFinite(cap) && cap > 0) {
    update.capacityByPhase = { [phaseId]: cap };
  }

  await setDoc(ref, update, { merge: true });

  // mantener STATE sincronizado en memoria
  STATE.event.driverPhases = STATE.event.driverPhases || new Map();
  const current = STATE.event.driverPhases.get(driverId) || {};
  current[phaseId] = !!enabled;
  STATE.event.driverPhases.set(driverId, current);

  if (Number.isFinite(cap) && cap > 0) {
    STATE.event.driverCapacityByPhase = STATE.event.driverCapacityByPhase || new Map();
    const capCurrent = STATE.event.driverCapacityByPhase.get(driverId) || {};
    capCurrent[phaseId] = cap;
    STATE.event.driverCapacityByPhase.set(driverId, capCurrent);
  }
}

export function getDriverCapacityForPhase(driverId, phaseId){
  const capByPhase = STATE.event?.driverCapacityByPhase?.get(driverId) || {};
  const perPhase = capByPhase[phaseId];
  if (perPhase != null) {
    const n = Number(perPhase);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null; // sin override: usar la capacidad del master driver
}

export function driversInEvent() {
  const ids = STATE.event.driversIds;
  return (STATE.master.drivers || []).filter(d => ids.has(d.id));
}

export function passengersInEvent() {
  const ids = STATE.event.passengersIds;
  return (STATE.master.passengers || [])
    .filter(p => ids.has(p.id))
    .map(p => ({ ...p, _event: (STATE.event.passengersMeta.get(p.id) || {}) }));
}

export function assignmentForDriver(driverId) {
  return STATE.event.assignments.get(driverId) || { driverId, passengerIds: [], phases: {} };
}

export function assignedDriverIdForPassenger(passengerId) {
  const meta = STATE.event.passengersMeta.get(passengerId) || {};
  return meta.assignedDriverId || "";
}

/* -------------------------
 * Mutaciones: eventos / links / asignaciones / tracking
 * ------------------------- */

export async function saveEvent({ id, name, status, dateStart, dateEnd, address, localidad }) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin puede guardar eventos");

  const eventId = (id || "").trim();
  if (!eventId) throw new Error("Falta ID del evento");

  const payload = {
    name: (name || "").trim(),
    status: (status || "Nuevo").trim() || "Nuevo",
    dateStart: dateStart ? new Date(dateStart).toISOString() : null,
    dateEnd: dateEnd ? new Date(dateEnd).toISOString() : null,
    address: (address || "").trim(),
    localidad: (localidad || "").trim(),
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, "events", eventId), payload, { merge: true });
}

export async function linkDriversToEvent(driverIds, enabled) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const batch = writeBatch(db);
  for (const id of driverIds) {
    const ref = doc(db, "events", STATE.event.id, "eventDrivers", id);
    if (enabled) batch.set(ref, { linkedAt: serverTimestamp() }, { merge: true });
    else batch.delete(ref);
  }
  await batch.commit();
}

export async function linkPassengersToEvent(passengerIds, enabled) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const batch = writeBatch(db);
  for (const id of passengerIds) {
    const ref = doc(db, "events", STATE.event.id, "eventPassengers", id);
    if (enabled) {
      batch.set(ref, {
        status: "Pendiente",
        trackingStatus: "Pendiente",
        trackingNote: "",
        assignedDriverId: "",
        linkedAt: serverTimestamp()
      }, { merge: true });
    } else {
      batch.delete(ref);
    }
  }
  await batch.commit();
}

export async function assignPassengerToDriver({ passengerId, driverId }) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const pRef = doc(db, "events", STATE.event.id, "eventPassengers", passengerId);
  const aRef = doc(db, "events", STATE.event.id, "assignments", driverId);

  await runTransaction(db, async (tx) => {
    const aSnap = await tx.get(aRef);
    const current = aSnap.exists() ? (aSnap.data().passengerIds || []) : [];
    const set = new Set(current);
    set.add(passengerId);

    tx.set(aRef, { passengerIds: Array.from(set), updatedAt: serverTimestamp() }, { merge: true });

    tx.set(pRef, {
      assignedDriverId: driverId,
      status: "Asignado",
      trackingUpdatedAt: serverTimestamp(),
      trackingUpdatedBy: STATE.auth.user?.email || ""
    }, { merge: true });
  });
}

export async function unassignPassenger({ passengerId, driverId }) {
  if (!STATE.auth.isAdmin) throw new Error("Solo Admin");
  if (!STATE.event.id) throw new Error("No hay evento seleccionado");

  const pRef = doc(db, "events", STATE.event.id, "eventPassengers", passengerId);
  const aRef = doc(db, "events", STATE.event.id, "assignments", driverId);

  await runTransaction(db, async (tx) => {
    const aSnap = await tx.get(aRef);
    const current = aSnap.exists() ? (aSnap.data().passengerIds || []) : [];
    const next = current.filter(x => x !== passengerId);

    if (next.length) tx.set(aRef, { passengerIds: next, updatedAt: serverTimestamp() }, { merge: true });
    else tx.delete(aRef);

    tx.set(pRef, {
      assignedDriverId: "",
      status: "Pendiente",
      trackingUpdatedAt: serverTimestamp(),
      trackingUpdatedBy: STATE.auth.user?.email || ""
    }, { merge: true });
  });
}

export async function updateTrackingAsDriver({
  passengerId,
  trackingStatus,
  trackingNote,
  phaseId,
  driverId // opcional: para admin o cuando está en "Todos"
}) {
  if (!STATE.event?.id) throw new Error("No hay evento seleccionado");
  if (!passengerId) throw new Error("Falta passengerId");
  if (!phaseId) throw new Error("Falta phaseId");

  const isAdmin = !!STATE.auth?.isAdmin;
  const me = STATE.auth?.driver;

  // quién es el "chofer objetivo" para validar asignación
  const targetDriverId = (isAdmin && driverId) ? driverId : me?.id;
  if (!targetDriverId) throw new Error("No sos chofer en el sistema (y no sos admin)");

  // validar que el pasajero esté asignado a ese chofer en ESA fase
  const a = assignmentForDriver(targetDriverId) || {};
  const phases = (a.phases && typeof a.phases === "object") ? a.phases : {};
  const ids = Array.isArray(phases[phaseId]) ? phases[phaseId]
            : ((phaseId === "ida" && Array.isArray(a.passengerIds)) ? a.passengerIds : []);

  if (!ids.includes(passengerId)) {
    throw new Error("Ese pasajero no está asignado a ese chofer en esta fase");
  }

  // guardar tracking por fase en eventPassengers/{passengerId}
  const pRef = doc(db, "events", STATE.event.id, "eventPassengers", passengerId);

  const status = trackingStatus || "Pendiente";
  const note = (trackingNote || "").trim();

  await updateDoc(pRef, {
    [`trackingByPhase.${phaseId}.status`]: status,
    [`trackingByPhase.${phaseId}.note`]: note,
    [`trackingByPhase.${phaseId}.updatedAt`]: serverTimestamp(),
    [`trackingByPhase.${phaseId}.updatedBy`]: STATE.auth.user?.email || ""
  });
}


/* -------------------------
 * Historial de asignaciones
 * ------------------------- */

export async function addAssignmentHistory(eventId, action, details = {}) {
  if (!eventId) return;
  if (!STATE.auth?.user) return;
  try {
    const { addDoc, collection: col } = await import("https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js");
    await addDoc(col(db, "events", eventId, "history"), {
      action,
      ...details,
      at: serverTimestamp(),
      by: STATE.auth.user?.email || "",
      byUid: STATE.auth.user?.uid || ""
    });
  } catch (e) {
    console.warn("addAssignmentHistory error:", e);
  }
}

export async function loadAssignmentHistory(eventId, limitCount = 50) {
  if (!eventId) return [];
  try {
    const { query: q, collection: col, orderBy: ob, limit: lim, getDocs: gd } =
      await import("https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js");
    const snap = await withRetry(() =>
      gd(q(col(db, "events", eventId, "history"), ob("at", "desc"), lim(limitCount)))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("loadAssignmentHistory error:", e);
    return [];
  }
}

function refreshAuthUi(){
  const st = $("authStatus");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  const u = STATE.auth.user;

  if (st) {
    st.textContent = u
      ? `Ingresado: ${u.email}${STATE.auth.isAdmin ? " (Admin)" : (STATE.auth.driver ? " (Chofer)" : "")}${STATE.auth.isActive === false ? " (Inactivo)" : ""}`
      : "No ingresado";
  }

  if (btnLogin) btnLogin.style.display = u ? "none" : "";
  if (btnLogout) btnLogout.style.display = u ? "" : "none";
}

function preferenceKey(baseKey){
  const uid = STATE.auth?.user?.uid || "anon";
  return `${baseKey}:${uid}`;
}

function applyTheme(theme){
  document.body.classList.toggle("theme-light", theme === "light");
}

function applyFontScale(scale){
  const valid = Number(scale);
  const finalScale = Number.isFinite(valid) && valid > 0 ? valid : 1;
  document.documentElement.style.setProperty("--font-scale", String(finalScale));
}

function ensureAppearanceControls(){
  const actions = document.querySelector(".topbar-actions");
  if (!actions || document.getElementById("themeModeDark")) return;
  const wrap = document.createElement("div");
  wrap.className = "appearanceInline";
  wrap.innerHTML = `
    <div class="themeOptions" role="group" aria-label="Preferencias visuales">
      <div class="themeSwitch" role="radiogroup" aria-label="Modo de color">
        <label class="themeOption"><input type="radio" name="themeMode" value="dark" id="themeModeDark"><span>Oscuro</span></label>
        <label class="themeOption"><input type="radio" name="themeMode" value="light" id="themeModeLight"><span>Claro</span></label>
      </div>
      <select id="fontScaleSelect" aria-label="Tamaño de letra" class="fontSizeInline">
        <option value="0.9">Pequeña</option><option value="1">Normal</option><option value="1.1">Grande</option><option value="1.2">Muy grande</option>
      </select>
    </div>`;
  actions.appendChild(wrap);
}

function setupAppearanceControls(){
  applyStoredAppearancePreferences();

  const themeDark = $("themeModeDark");
  const themeLight = $("themeModeLight");
  const fontScaleSelect = $("fontScaleSelect");
  if (!themeDark || !themeLight || !fontScaleSelect) return;
  const savedTheme = localStorage.getItem(preferenceKey(PREF_KEYS.theme)) || "dark";
  const savedScale = localStorage.getItem(preferenceKey(PREF_KEYS.fontScale)) || "1";
  const selectedTheme = savedTheme === "light" ? "light" : "dark";
  themeDark.checked = selectedTheme === "dark";
  themeLight.checked = selectedTheme === "light";
  fontScaleSelect.value = ["0.9","1","1.1","1.2"].includes(savedScale) ? savedScale : "1";
  applyTheme(selectedTheme);
  applyFontScale(fontScaleSelect.value);
  [themeDark, themeLight].forEach(input => input.addEventListener("change", () => {
    if (!input.checked) return;
    localStorage.setItem(preferenceKey(PREF_KEYS.theme), input.value);
    applyTheme(input.value);
  }));
  fontScaleSelect.addEventListener("change", () => {
    const v = ["0.9","1","1.1","1.2"].includes(fontScaleSelect.value) ? fontScaleSelect.value : "1";
    localStorage.setItem(preferenceKey(PREF_KEYS.fontScale), v);
    applyFontScale(v);
  });
}

function applyStoredAppearancePreferences(){
  const savedTheme = localStorage.getItem(preferenceKey(PREF_KEYS.theme)) || "dark";
  const savedScale = localStorage.getItem(preferenceKey(PREF_KEYS.fontScale)) || "1";
  applyTheme(savedTheme === "light" ? "light" : "dark");
  applyFontScale(["0.9","1","1.1","1.2"].includes(savedScale) ? savedScale : "1");
}

/* -------------------------
 * Inicialización por página
 * ------------------------- */

/**
 * initCorePage:
 * - engancha botones login/logout (si existen)
 * - ensureAuth()
 * - carga masters (drivers) para resolver rol chofer
 * - carga eventos + render selector
 * - carga contexto del evento activo (si existe)
 *
 * page: "home" | "events" | "drivers" | "passengers" | "assignments" | "tracking"
 */
export async function initCorePage({ page }) {
  ensureAppearanceControls();
  refreshAuthUi();

  // Botones auth (si existen)
 $("btnLogin")?.addEventListener("click", async () => {
  try {
    await loginGoogle();
  } catch (e) {
    console.error("loginGoogle error", e);
    toast(e.message || String(e));
  }
});

  $("btnLogout")?.addEventListener("click", async () => {
    try { await logout(); } catch (e) { console.error(e); toast(e.message || String(e)); }
  });

  // 1) Auth
  await ensureAuth();

  // UI status
  refreshAuthUi();
  setupAppearanceControls();

  if (!STATE.auth.user) {
    toast("Necesitás ingresar con Google para usar la app");
    return;
  }

  // Config global (superAdmins desde Firestore)
  await loadAppConfig();

  // Recalcular isAdmin con config cargada
  const email = (STATE.auth.user?.email || "").trim().toLowerCase();
  STATE.auth.isAdmin = isAdmin() || !!(STATE.auth.profile?.perms?.Admin);
  refreshAuthUi();

  // Perfil + permisos
  try {
    await ensureUserProfile();
    await loadUserProfile();
  } catch (e) {
    console.warn("loadUserProfile warning:", e);
  }

  if (STATE.auth.isActive === false && !isAdmin()) {
    document.body.innerHTML = "<p style='padding:20px'>Tu usuario está inactivo. Contactá a un administrador.</p>";
    return;
  }

  // 2) Master drivers -> resolver rol chofer
  await loadMasterDrivers();
  resolveDriverRoleFromMaster();

  // Update status con rol chofer si aplica
  refreshAuthUi();

  // 3) Eventos + selector
  await loadEvents();
  renderEventSelect();

  $("btnReloadEvents")?.addEventListener("click", async () => {
    await loadEvents();
    renderEventSelect();
    toast("Eventos recargados");
  });

  // 4) Evento inicial
  setSelectedEventId(getSelectedEventId());
  if (getSelectedEventId()) {
    await loadEventContext(getSelectedEventId());
  }

  // Home: hint
  if (page === "home") {
    const hint = $("eventHint");
    if (hint) {
      hint.textContent = getSelectedEventId()
        ? `Evento activo: ${getSelectedEventId()}`
        : "No hay evento seleccionado";
    }
  }
}
