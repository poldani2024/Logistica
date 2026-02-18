import { auth, db } from "./firebase.js"; 
// Si tu proyecto inicializa Firebase en otro archivo, cambiá el import acá.

import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

const $ = (id)=> document.getElementById(id);

function qs(name){
  return new URLSearchParams(location.search).get(name);
}

function setStatus(msg, kind=""){
  $("status").textContent = msg;
  $("status").className = kind;
}

function showDetail(text){
  $("detail").style.display = "block";
  $("detail").textContent = text;
}

function showActions(show){
  $("actions").style.display = show ? "flex" : "none";
}

async function doLogin(){
  // Login simple con Google (ajustá si usás email/pass u otro provider)
  const prov = new GoogleAuthProvider();
  await signInWithPopup(auth, prov);
}

async function acceptInvite(user){
  const email = (qs("email") || "").toLowerCase().trim();
  const token = (qs("token") || "").trim();

  if (!email || !token) throw new Error("Link inválido: falta email o token.");

  const invRef = doc(db, "invites", email);
  const invSnap = await getDoc(invRef);

  if (!invSnap.exists()) throw new Error("Invitación no encontrada.");
  const inv = invSnap.data() || {};

  if (inv.active === false) throw new Error("Invitación inactiva o ya utilizada.");
  if ((inv.token || "") !== token) throw new Error("Token inválido.");
  if (inv.usedAt) throw new Error("Invitación ya utilizada.");

  // Crear/actualizar perfil del usuario logueado
  await setDoc(doc(db, "users", user.uid), {
    email: user.email || email,
    active: true,
    perms: inv.perms || {},
    inviteEmail: email,
    invitedAt: inv.createdAt || null,
    updatedAt: serverTimestamp()
  }, { merge: true });

  // Marcar invitación como usada
  await setDoc(invRef, {
    usedAt: serverTimestamp(),
    usedBy: user.uid,
    active: false
  }, { merge: true });

  return true;
}

$("btnLogin")?.addEventListener("click", async ()=>{
  try {
    setStatus("Iniciando sesión…");
    await doLogin();
  } catch (e) {
    setStatus("No se pudo iniciar sesión.", "err");
    showDetail(e?.message || String(e));
    showActions(true);
  }
});

onAuthStateChanged(auth, async (user) => {
  try{
    const email = (qs("email") || "").toLowerCase().trim();
    const token = (qs("token") || "").trim();

    if (!email || !token){
      setStatus("Link inválido (falta email o token).", "err");
      showActions(true);
      return;
    }

    if (!user){
      setStatus("Para aceptar la invitación, iniciá sesión.", "");
      showActions(true);
      return;
    }

    setStatus("Validando invitación…");
    await acceptInvite(user);

    setStatus("Invitación aceptada ✅", "ok");
    showDetail("Ya tenés permisos asignados. Te redirijo al inicio…");

    setTimeout(()=> location.href = "./index.html", 1200);

  } catch (e){
    setStatus("No se pudo aceptar la invitación.", "err");
    showDetail(e?.message || String(e));
    showActions(true);
  }
});
