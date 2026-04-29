// mi-ruta.js — Vista simplificada para choferes: "Mi Ruta del Día"
import {
  initCorePage,
  STATE,
  $,
  toast,
  escapeHtml,
  loadMasterPassengers,
  loadEventContext,
  assignmentForDriver,
  getActivePhaseId,
  updateTrackingAsDriver,
  withRetry
} from "./core.js";

import { requestNotificationPermission, listenForegroundMessages, showInAppNotification } from "./fcm.js";

function fullName(x) {
  return `${x?.lastName || ""} ${x?.firstName || ""}`.trim() || "(sin nombre)";
}

function getTrackingStatus(p, phaseId) {
  const ep = p?._event || {};
  const byPhase = ep?.trackingByPhase || {};
  const rec = phaseId && byPhase[phaseId];
  return rec?.status || ep?.trackingStatus || "Pendiente";
}

function getStatusLabel(status) {
  const map = {
    "Pendiente": "Pendiente",
    "EnCamino": "En camino",
    "Recogido": "Recogido / Llegó",
    "Ausente": "Ausente"
  };
  return map[status] || status;
}

function renderPhaseBar() {
  const tabs = $("faseTabs");
  if (!tabs) return;

  const phases = STATE.event?.phases || [];
  if (!phases.length) {
    tabs.innerHTML = '<span class="muted">Sin fases definidas</span>';
    return;
  }

  const active = getActivePhaseId() || phases[0]?.id;
  if (!STATE.ui) STATE.ui = {};
  STATE.ui.activePhase = active;

  tabs.innerHTML = phases.map(p => `
    <button class="btn ${p.id === active ? "primary" : ""}" data-phase="${escapeHtml(p.id)}" type="button">
      ${escapeHtml(p.name || p.id)}
    </button>
  `).join("");

  tabs.querySelectorAll("button[data-phase]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!STATE.ui) STATE.ui = {};
      STATE.ui.activePhase = btn.dataset.phase;
      renderPhaseBar();
      renderRuta();
    });
  });
}

function getMyPassengers(phaseId) {
  const me = STATE.auth.driver;
  if (!me) return [];

  const assignment = assignmentForDriver(me.id);
  const phases = (assignment?.phases && typeof assignment.phases === "object") ? assignment.phases : {};
  let ids = Array.isArray(phases[phaseId]) ? phases[phaseId] : [];

  // compat: si no hay fase específica, intentar con passengerIds
  if (!ids.length && phaseId === "ida" && Array.isArray(assignment?.passengerIds)) {
    ids = assignment.passengerIds;
  }

  const passMap = new Map((STATE.master.passengers || []).map(p => [p.id, p]));
  return ids.map(id => {
    const p = passMap.get(id);
    if (!p) return null;
    return {
      ...p,
      _event: STATE.event.passengersMeta.get(id) || {}
    };
  }).filter(Boolean);
}

function renderStats(passengers, phaseId) {
  const total = passengers.length;
  const recogidos = passengers.filter(p => {
    const s = getTrackingStatus(p, phaseId);
    return s === "Recogido";
  }).length;
  const ausentes = passengers.filter(p => getTrackingStatus(p, phaseId) === "Ausente").length;
  const pendientes = total - recogidos - ausentes;

  $("statTotal").textContent = total;
  $("statRecogidos").textContent = recogidos;
  $("statPendientes").textContent = Math.max(0, pendientes);
  $("statAusentes").textContent = ausentes;
}

function renderMapPreview(passengers) {
  const mapDiv = $("mapPreview");
  if (!mapDiv) return;

  const withCoords = passengers.filter(p => p.lat && p.lng);
  if (!withCoords.length) {
    mapDiv.textContent = "Mapa disponible cuando los pasajeros tienen geolocalización";
    return;
  }

  const avgLat = withCoords.reduce((s, p) => s + p.lat, 0) / withCoords.length;
  const avgLng = withCoords.reduce((s, p) => s + p.lng, 0) / withCoords.length;

  const markers = withCoords.map(p =>
    `markers=color:blue%7Clabel:P%7C${p.lat},${p.lng}`
  ).join("&");

  // Enlace a Google Maps con todos los puntos
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${avgLat},${avgLng}&waypoints=${
    withCoords.map(p => `${p.lat},${p.lng}`).join("|")
  }`;

  mapDiv.innerHTML = `
    <div style="width:100%;text-align:center;">
      <p class="muted" style="margin-bottom:8px;">${withCoords.length} pasajeros con ubicación</p>
      <a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener" class="btn primary">
        Abrir ruta en Google Maps
      </a>
    </div>
  `;
}

async function setStatus(passengerId, status, phaseId) {
  try {
    await withRetry(() =>
      updateTrackingAsDriver({ passengerId, trackingStatus: status, phaseId })
    );
    await loadEventContext(STATE.event.id);
    renderRuta();
    toast(`Estado actualizado: ${getStatusLabel(status)}`);
  } catch (e) {
    console.error("setStatus error", e);
    toast(e.message || "Error al actualizar estado");
  }
}

function renderRuta() {
  const lista = $("rutaLista");
  if (!lista) return;

  const phaseId = getActivePhaseId();
  const passengers = getMyPassengers(phaseId);

  renderStats(passengers, phaseId);
  renderMapPreview(passengers);

  if (!passengers.length) {
    lista.innerHTML = `
      <div class="card" style="text-align:center; padding:24px;">
        <p class="muted">No tenés pasajeros asignados en esta fase.</p>
      </div>
    `;
    return;
  }

  lista.innerHTML = passengers.map((p, i) => {
    const status = getTrackingStatus(p, phaseId);
    const statusClass = `status-${status.replace(/\s+/g, "")}`;
    const tel = (p.phone || "").replace(/\D/g, "");
    const telLink = tel ? `<a href="tel:${escapeHtml(tel)}">${escapeHtml(p.phone)}</a>` : "<span class='muted'>Sin teléfono</span>";
    const waLink = tel
      ? `<a href="https://wa.me/54${tel.replace(/^0/, "")}" target="_blank" rel="noopener" class="btn" style="font-size:12px;padding:4px 8px;">WhatsApp</a>`
      : "";

    return `
      <div class="ruta-card">
        <div class="pasajero-row">
          <div class="pasajero-num">${i + 1}</div>
          <div class="pasajero-info">
            <div class="pasajero-nombre">${escapeHtml(fullName(p))}</div>
            <div class="pasajero-dir">
              ${escapeHtml(p.address || "Sin dirección")}
              ${p.localidad ? ` · ${escapeHtml(p.localidad)}` : ""}
            </div>
            <div class="pasajero-tel">${telLink}</div>
          </div>
          <span class="status-badge ${statusClass}">${escapeHtml(getStatusLabel(status))}</span>
        </div>
        <div class="ruta-actions">
          <button class="btn" data-set-status="EnCamino" data-pid="${escapeHtml(p.id)}" type="button">En camino</button>
          <button class="btn primary" data-set-status="Recogido" data-pid="${escapeHtml(p.id)}" type="button">Recogido</button>
          <button class="btn" data-set-status="Ausente" data-pid="${escapeHtml(p.id)}" type="button">Ausente</button>
          <button class="btn" data-set-status="Pendiente" data-pid="${escapeHtml(p.id)}" type="button">Resetear</button>
          ${waLink}
        </div>
      </div>
    `;
  }).join("");

  lista.querySelectorAll("button[data-set-status]").forEach(btn => {
    btn.addEventListener("click", () => {
      const passengerId = btn.dataset.pid;
      const status = btn.dataset.setStatus;
      if (passengerId && status) setStatus(passengerId, status, phaseId);
    });
  });
}

function buildWhatsAppRuta() {
  const phaseId = getActivePhaseId();
  const passengers = getMyPassengers(phaseId);
  const me = STATE.auth.driver;
  const eventName = (STATE.events || []).find(e => e.id === STATE.event.id)?.name || "el evento";

  if (!passengers.length) {
    toast("No tenés pasajeros asignados para armar el mensaje");
    return;
  }

  const lines = [`Mi ruta para *${eventName}*:\n`];
  passengers.forEach((p, i) => {
    const status = getTrackingStatus(p, phaseId);
    lines.push(`${i + 1}. *${fullName(p)}*`);
    if (p.address) lines.push(`   📍 ${p.address}${p.localidad ? ` (${p.localidad})` : ""}`);
    if (p.phone) lines.push(`   📞 ${p.phone}`);
    lines.push(`   Estado: ${getStatusLabel(status)}`);
    lines.push("");
  });

  const msg = lines.join("\n");
  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank", "noopener");
}

(async function init() {
  try {
    await initCorePage({ page: "mi-ruta" });

    if (!STATE.auth.user) return;

    await loadMasterPassengers();

    const $loading = $("loadingMsg");
    const $content = $("rutaContent");
    const $noDriver = $("noDriverMsg");

    if ($loading) $loading.style.display = "none";

    const me = STATE.auth.driver;
    if (!me) {
      if ($noDriver) $noDriver.style.display = "";
      return;
    }

    if ($content) $content.style.display = "";

    const infoBar = $("eventInfoBar");
    if (infoBar) {
      const ev = (STATE.events || []).find(e => e.id === STATE.event.id);
      infoBar.textContent = ev
        ? `Evento: ${ev.name || ev.title || ev.id}`
        : "Evento activo";
    }

    if (!STATE.ui) STATE.ui = {};
    STATE.ui.activePhase = STATE.event?.phases?.[0]?.id || "ida";

    renderPhaseBar();
    renderRuta();

    $("btnRefreshRuta")?.addEventListener("click", async () => {
      if (STATE.event?.id) {
        await loadEventContext(STATE.event.id);
        renderPhaseBar();
        renderRuta();
        toast("Ruta actualizada");
      }
    });

    $("btnWhatsAppRuta")?.addEventListener("click", buildWhatsAppRuta);

    document.addEventListener("eventChanged", async (ev) => {
      const id = ev?.detail?.eventId;
      if (!id) return;
      await loadEventContext(id);
      renderPhaseBar();
      renderRuta();
    });

    // Notificaciones push (opcional — requiere VAPID key configurada)
    if (me && STATE.auth.user?.uid) {
      requestNotificationPermission(STATE.auth.user.uid).catch(console.warn);
      listenForegroundMessages((payload) => {
        showInAppNotification(payload, toast);
      });
    }

  } catch (e) {
    console.error("INIT mi-ruta ERROR:", e);
    const $loading = $("loadingMsg");
    if ($loading) $loading.textContent = "Error al cargar la ruta. Intentá recargar la página.";
    toast(e.message || "Error de inicialización");
  }
})();
