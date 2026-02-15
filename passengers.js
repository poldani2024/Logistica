
import { db } from "./firebase-init.js";
import { startAuth, ensureHeader, loadMasterData, STATE } from "./core.js";
import { collection, addDoc, updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

const logEl = ()=> document.getElementById("geoLog");
function log(line){
  const t = new Date().toISOString();
  logEl().value += `[${t}] ${line}\n`;
  logEl().scrollTop = logEl().scrollHeight;
}

async function geocode(query){
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
  log(`REQUEST: ${query}`);
  log(`URL: ${url}`);
  try{
    const resp = await fetch(url, { headers: { "Accept": "application/json" } });
    log(`HTTP: ${resp.status}`);
    if(!resp.ok) return null;
    const data = await resp.json();
    if(!data?.length){
      log(`NO_RESULT`);
      return null;
    }
    const best = data[0];
    return { lat: parseFloat(best.lat), lon: parseFloat(best.lon), display: best.display_name };
  }catch(err){
    log(`ERROR: ${err.message}`);
    return null;
  }
}

function render(){
  const host = document.getElementById("passengersTable");
  const ps = STATE.master.passengers;

  let html = `<table class="table"><thead><tr>
    <th>Nombre</th><th>Dirección</th><th>Lat</th><th>Lon</th><th>Acciones</th>
  </tr></thead><tbody>`;

  for(const p of ps){
    html += `<tr>
      <td><input data-id="${p.id}" data-field="name" value="${(p.name||"").replaceAll('"','&quot;')}" style="width:100%"></td>
      <td><input data-id="${p.id}" data-field="address" value="${(p.address||"").replaceAll('"','&quot;')}" style="width:100%"></td>
      <td><input data-id="${p.id}" data-field="lat" value="${p.lat ?? ""}" style="width:90px"></td>
      <td><input data-id="${p.id}" data-field="lon" value="${p.lon ?? ""}" style="width:90px"></td>
      <td><button data-save="${p.id}" class="btn-primary">Guardar</button></td>
    </tr>`;
  }
  html += `</tbody></table>`;
  host.innerHTML = html;

  host.querySelectorAll("button[data-save]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.dataset.save;
      const name = host.querySelector(`input[data-id="${id}"][data-field="name"]`).value.trim();
      const address = host.querySelector(`input[data-id="${id}"][data-field="address"]`).value.trim();
      const lat = parseFloat(host.querySelector(`input[data-id="${id}"][data-field="lat"]`).value);
      const lon = parseFloat(host.querySelector(`input[data-id="${id}"][data-field="lon"]`).value);
      await updateDoc(doc(db,"passengers",id), {
        name, address,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
        updatedAt: serverTimestamp()
      });
      await loadMasterData();
      render();
    };
  });
}

(async function(){
  await startAuth();
  await ensureHeader();
  await loadMasterData();

  document.getElementById("btnGeo").onclick = async ()=>{
    const addr = document.getElementById("pAddress").value.trim();
    if(!addr) return alert("Poné una dirección.");
    // retry: si contiene provincia, probá sin el último segmento luego de coma
    let res = await geocode(addr);
    if(!res && addr.includes(",")){
      const parts = addr.split(",").map(x=>x.trim());
      if(parts.length >= 2){
        const retryQ = parts.slice(0, parts.length-1).join(", ");
        log(`RETRY (sin provincia/último): ${retryQ}`);
        res = await geocode(retryQ);
      }
    }
    if(res){
      log(`OK: ${res.display}`);
      document.getElementById("pAddress").value = addr;
      document.getElementById("pAddress").dataset.lat = res.lat;
      document.getElementById("pAddress").dataset.lon = res.lon;
      alert(`OK: ${res.lat}, ${res.lon}`);
    }else{
      alert("No se encontró resultado.");
    }
  };

  document.getElementById("btnAddP").onclick = async ()=>{
    const name = document.getElementById("pName").value.trim();
    const address = document.getElementById("pAddress").value.trim();
    const lat = parseFloat(document.getElementById("pAddress").dataset.lat || "");
    const lon = parseFloat(document.getElementById("pAddress").dataset.lon || "");
    if(!name) return alert("Poné un nombre.");
    await addDoc(collection(db,"passengers"), {
      name,
      address,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    document.getElementById("pName").value="";
    document.getElementById("pAddress").value="";
    document.getElementById("pAddress").dataset.lat="";
    document.getElementById("pAddress").dataset.lon="";
    await loadMasterData();
    render();
  };

  document.getElementById("btnCopyLog").onclick = async ()=>{
    await navigator.clipboard.writeText(logEl().value);
    alert("Copiado.");
  };
  document.getElementById("btnClearLog").onclick = ()=>{
    logEl().value="";
  };

  render();
})();
