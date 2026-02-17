import { initCorePage, STATE, can } from "./core.js";

function applyPermissions(){
  // Mostrar/ocultar elementos marcados con data-perm="Eventos", etc.
  document.querySelectorAll("[data-perm]").forEach(el => {
    const key = el.dataset.perm;
    el.style.display = can(key) ? "" : "none";
  });

  // Si el usuario está inactivo (no admin), ocultar contenido principal
  if (STATE.auth?.isActive === false && !STATE.auth?.isAdmin){
    document.querySelectorAll("main, .container, .nav, .modules, .grid, .cards").forEach(el=>{
      if (el) el.style.display = "none";
    });
    const msg = document.getElementById("homeStatus") || document.body;
    if (msg) {
      msg.innerHTML = "<div class='card'><b>Usuario inactivo</b><div class='muted'>Contactá a un administrador.</div></div>";
    }
  }
}

(async function(){
  await initCorePage({ page: "home" });
  if (!STATE.auth?.user) return;

  applyPermissions();

  const el = document.getElementById("homeStatus");
  if (el){
    const eventId = STATE.event?.id || "";
    const ev = (STATE.events || []).find(e => e.id === eventId);
    const title = ev?.name || (eventId ? eventId : "Sin evento");
    el.innerHTML = `
      <div class="row">
        <span class="pill">Evento activo: <b>${title}</b></span>
        <span class="pill">Choferes master: <b>${STATE.master.drivers.length}</b></span>
        <span class="pill">Pasajeros master: <b>${STATE.master.passengers.length}</b></span>
      </div>
      <div class="hr"></div>
      <div class="small muted">
        Consejo: si ves “No hay evento seleccionado”, elegí uno arriba.
      </div>
    `;
  }
})();
