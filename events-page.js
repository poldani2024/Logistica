// events-page.js
import { db } from "./firebase-init.js";
import { initAuthAndEvents, STATE, toast, escapeHtml, loadEvents, renderEventSelect } from "./core-auth.js";

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function toInputDT(tsOrDate) {
  if (!tsOrDate) return "";
  const d = tsOrDate?.toDate ? tsOrDate.toDate() : new Date(tsOrDate);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readForm() {
  const name = $("ev_name").value.trim();
  const start = $("ev_start").value;
  const end = $("ev_end").value;
  const address = $("ev_address").value.trim();
  const localidad = $("ev_localidad").value;

  if (!name) throw new Error("Falta el nombre");
  if (!start) throw new Error("Falta fecha/hora de inicio");
  if (!end) throw new Error("Falta fecha/hora de fin");
  if (new Date(start) > new Date(end)) throw new Error("Inicio no puede ser mayor que fin");
  if (!address) throw new Error("Falta domicilio");
  if (!localidad) throw new Error("Falta localidad");

  return {
    name,
    startAt: new Date(start),
    endAt: new Date(end),
    address,
    localidad,
  };
}

function fillForm(ev) {
  $("ev_name").value = ev?.name || "";
  $("ev_start").value = toInputDT(ev?.startAt);
  $("ev_end").value = toInputDT(ev?.endAt);
  $("ev_address").value = ev?.address || "";
  $("ev_localidad").value = ev?.localidad || "Rosario";
  $("ev_hint").textContent = ev?.id ? `Editando: ${ev.id}` : "Nuevo evento";
}

function renderTable() {
  const rows = (STATE.events || []).map(ev => {
    const start = ev.startAt?.toDate ? ev.startAt.toDate() : (ev.startAt ? new Date(ev.startAt) : null);
    const end = ev.endAt?.toDate ? ev.endAt.toDate() : (ev.endAt ? new Date(ev.endAt) : null);

    const fmt = (d) => d ? d.toLocaleString("es-AR") : "-";
    return `
      <tr>
        <td><strong>${escapeHtml(ev.name || "")}</strong><div class="muted">${escapeHtml(ev.id)}</div></td>
        <td>${escapeHtml(fmt(start))}</td>
        <td>${escapeHtml(fmt(end))}</td>
        <td>${escapeHtml(ev.address || "")}<div class="muted">${escapeHtml(ev.localidad || "")}</div></td>
        <td><button class="btnSecondary" data-edit="${escapeHtml(ev.id)}">Editar</button></td>
      </tr>
    `;
  }).join("");

  $("eventsTable").innerHTML = `
    <table>
      <thead><tr><th>Evento</th><th>Inicio</th><th>Fin</th><th>Domicilio</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted">No hay eventos</td></tr>`}</tbody>
    </table>
  `;

  $("eventsTable").querySelectorAll("button[data-edit]").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.dataset.edit;
      const ev = STATE.events.find(e => e.id === id);
      STATE.eventId = id;
      localStorage.setItem("selectedEventId", id);
      renderEventSelect();
      fillForm(ev);
    });
  });
}

async function refreshUI() {
  await loadEvents();
  renderEventSelect();
  renderTable();

  const current = STATE.eventId ? STATE.events.find(e => e.id === STATE.eventId) : null;
  fillForm(current || null);
}

(async function init() {
  await initAuthAndEvents({ adminEmail: "pedro.l.oldani@gmail.com" });

  $("btnReloadEvents").addEventListener("click", refreshUI);

  $("btnNew").addEventListener("click", async () => {
    try {
      const payload = readForm();
      const docRef = await addDoc(collection(db, "events"), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: STATE.auth.user?.uid || null,
      });
      toast("Evento creado");
      STATE.eventId = docRef.id;
      localStorage.setItem("selectedEventId", STATE.eventId);
      await refreshUI();
    } catch (e) {
      alert(e?.message || String(e));
    }
  });

  $("btnSave").addEventListener("click", async () => {
    try {
      if (!STATE.eventId) throw new Error("No hay evento seleccionado");
      const payload = readForm();
      await updateDoc(doc(db, "events", STATE.eventId), {
        ...payload,
        updatedAt: serverTimestamp(),
      });
      toast("Evento guardado");
      await refreshUI();
    } catch (e) {
      alert(e?.message || String(e));
    }
  });

  $("btnDelete").addEventListener("click", async () => {
    try {
      if (!STATE.eventId) throw new Error("No hay evento seleccionado");
      if (!confirm(`⚠️ Eliminar evento ${STATE.eventId}? (no borra choferes/pasajeros/asignaciones automáticamente)`)) return;
      await deleteDoc(doc(db, "events", STATE.eventId));
      toast("Evento eliminado");
      localStorage.removeItem("selectedEventId");
      STATE.eventId = null;
      await refreshUI();
    } catch (e) {
      alert(e?.message || String(e));
    }
  });

  document.addEventListener("eventChanged", () => {
    const current = STATE.eventId ? STATE.events.find(e => e.id === STATE.eventId) : null;
    fillForm(current || null);
  });

  await refreshUI();
})();
