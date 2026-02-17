import { initCorePage, STATE, $, toast, escapeHtml} from "./core.js";

import {
  collection, addDoc, query, where, orderBy, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

import { db } from "./firebase-init.js";

let passengerCount = 0;

function passengerRow(idx, data = {}) {
  const d = {
    fullName: data.fullName || "",
    phone: data.phone || "",
    pickupAddress: data.pickupAddress || "",
    pickupCity: data.pickupCity || "",
    isMinor: !!data.isMinor,
    adultName: data.adultName || "",
    adultPhone: data.adultPhone || "",
    notes: data.notes || ""
  };

  return `
    <div class="card2" data-pr="${idx}">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <strong>Pasajero ${idx+1}</strong>
        <button class="btnLink" data-del="${idx}">Quitar</button>
      </div>

      <div class="grid2">
        <div class="field">
          <label>Nombre y apellido</label>
          <input class="input" data-f="fullName" value="${escapeHtml(d.fullName)}" />
        </div>
        <div class="field">
          <label>Teléfono</label>
          <input class="input" data-f="phone" value="${escapeHtml(d.phone)}" />
        </div>

        <div class="field">
          <label>Domicilio (ida)</label>
          <input class="input" data-f="pickupAddress" value="${escapeHtml(d.pickupAddress)}" />
        </div>
        <div class="field">
          <label>Ciudad</label>
          <input class="input" data-f="pickupCity" value="${escapeHtml(d.pickupCity)}" />
        </div>

        <div class="field">
          <label>¿Mayor de 15?</label>
          <select class="select" data-f="isMinor">
            <option value="no" ${d.isMinor ? "" : "selected"}>Sí</option>
            <option value="yes" ${d.isMinor ? "selected" : ""}>No</option>
          </select>
        </div>
        <div class="field">
          <label>Observaciones</label>
          <input class="input" data-f="notes" value="${escapeHtml(d.notes)}" placeholder="Opcional" />
        </div>

        <div class="field minorOnly" style="${d.isMinor ? "" : "display:none"}">
          <label>Adulto acompañante (nombre)</label>
          <input class="input" data-f="adultName" value="${escapeHtml(d.adultName)}" />
        </div>
        <div class="field minorOnly" style="${d.isMinor ? "" : "display:none"}">
          <label>Adulto acompañante (teléfono)</label>
          <input class="input" data-f="adultPhone" value="${escapeHtml(d.adultPhone)}" />
        </div>
      </div>
    </div>
  `;
}

function renderPassengersBox() {
  const rows = [];
  for (let i = 0; i < passengerCount; i++) rows.push(passengerRow(i));
  $("passengersBox").innerHTML = rows.join("") || `<p class="muted">Agregá al menos 1 pasajero.</p>`;

  // binds quitar
  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.del);
      // removemos el bloque visual y reindexamos reconstruyendo data desde DOM
      const all = readPassengersFromDOM();
      all.splice(idx, 1);
      passengerCount = all.length;
      $("passengersBox").innerHTML = all.map((p, i) => passengerRow(i, p)).join("");
      wirePassengerMinorToggles();
      wireRemoveButtons();
    });
  });

  wirePassengerMinorToggles();
}

function wireRemoveButtons() {
  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.del);
      const all = readPassengersFromDOM();
      all.splice(idx, 1);
      passengerCount = all.length;
      $("passengersBox").innerHTML = all.map((p, i) => passengerRow(i, p)).join("");
      wirePassengerMinorToggles();
      wireRemoveButtons();
    });
  });
}

function wirePassengerMinorToggles() {
  document.querySelectorAll("[data-pr] select[data-f='isMinor']").forEach(sel => {
    sel.addEventListener("change", () => {
      const wrap = sel.closest("[data-pr]");
      const show = sel.value === "yes";
      wrap.querySelectorAll(".minorOnly").forEach(x => x.style.display = show ? "" : "none");
    });
  });
}

function readPassengersFromDOM() {
  const items = [];
  document.querySelectorAll("[data-pr]").forEach(wrap => {
    const get = (f) => wrap.querySelector(`[data-f='${f}']`)?.value || "";
    const isMinor = (wrap.querySelector(`[data-f='isMinor']`)?.value === "yes");
    items.push({
      fullName: get("fullName").trim(),
      phone: get("phone").trim(),
      pickupAddress: get("pickupAddress").trim(),
      pickupCity: get("pickupCity").trim(),
      isMinor,
      adultName: get("adultName").trim(),
      adultPhone: get("adultPhone").trim(),
      notes: get("notes").trim()
    });
  });
  return items;
}

function applyVueltaSameAddress() {
  const same = $("rq_vuelta_same")?.checked;
  if (!same) return;

  $("rq_vuelta_dropoffAddress").value = $("rq_ida_pickupAddress").value || "";
  $("rq_vuelta_dropoffCity").value = $("rq_ida_pickupCity").value || "";
}

function validateRequest(payload) {
  const e = payload.event;
  if (!e.title) throw new Error("Completá 'Evento / Motivo'.");
  if (!e.date) throw new Error("Completá la fecha.");
  if (!e.destinationAddress) throw new Error("Completá la dirección de destino.");
  if (!e.destinationCity) throw new Error("Completá la ciudad de destino.");
  if (!payload.contactPhone) throw new Error("Completá el teléfono de contacto.");

  const idaOn = payload.phases?.ida?.enabled;
  const vueltaOn = payload.phases?.vuelta?.enabled;

  if (!idaOn && !vueltaOn) throw new Error("Tenés que seleccionar al menos Ida o Vuelta.");

  if (idaOn) {
    const ida = payload.phases.ida;
    if (!ida.pickupAddress) throw new Error("Completá la dirección de salida (Ida).");
    if (!ida.pickupCity) throw new Error("Completá la ciudad de salida (Ida).");
    if (!ida.time) throw new Error("Completá la hora (Ida).");
  }

  if (vueltaOn) {
    const v = payload.phases.vuelta;
    if (!v.time) throw new Error("Completá la hora (Vuelta).");
    if (!v.dropoffAddress) throw new Error("Completá la dirección de regreso (Vuelta).");
    if (!v.dropoffCity) throw new Error("Completá la ciudad de regreso (Vuelta).");
  }

  if (!payload.passengers?.length) throw new Error("Agregá al menos 1 pasajero.");

  payload.passengers.forEach((p, i) => {
    if (!p.fullName) throw new Error(`Falta nombre del pasajero ${i+1}.`);
    if (idaOn) {
      if (!p.pickupAddress) throw new Error(`Falta domicilio (Ida) del pasajero ${i+1}.`);
      if (!p.pickupCity) throw new Error(`Falta ciudad (Ida) del pasajero ${i+1}.`);
    }
    if (p.isMinor && !p.adultName) throw new Error(`Si el pasajero ${i+1} es menor, falta el adulto acompañante.`);
  });
}

async function createRequest() {
  applyVueltaSameAddress();

  const user = STATE.auth?.user;
  if (!user) throw new Error("No estás logueado.");

  const payload = {
    status: "open",
    createdAt: serverTimestamp(),
    createdByUid: user.uid,
    createdByEmail: user.email || "",
    createdByName: user.displayName || "",

    contactPhone: $("rq_contactPhone").value.trim(),

    event: {
      title: $("rq_title").value.trim(),
      description: $("rq_desc").value.trim(),
      date: $("rq_date").value,
      destinationAddress: $("rq_destAddress").value.trim(),
      destinationCity: $("rq_destCity").value.trim()
    },

    phases: {
      ida: {
        enabled: $("rq_ida_on").checked,
        pickupAddress: $("rq_ida_pickupAddress").value.trim(),
        pickupCity: $("rq_ida_pickupCity").value.trim(),
        time: $("rq_ida_time").value
      },
      vuelta: {
        enabled: $("rq_vuelta_on").checked,
        dropoffAddress: $("rq_vuelta_dropoffAddress").value.trim(),
        dropoffCity: $("rq_vuelta_dropoffCity").value.trim(),
        time: $("rq_vuelta_time").value
      }
    },

    passengers: readPassengersFromDOM(),

    admin: {
      notes: "",
      convertedAt: null,
      convertedBy: null,
      convertedEventId: null
    }
  };

  validateRequest(payload);

  await addDoc(collection(db, "tripRequests"), payload);
}

async function loadMyRequests() {
  const user = STATE.auth?.user;
  if (!user) return [];

  const qy = query(
    collection(db, "tripRequests"),
    where("createdByUid", "==", user.uid),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function renderMyRequests(list) {
  $("myRequests").innerHTML = list.length ? `
    <table>
      <thead><tr><th>Fecha</th><th>Evento</th><th>Fases</th><th>Estado</th></tr></thead>
      <tbody>
        ${list.map(r => {
          const phases = [];
          if (r.phases?.ida?.enabled) phases.push("Ida");
          if (r.phases?.vuelta?.enabled) phases.push("Vuelta");
          return `
            <tr>
              <td>${escapeHtml(r.event?.date || "")}</td>
              <td><strong>${escapeHtml(r.event?.title || "")}</strong></td>
              <td>${escapeHtml(phases.join(" + "))}</td>
              <td>${escapeHtml(r.status || "")}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  ` : `<p class="muted">Todavía no tenés solicitudes.</p>`;
}

async function refresh() {
  const list = await loadMyRequests();
  renderMyRequests(list);
}

(async function init(){
  await initCorePage({ page: "requests" });

  passengerCount = 1;
  renderPassengersBox();

  $("btnAddPassenger").addEventListener("click", () => {
    passengerCount++;
    renderPassengersBox();
  });

  $("rq_vuelta_same")?.addEventListener("change", applyVueltaSameAddress);

  $("btnCreateRequest").addEventListener("click", async () => {
    try {
      await createRequest();
      toast("Solicitud enviada");
      await refresh();
    } catch (e) {
      console.error(e);
      toast(e.message || String(e));
    }
  });

  await refresh();
})();
