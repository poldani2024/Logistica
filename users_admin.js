import { initCorePage, STATE, $, toast, escapeHtml, can } from "./core.js";
import { db } from "./firebase-init.js";

import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

const PERM_KEYS = [
  "Admin",
  "Eventos",
  "Solicitudes",
  "Admin.Solicitudes",
  "Choferes",
  "Pasajeros",
  "ChoferesXFase",
  "Asignaciones",
  "Tracking",
  "Mapa",
  "AceptInv"
];

// === Invitaciones por link manual (sin Cloud Functions) ===
function makeToken(len = 32){
  // token amigable (sin caracteres confusos)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const rnd = crypto.getRandomValues(new Uint8Array(len));
  let t = "";
  for (let i = 0; i < len; i++) t += chars[rnd[i] % chars.length];
  return t;
}

function inviteBaseUrl(){
  // URL base del directorio actual (GitHub Pages friendly)
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/[^\/]*$/, "/");
  return url.toString().replace(/\/$/, "");
}

function buildInviteLink(email, token){
  const base = inviteBaseUrl();
  return `${base}/accept_invite.html?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
}

async function copyToClipboard(text){
  try{
    await navigator.clipboard.writeText(text);
    toast("Link copiado ✅");
  }catch(e){
    console.error(e);
    toast("No pude copiar el link (probá copiarlo manualmente).");
  }
}



async function loadUsers(){
  const snap = await getDocs(query(collection(db, "users"), orderBy("email")));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

function renderUsersList(list){
  $("usersList").innerHTML = list.length ? `
    <table>
      <thead>
        <tr>
          <th>Nombre</th><th>Apellido</th><th>Teléfono</th><th>Email</th><th>Activo</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(u => `
          <tr class="rowHover" data-uid="${escapeHtml(u.uid)}">
            <td>${escapeHtml(u.firstName || "")}</td>
            <td>${escapeHtml(u.lastName || "")}</td>
            <td>${escapeHtml(u.phone || "")}</td>
            <td>${escapeHtml(u.email || "")}</td>
            <td>${u.active === false ? "No" : "Sí"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : `<p class="muted">No hay usuarios todavía.</p>`;

  document.querySelectorAll("[data-uid]").forEach(tr=>{
    tr.addEventListener("click", ()=>loadDetail(tr.dataset.uid));
  });
}

function permsObj(p){
  return (p && typeof p === "object") ? p : {};
}

async function loadDetail(uid){
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()){
    $("userDetail").innerHTML = `<p class="muted">No existe.</p>`;
    return;
  }

  const u = { uid: snap.id, ...snap.data() };
  const perms = permsObj(u.perms);

  $("userDetail").innerHTML = `
    <div class="grid2">
      <div class="field">
        <label>Nombre</label>
        <input id="u_firstName" class="input" value="${escapeHtml(u.firstName||"")}">
      </div>
      <div class="field">
        <label>Apellido</label>
        <input id="u_lastName" class="input" value="${escapeHtml(u.lastName||"")}">
      </div>
      <div class="field">
        <label>Teléfono</label>
        <input id="u_phone" class="input" value="${escapeHtml(u.phone||"")}">
      </div>
      <div class="field">
        <label>Email</label>
        <input class="input" value="${escapeHtml(u.email||"")}" disabled>
      </div>
    </div>

    <hr />

    <div class="row" style="gap:10px; align-items:center; margin:10px 0;">
      <label class="row" style="gap:10px; align-items:center;">
        <input id="u_active" type="checkbox" ${u.active === false ? "" : "checked"}>
        <span>Usuario activo</span>
      </label>
    </div>

    <h3>Permisos</h3>
    <div class="grid2" class="permsGrid">
      ${PERM_KEYS.map(k => `
        <label class="row" style="gap:10px; align-items:center;">
          <input type="checkbox" data-perm="${escapeHtml(k)}" ${perms[k] ? "checked" : ""}>
          <span>${escapeHtml(k)}</span>
        </label>
      `).join("")}
    </div>

    <div class="field" style="margin-top:10px;">
      <label>Link de invitación</label>
      <div class="row" style="gap:10px; align-items:center;">
        <input id="inv_link" class="input" value="${escapeHtml(d.token ? buildInviteLink((d.email || d.id || '').toLowerCase(), d.token) : '')}" readonly placeholder="Se genera al crear la invitación">
        <button id="btnCopyInviteLink" class="btnSecondary" ${d.token ? "" : "disabled"}>Copiar</button>
      </div>
      <p class="muted" style="margin-top:6px;">Copiá este link y mandalo por WhatsApp o email. (No se envía automáticamente)</p>
    </div>

    <div class="row" style="justify-content:flex-end; gap:10px; margin-top:12px;">
      <button id="btnSaveUser" class="btnPrimary">Guardar</button>
    </div>
  `;

  $("btnSaveUser").addEventListener("click", async ()=>{
    try{
      const newPerms = {};
      document.querySelectorAll("[data-perm]").forEach(ch=>{
        newPerms[ch.dataset.perm] = !!ch.checked;
      });

      await setDoc(doc(db, "users", uid), {
        firstName: $("u_firstName").value.trim(),
        lastName: $("u_lastName").value.trim(),
        phone: $("u_phone").value.trim(),
        active: !!document.getElementById("u_active")?.checked,
        perms: newPerms,
        updatedAt: serverTimestamp(),
        updatedBy: STATE.auth.user?.email || ""
      }, { merge:true });

      toast("Usuario actualizado");
      await refresh(); // refresca lista por si cambió nombre/teléfono
    }catch(e){
      console.error(e);
      toast(e.message || String(e));
    }
  });
}


async function loadInvites(){
  const snap = await getDocs(query(collection(db, "invites"), orderBy("email")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function renderInvitesList(list){
  $("invitesList").innerHTML = list.length ? `
    <table>
      <thead>
        <tr>
          <th>Email</th><th>Nombre</th><th>Apellido</th><th>Teléfono</th><th>Activo</th><th>Usada</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(i => `
          <tr class="rowHover" data-inv="${escapeHtml(i.id)}">
            <td><strong>${escapeHtml(i.email || i.id || "")}</strong></td>
            <td>${escapeHtml(i.firstName || "")}</td>
            <td>${escapeHtml(i.lastName || "")}</td>
            <td>${escapeHtml(i.phone || "")}</td>
            <td>${i.active === false ? "No" : "Sí"}</td>
            <td>${i.usedAt ? "Sí" : "No"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : `<p class="muted">No hay invitaciones.</p>`;

  document.querySelectorAll("[data-inv]").forEach(tr=>{
    tr.addEventListener("click", ()=>loadInviteDetail(tr.dataset.inv));
  });
}

function permsFromForm(){
  const newPerms = {};
  document.querySelectorAll('input[type="checkbox"][data-inv-perm]').forEach(ch=>{
    const key = (ch.dataset.invPerm || "").trim();
    if (!key) return;
    newPerms[key] = !!ch.checked;
  });
  return newPerms;
}

function renderInviteForm(inv = null){
  const d = inv || { email:"", firstName:"", lastName:"", phone:"", active:true, perms:{} };
  const perms = (d.perms && typeof d.perms === "object") ? d.perms : {};

  $("inviteDetail").innerHTML = `
    <div class="grid2">
      <div class="field">
        <label>Email</label>
        <input id="inv_email" class="input" value="${escapeHtml((d.email || d.id || "").toLowerCase())}" ${inv ? "disabled" : ""}>
      
        <input id="inv_token" type="hidden" value="${escapeHtml(d.token || "")}">
</div>
      <div class="field">
        <label>Teléfono</label>
        <input id="inv_phone" class="input" value="${escapeHtml(d.phone || "")}">
      </div>
      <div class="field">
        <label>Nombre</label>
        <input id="inv_firstName" class="input" value="${escapeHtml(d.firstName || "")}">
      </div>
      <div class="field">
        <label>Apellido</label>
        <input id="inv_lastName" class="input" value="${escapeHtml(d.lastName || "")}">
      </div>
    </div>

    <div class="row" style="gap:10px; align-items:center; margin:10px 0;">
      <label class="row" style="gap:10px; align-items:center;">
        <input id="inv_active" type="checkbox" ${d.active === false ? "" : "checked"}>
        <span>Usuario activo</span>
      </label>
      <span class="muted">${d.usedAt ? "Invitación usada" : "Invitación pendiente"}</span>
    </div>

    <hr />

    <h3>Permisos</h3>
    <div class="grid2">
      ${PERM_KEYS.map(k => `
        <label class="row" style="gap:10px; align-items:center;">
          <input type="checkbox" data-inv-perm="${escapeHtml(k)}" ${perms[k] ? "checked" : ""}>
          <span>${escapeHtml(k)}</span>
        </label>
      `).join("")}
    </div>

    <div class="row" style="justify-content:flex-end; gap:10px; margin-top:12px;">
      <button id="btnNewInvite" class="btnSecondary">Nueva</button>
      <button id="btnSaveInvite" class="btnPrimary">${inv ? "Guardar cambios" : "Crear invitación"}</button>
    </div>
  `;

  $("btnNewInvite").addEventListener("click", ()=>{
    _currentInviteId = null;
    renderInviteForm(null);
  });

  $("btnSaveInvite").addEventListener("click", saveInvite);
}

let _currentInviteId = null;
let _currentInviteObj = null;

async function loadInviteDetail(invId){
  const snap = await getDoc(doc(db, "invites", invId));
  if (!snap.exists()){
    toast("No existe la invitación");
    return;
  }
  const inv = { id: snap.id, ...snap.data() };
  _currentInviteId = inv.id;
  _currentInviteObj = inv;
  renderInviteForm(inv);
}

async function saveInvite(){
  try{
    const emailInput = $("inv_email");
    const email = (emailInput?.value || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return toast("Ingresá un email válido.");

    const ref = doc(db, "invites", _currentInviteId || email);

    // Token: se genera solo al crear (para link manual)
    let token = ($("inv_token")?.value || "").trim();
    if (!_currentInviteId) token = makeToken(32);

    const payload = {
      email,
      firstName: $("inv_firstName").value.trim(),
      lastName: $("inv_lastName").value.trim(),
      phone: $("inv_phone").value.trim(),
      active: !!$("inv_active").checked,
      perms: permsFromForm(),
      token: token || null,
      updatedAt: serverTimestamp(),
      updatedBy: STATE.auth.user?.email || ""
    };

    // Si es creación, setear createdAt/createdBy
    if (!_currentInviteId){
      payload.createdAt = serverTimestamp();
      payload.createdBy = STATE.auth.user?.email || "";
    }

    await setDoc(ref, payload, { merge:true });

    _currentInviteId = email;
    _currentInviteObj = { ...(_currentInviteObj || {}), ...payload, id: email };
    toast("Invitación guardada");

    // Mostrar link en pantalla (y dejarlo listo para copiar)
    const link = token ? buildInviteLink(email, token) : "";
    if ($("inv_link")) {
      $("inv_link").value = link;
      const b = $("btnCopyInviteLink");
      if (b) b.disabled = !link;
    }

    await refresh(); // refresca listas
    await loadInviteDetail(email);
  }catch(e){
    console.error(e);
    toast(e.message || String(e));
  }
}

let _users = [];

async function refresh(){
  _users = await loadUsers();
  renderUsersList(_users);

  const invites = await loadInvites();
  renderInvitesList(invites);

  // Si no hay invitación seleccionada, mostrar formulario vacío
  if (!document.getElementById('inv_email')) {
    renderInviteForm(null);
  }
}

(async function init(){
  await initCorePage({ page:"users_admin" });

  // Solo admin total
  if (!STATE.auth?.isAdmin){
    document.body.innerHTML = "<p style='padding:20px'>Solo Admin.</p>";
    return;
  }

  $("btnRefresh").addEventListener("click", refresh);
  await refresh();
})();
