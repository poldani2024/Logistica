export function parseCSV(text){
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(lines.length < 2) return { headers:[], rows:[] };

  const headers = splitCSVLine(lines[0]).map(h=>h.trim());
  const rows = lines.slice(1).map(line=>{
    const cols = splitCSVLine(line);
    const obj = {};
    headers.forEach((h,i)=> obj[h] = (cols[i] ?? "").trim());
    return obj;
  });

  return { headers, rows };
}

// Soporta comillas básicas
function splitCSVLine(line){
  const out = [];
  let cur = "";
  let inQ = false;
  for(let i=0;i<line.length;i++){
    const ch = line[i];
    if(ch === '"' ) { inQ = !inQ; continue; }
    if(ch === ',' && !inQ){ out.push(cur); cur=""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
