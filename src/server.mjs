// server.mjs — zero-dependency HTTP API + Server-Sent-Events for the machine plan.
// Node >= 22 (uses the built-in node:sqlite). Start: node src/server.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getMeta, setMeta, bumpRev, importFromJson } from './db.mjs';

const __dir     = dirname(fileURLToPath(import.meta.url));
const PORT      = parseInt(process.env.PORT || '3000');
const HOST      = process.env.HOST || '0.0.0.0';
const DB_PATH   = process.env.DB_PATH || join(__dir, '..', 'data', 'buchungen.db');
const IMPORT_JSON = process.env.IMPORT_JSON || join(dirname(DB_PATH), 'buchungen.json');
const BACKUP_DIR  = process.env.BACKUP_DIR || join(dirname(DB_PATH), 'backups');
const BACKUP_KEEP = parseInt(process.env.BACKUP_KEEP || '30');
const PUBLIC_DIR  = join(__dir, '..', 'public');

const BUNDLED_JSON = join(__dir, '..', 'buchungen.json');   // im Image mitgeliefert (Dockerfile kopiert es)
const db = openDb(DB_PATH);
// Erststart-Seed: DB leer? Dann aus dem Volume (/data/buchungen.json) importieren –
// und falls dort nichts liegt, aus der im Image gebündelten buchungen.json (kein docker cp nötig).
try{
  const seedPath = existsSync(IMPORT_JSON) ? IMPORT_JSON
                 : existsSync(BUNDLED_JSON) ? BUNDLED_JSON : IMPORT_JSON;
  const r = importFromJson(db, seedPath);
  if(r && !r.skipped) log('Import', `Erstimport (${seedPath}): ${r.machines} Maschinen, ${r.bookings} Buchungen`);
}catch(e){ if(existsSync(IMPORT_JSON) || existsSync(BUNDLED_JSON)) console.error('Import fehlgeschlagen:', e.message); }

// ---------- helpers ----------
const ymd = d => d.toISOString().slice(0,10);
function isBlocked(m, day){
  return !!(m.status && m.status!=='ok'
    && (!m.statusFrom  || day>=m.statusFrom)
    && (!m.statusUntil || day<=m.statusUntil));
}

// ---------- SSE clients ----------
const clients = new Set();
const clientNames = new Map();            // res -> user name (for presence)
function presenceUsers(){ return [...new Set([...clientNames.values()].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de')); }
function broadcast(event, data){
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for(const res of clients){ try{ res.write(line); }catch{} }
}
function sendPresence(){ broadcast('presence', { n:clients.size, users:presenceUsers() }); }
function log(user, action){
  try{ db.prepare('INSERT INTO log(ts,user,action) VALUES(?,?,?)').run(new Date().toISOString(), user||'?', action); }catch{}
}

// ---------- read model ----------
function machineOut(r){
  const o = { id:r.id, name:r.name, group:r.grp, status:r.status||'ok', statusNote:r.statusNote||'', info:r.info||'' };
  if(r.cat) o.cat = r.cat;
  if(r.statusFrom)  o.statusFrom  = r.statusFrom;
  if(r.statusUntil) o.statusUntil = r.statusUntil;
  if(r.redu) o.redu = r.redu;   // Redundanz-Markierung (nur Label)
  if(r.days) o.days = r.days;   // verfügbare Wochentage (Maske Mo..So)
  if(r.maint){ try{ const a=JSON.parse(r.maint); if(Array.isArray(a)&&a.length) o.maint=a; }catch{} } // Wartungs-/Ausfall-Slots
  return o;
}
function bookingOut(r){
  const o = { name:r.name, ts:r.ts };
  if(r.note)   o.note   = r.note;
  if(r.gid)    o.gid    = r.gid;
  if(r.gtitle) o.gtitle = r.gtitle;
  return o;
}
function getState(){
  const machines = db.prepare('SELECT * FROM machines ORDER BY sort, name').all().map(machineOut);
  const bookings = {};
  for(const r of db.prepare('SELECT * FROM bookings').all()){
    (bookings[r.mid] ||= {})[r.day] = bookingOut(r);
  }
  return { rev: parseInt(getMeta(db,'revision'))||0, groups: JSON.parse(getMeta(db,'groups')||'[]'), machines, bookings };
}

// ---------- writes ----------
// EINZIGER Schreibweg. Der Client liefert entweder ein Zell-Delta (prev+val je
// Zelle → Compare-and-Set, fremde Buchungen werden nie überschrieben) ODER bei
// Verwaltungsänderungen die komplette Maschinen-/Gruppenliste. Alle Eingaben
// werden hier serverseitig validiert – der Client wird NICHT als vertrauens-
// würdig angenommen (kein Login davor).
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const clip = (v,n)=> v==null ? null : (String(v).slice(0,n) || null);

function applyMutate({ cells, machines, groups, log:logText, user }){
  const who = String(user||'?').slice(0,80);
  const note = logText ? String(logText).slice(0,200) : null;

  // ---- strukturelle Änderung (Verwalten): komplette Maschinen-/Gruppenliste ----
  if(Array.isArray(machines)){
    if(machines.length===0 || machines.length>5000) return { error:'Ungültige Maschinenliste' };
    const seen = new Set();
    for(const m of machines){
      if(!m || typeof m.id!=='string' || !m.id.trim() || typeof m.name!=='string' || !m.name.trim())
        return { error:'Maschine ohne gültige id/name' };
      if(seen.has(m.id)) return { error:'Doppelte Maschinen-id: '+m.id };
      seen.add(m.id);
    }
    db.exec('BEGIN');
    try{
      db.exec('DELETE FROM machines');
      const cleanMaint = m => {                       // Wartungs-Slots validieren → JSON oder null
        if(!Array.isArray(m.maint)) return null;
        const a = m.maint.slice(0,50).map(s=>({
          type: s && s.type==='defekt' ? 'defekt' : 'wartung',
          from: DAY_RE.test(s&&s.from||'') ? s.from : '',
          until: DAY_RE.test(s&&s.until||'') ? s.until : '',
          ...(s && s.note ? { note: String(s.note).slice(0,200) } : {})
        }));
        return a.length ? JSON.stringify(a) : null;
      };
      const im = db.prepare(`INSERT INTO machines(id,name,grp,cat,status,statusNote,statusFrom,statusUntil,info,redu,days,maint,sort)
                             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      machines.forEach((m,i)=> im.run(
        clip(m.id,80), clip(m.name,200), clip(m.group,120), m.cat==='messtechnik'?'messtechnik':null,
        (m.status==='wartung'||m.status==='defekt')?m.status:'ok', clip(m.statusNote,200),
        DAY_RE.test(m.statusFrom||'')?m.statusFrom:null, DAY_RE.test(m.statusUntil||'')?m.statusUntil:null,
        clip(m.info,300), clip(m.redu,120), (/^[01]{7}$/.test(m.days||'')?m.days:null), cleanMaint(m), i));
      if(Array.isArray(groups)) setMeta(db,'groups', JSON.stringify(groups.map(g=>String(g).slice(0,120)).slice(0,500)));
      db.exec('DELETE FROM bookings WHERE mid NOT IN (SELECT id FROM machines)');   // Waisen (gelöschte Maschine)
      if(note) log(who, note);
      db.exec('COMMIT');
    }catch(e){ try{ db.exec('ROLLBACK'); }catch{} console.error('mutate/structural:', e.message); return { error:'Speichern fehlgeschlagen' }; }
    const rev = bumpRev(db);
    broadcast('structural', { rev, by:who, log:note });
    return { ok:true, rev, structural:true };
  }

  // ---- Zell-Delta (Buchen/Löschen) ----
  if(Array.isArray(cells)){
    if(cells.length>1000) return { error:'Zu viele Zellen (max. 1000)' };
    const machineById = new Map(db.prepare('SELECT * FROM machines').all().map(m=>[m.id,m]));
    // Vorab-Validierung (vor der Transaktion), damit kein Teil-Commit entsteht
    for(const c of cells){
      if(!c || typeof c.mid!=='string' || !DAY_RE.test(c.day||'')) return { error:'Ungültige Zelle' };
      if(!machineById.has(c.mid)) return { error:'Unbekannte Maschine: '+c.mid };
      if(c.val && !String(c.val.name||'').trim()) return { error:'Name fehlt' };
    }
    const changes = [], conflicts = [];
    db.exec('BEGIN');
    try{
      const cur = db.prepare('SELECT * FROM bookings WHERE mid=? AND day=?');
      const up  = db.prepare(`INSERT INTO bookings(mid,day,name,note,ts,gid,gtitle) VALUES(?,?,?,?,?,?,?)
                              ON CONFLICT(mid,day) DO UPDATE SET name=excluded.name,note=excluded.note,ts=excluded.ts,gid=excluded.gid,gtitle=excluded.gtitle`);
      const dl  = db.prepare('DELETE FROM bookings WHERE mid=? AND day=?');
      for(const c of cells){
        const m = machineById.get(c.mid);
        const now = cur.get(c.mid, c.day);
        if(c.val){                                       // setzen/buchen
          const name = String(c.val.name).trim();
          if(isBlocked(m, c.day)){ conflicts.push({ mid:c.mid, day:c.day, by:`gesperrt (${m.status})` }); continue; } // eigene Sperr-Regel durchsetzen
          if(now && now.name !== name){ conflicts.push({ mid:c.mid, day:c.day, by:now.name }); continue; }            // fremd belegt
          const val = { name, note:clip(c.val.note,500), ts:clip(c.val.ts,40)||new Date().toISOString(),
                        gid:clip(c.val.gid,40), gtitle:clip(c.val.gtitle,200) };
          up.run(c.mid, c.day, val.name, val.note, val.ts, val.gid, val.gtitle);
          changes.push({ mid:c.mid, day:c.day, val: bookingOut(val) });
        } else {                                         // löschen
          if(now && c.prev && now.name !== c.prev.name){ conflicts.push({ mid:c.mid, day:c.day, by:now.name }); continue; } // inzwischen fremd
          if(now){ dl.run(c.mid, c.day); changes.push({ mid:c.mid, day:c.day, val:null }); }
        }
      }
      if(note) log(who, note);
      db.exec('COMMIT');
    }catch(e){ try{ db.exec('ROLLBACK'); }catch{} console.error('mutate/cells:', e.message); return { error:'Speichern fehlgeschlagen' }; }
    const rev = bumpRev(db);
    if(changes.length) broadcast('update', { rev, changes, by:who, log:note });
    return { ok:true, rev, applied:changes.length, conflicts };
  }

  return { error:'Nichts zu tun' };
}

// ---------- daily backup (protects against corruption / mass-delete) ----------
function runBackup(){
  try{
    mkdirSync(BACKUP_DIR, { recursive:true });
    const name = `buchungen_${ymd(new Date())}.db`;
    const dest = join(BACKUP_DIR, name);
    if(!existsSync(dest)){
      db.exec(`VACUUM INTO '${dest.replace(/'/g,"''")}'`);   // clean consistent copy, safe while running
      const olds = readdirSync(BACKUP_DIR).filter(n=>/^buchungen_\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort();
      for(const n of olds.slice(0, -BACKUP_KEEP)){ try{ rmSync(join(BACKUP_DIR,n)); }catch{} }
      console.log('Backup:', dest);
    }
  }catch(e){ console.error('Backup fehlgeschlagen:', e.message); }
}
runBackup();
setInterval(runBackup, 6*60*60*1000);   // check every 6h; one file per day

// ---------- HTTP ----------
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' };
function send(res, code, body, headers={}){ res.writeHead(code, { 'Content-Type':'application/json', ...headers }); res.end(typeof body==='string'?body:JSON.stringify(body)); }
function readBody(req){ return new Promise((resolve)=>{
  let b='';
  req.on('data', c=>{ b+=c; if(b.length>1e6){ req.destroy(); resolve(null); } });   // Überlauf: sofort abschließen (kein hängender Handler)
  req.on('end', ()=>{ try{ resolve(b?JSON.parse(b):{}); }catch{ resolve(null); } });
  req.on('error', ()=>resolve(null));
}); }

const server = createServer(async (req,res)=>{
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try{
    if(p === '/api/health')  return send(res,200,{ ok:true, rev:parseInt(getMeta(db,'revision'))||0, clients:clients.size });
    if(p === '/api/state')   return send(res,200, getState());

    if(p === '/api/stream'){
      res.writeHead(200,{ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive', 'X-Accel-Buffering':'no' });
      res.write('retry: 3000\n\n');
      res.write(`event: hello\ndata: ${JSON.stringify({ rev:parseInt(getMeta(db,'revision'))||0 })}\n\n`);
      clients.add(res);
      clientNames.set(res, (url.searchParams.get('user')||'').trim());
      sendPresence();
      const hb = setInterval(()=>{ try{ res.write(': ping\n\n'); }catch{} }, 25000);
      req.on('close', ()=>{ clearInterval(hb); clients.delete(res); clientNames.delete(res); sendPresence(); });
      return;
    }

    if(req.method === 'POST' && p === '/api/mutate'){
      const body = await readBody(req);
      if(body === null) return send(res,400,{ error:'Ungültige oder zu große Anfrage' });
      const out = applyMutate(body);
      return send(res, out.error ? 400 : 200, out);
    }

    // static files (the app UI)
    let file = p === '/' ? '/index.html' : p;
    if(file.includes('..')) return send(res,400,{ error:'bad path' });
    const abs = join(PUBLIC_DIR, file);
    try{
      const data = await readFile(abs);
      return res.writeHead(200,{ 'Content-Type': MIME[extname(abs)] || 'application/octet-stream' }).end(data);
    }catch{ return send(res,404,{ error:'not found' }); }
  }catch(e){ console.error(e); return send(res,500,{ error:'Serverfehler' }); }
});

server.listen(PORT, HOST, ()=> console.log(`Maschinenplan-Server läuft auf http://${HOST}:${PORT}  (DB: ${DB_PATH})`));

// graceful shutdown so the DB closes cleanly
function shutdown(){ console.log('Shutdown …'); server.close(()=>{ try{ db.close(); }catch{} process.exit(0); }); setTimeout(()=>process.exit(0), 3000); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
