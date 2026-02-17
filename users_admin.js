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
  "Mapa"
];

async function loadUsers(){
  const snap = await getDocs(query(collection(db, "users"), orderBy("email")));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

function renderUsersList(list){
  $("usersList").innerHTML = list.length ? `
    <table>
      <thead>
        <tr>
          <th>Nombre</th><th>Apellido</th><th>Teléfono</th><th>Email</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(u => `
          <tr class="rowHover" data-uid="${escapeHtml(u.uid)}">
            <td>${escapeHtml(u.firstName || "")}</td>
            <td>${escapeHtml(u.lastName || "")}</td>
            <td>${escapeHtml(u.phone || "")}</td>
            <td>${escapeHtml(u.email || "")}</td>
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

    <h3>Permisos</h3>
    <div class="grid2">
      ${PERM_KEYS.map(k => `
        <label class="row" style="gap:10px; align-items:center;">
          <input type="checkbox" data-perm="${escapeHtml(k)}" ${perms[k] ? "checked" : ""}>
          <span>${escapeHtml(k)}</span>
        </label>
      `).join("")}
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

let _users = [];

async function refresh(){
  _users = await loadUsers();
  renderUsersList(_users);
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
