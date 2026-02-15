
import { db } from "./firebase-init.js";
import { startAuth, ensureHeader, loadMasterData, STATE } from "./core.js";
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

function render(){
  const host = document.getElementById("driversTable");
  const drivers = STATE.master.drivers;

  let html = `<table class="table"><thead><tr>
    <th>Nombre</th><th>Teléfono</th><th>Acciones</th>
  </tr></thead><tbody>`;

  for(const d of drivers){
    html += `<tr>
      <td><input data-id="${d.id}" data-field="name" value="${(d.name||"").replaceAll('"','&quot;')}" style="width:100%"></td>
      <td><input data-id="${d.id}" data-field="phone" value="${(d.phone||"").replaceAll('"','&quot;')}" style="width:100%"></td>
      <td class="row" style="gap:8px;">
        <button data-save="${d.id}" class="btn-primary">Guardar</button>
        <button data-del="${d.id}" class="btn-danger">Borrar</button>
      </td>
    </tr>`;
  }
  html += `</tbody></table>`;
  host.innerHTML = html;

  host.querySelectorAll("button[data-save]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.dataset.save;
      const name = host.querySelector(`input[data-id="${id}"][data-field="name"]`).value.trim();
      const phone = host.querySelector(`input[data-id="${id}"][data-field="phone"]`).value.trim();
      await updateDoc(doc(db,"drivers",id), { name, phone, updatedAt: serverTimestamp() });
      await loadMasterData();
      render();
    };
  });

  host.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.dataset.del;
      if(!confirm("¿Borrar chofer?")) return;
      await deleteDoc(doc(db,"drivers",id));
      await loadMasterData();
      render();
    };
  });
}

(async function(){
  await startAuth();
  await ensureHeader();
  await loadMasterData();

  document.getElementById("btnAddDriver").onclick = async ()=>{
    const name = document.getElementById("driverName").value.trim();
    const phone = document.getElementById("driverPhone").value.trim();
    if(!name) return alert("Poné un nombre.");
    await addDoc(collection(db,"drivers"), { name, phone, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    document.getElementById("driverName").value="";
    document.getElementById("driverPhone").value="";
    await loadMasterData();
    render();
  };

  render();
})();
