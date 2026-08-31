'use strict';
/* =================================================================
   GLOBALER ZUSTAND
   S bündelt den gesamten Laufzeitzustand. Grundsatz:
   - teamweite Daten kommen vom Server (S.data spiegelt /api/state),
   - gerätebezogene Vorlieben in localStorage (beim Start gelesen).

   Der Store besitzt dieses Objekt jetzt (web/js/state.ts) und app.ts
   spiegelt es als window.S – gleiche Referenz, gleiche Felder (byte-
   identisch, ARCHITECTURE §14). Der bisherige `const S = {…}` samt
   localStorage-Hydration ist dorthin gewandert; Zugriffe `S.x` hier
   binden an das globale window.S. `store` ist ab Phase 3.1 die kanonische
   Abstraktion; window.S schrumpft nur noch (Migrationsregel §14). */

/* =================================================================
   DATUMS-HELFER
   Intern: Date-Objekte auf UTC-Mitternacht (keine Zeitzonen-Überraschungen,
   Deutschland liegt bei UTC+1/+2 → Kalendertag bleibt stabil).
   Extern: ISO-Strings 'JJJJ-MM-TT' – sie sortieren als Strings korrekt und
   sind direkt als Objekt-Schlüssel in bookings verwendbar.
   weekdayRange() liefert nur Werktage; isBlockedM() prüft die (optional
   zeitbegrenzte) Wartungs-/Defekt-Sperre für einen konkreten Tag.
   ================================================================= */
/* Date helpers (ymd, parseYmd, addDays, mondayOf, isWeekend, fmtShort, fmtLong,
   weekdayName, isoWeek, todayStr, weekdayRange, allDaysRange) were extracted to the
   gated module web/js/core/dates.ts and are provided here as window globals by app.ts
   (which runs before this script). Their behavior is unchanged. */

/* sweepWeekends → core/weekend.ts (window bridge). */
/* maintText, statusRangeText, daysMaskText → ui/machine-text.ts (window bridge). Präsentationstext
   für Wartungs-/Verfügbarkeitsstatus; statusRangeText injiziert „heute" per Default. */
// Verfügbare Wochentage: m.days = 7-Zeichen-Maske Mo..So ('1'=verfügbar). Fehlt das Feld → alle Tage verfügbar.
/* WD_SHORT → ui/machine-text.ts's WEEKDAY_SHORT_LABELS (window bridge). Phase 7 slice B6. */
/* catOf, maintSlots, slotCovers, maintAt, isBlockedM, anyMaint, dayAvailable,
   cellBookable → core/machines.ts (provided as window globals by app.ts). */
function stampRef(){
  const el=document.getElementById('lastRef');
  if(el) el.textContent=new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
/* validateData → net/api.ts (window bridge). Struktur-/Integritätsprüfung eines
   State-Payloads; unverändert (faithful port). */

let saving=false; // blockiert den stillen Auto-Refresh, solange ein Schreibvorgang läuft
/* OPTIMISTISCHES SPEICHERN (v5.5):
   1) fn wird SOFORT auf den Anzeige-Stand S.data angewendet → Zellen ändern
      sich im Moment des Klicks (keine Datei-I/O im kritischen Pfad).
   2) Danach persistiert persist() im Hintergrund autoritativ: frisch lesen,
      unser Delta gegen fremde Änderungen mergen (fremde Buchung gewinnt nie
      überschrieben zu werden), schreiben. Bei Fehler/Kollision wird der
      tatsächliche Dateistand übernommen und die Ansicht angeglichen. */
async function mutate(fn, logAction){
  if(S.readOnly){ toast('Nur-Lese-Modus – Buchen nicht möglich.'); return null; }
  const result = fn(S.data);              // optimistisch auf Anzeige-Stand anwenden
  if(result && result.abort) return result; // Konflikt/Abbruch: S.data unverändert
  const logEntry={ts:new Date().toISOString(), user:S.user||'?', action:logAction};
  S.data.log = S.data.log || [];
  S.data.log.unshift(logEntry);
  if(S.data.log.length>500) S.data.log.length=500;
  // SOFORT zeichnen (nur betroffene Zellen, sonst voll)
  if(result && result.undo && result.undo.length && result.undo.length<=500) patchCells(result.undo);
  else notify();
  saving=true;                            // ab jetzt keinen stillen Refresh dazwischenfunken lassen
  persist(fn, logEntry, result);          // Datei-Arbeit im Hintergrund
  return result;
}


async function start(){
  try{ S.data = await readFile(); }
  catch(e){ toast('Datei konnte nicht gelesen werden: '+e.message); return; }
  startUI();
}
function startUI(){
  document.getElementById('startScreen').style.display='none';
  document.getElementById('toolbar').style.display='';  // CSS-Layout (Grid) übernehmen
  document.getElementById('gridWrap').style.display='block';
  fillGroupSel();
  updateMachBtn(); // persistierten Filter in der Leiste anzeigen
  if(!S.user && !S.readOnly) askUserName(true);
  updateUserChip();
  notify();
  prependWeek(); // eine Woche Vergangenheit als Scroll-Puffer nach links
  centerToday();
  stampRef();
  applyDebug();
  dbg('info','App gestartet — '+(S.data.machines?S.data.machines.length:0)+' Maschinen geladen'+(S.readOnly?' (Nur-Lese-Modus)':''));
  // Auto-refresh + Anwesenheit (einmalige Registrierung, auch bei späterem Freischalten)
  if(!S.readOnly){ startLiveTimers(); }
}
document.getElementById('btnRefresh').onclick = ()=>refreshNow(false);

/* presenceData, openActiveUsers → ui/live-connection.ts (presenceData/activeUserRows) +
   ui/components/ActiveUsersModal.tsx (openActiveUsers) (window bridge). Doppelklick auf den
   Namens-Chip. Phase 7 slice B10d. */

/* ================= User name ================= */
/* setPresence, updateUserChip → ui/user-chip.ts (window bridge). Phase 7 slice B8. */
/* askUserName() → ui/components/AskUserNameModal.tsx (window bridge). Phase 7 slice B9. */
/* Einfachklick = Namen ändern (kurz verzögert, damit ein Doppelklick nicht
   erst das Namensfenster öffnet); Doppelklick = aktive Nutzer anzeigen. */
let userClickTimer=null;
document.getElementById('userChip').onclick = ()=>{
  clearTimeout(userClickTimer);
  userClickTimer=setTimeout(()=>askUserName(false), 240);
};
document.getElementById('userChip').ondblclick = ()=>{
  clearTimeout(userClickTimer);
  openActiveUsers();
};
document.getElementById('userChip').title = 'Klick: Namen ändern · Doppelklick: aktive Nutzer';

/* ================= Toolbar events ================= */
/* resetView, centerCol/centerToday, the Heute/◀/▶ buttons, jumpToMonth + its jumpMonth/
   jumpYear bindings, syncJumpControls, updateJumpFromScroll/scheduleJumpSync, gotoDate →
   ui/grid-scroll.ts (window bridge). Phase 7 slice B3. */
document.getElementById('btnAssist').onclick = openAssistant;
document.getElementById('btnMine').onclick   = openMyBookings;
document.getElementById('btnAll').onclick    = openAllBookings;
document.getElementById('btnSettings').onclick = openSettings;

/* ================= Debug-Modus (Admin) ================= */
function dbgOn(){ return localStorage.getItem('mb_debug')==='on'; }
// Zentrale Fehlerbehandlung (#9): unterscheidet Abbruch, loggt einheitlich statt stiller catch{}.
function handleError(ctx, err){ if(err && err.name==='AbortError') return; console.error('['+ctx+']', err); try{ dbg('err', ctx+': '+((err&&err.message)||err)); }catch(_){} }
// Schneller Maschinen-Lookup (#5): O(1)-Map, wird automatisch neu gebaut, wenn sich das machines-Array ersetzt.
function machById(id){ if(!S._mbi || S._mbiRef!==(S.data&&S.data.machines)){ S._mbiRef=S.data&&S.data.machines; S._mbi=new Map((S._mbiRef||[]).map(m=>[m.id,m])); } return S._mbi.get(id); }
function dbg(kind, msg){
  if(!dbgOn()) return;
  const list=document.getElementById('dbgList'); if(!list) return;
  const row=document.createElement('div');
  row.className='dbgrow'+(kind==='err'?' err':kind==='write'?' write':kind==='remote'?' remote':kind==='latency'?' latency':'');
  row.innerHTML=`<span class="t">${new Date().toLocaleTimeString('de-DE')}</span>[${esc(kind)}] ${esc(msg)}`;
  list.prepend(row);
  while(list.children.length>200) list.lastChild.remove();
}
function applyDebug(){
  document.getElementById('dbgPanel').classList.toggle('open', dbgOn());
  if(dbgOn()) dbg('info','Debug-Modus aktiv — Nutzer: '+(S.user||'?'));
}
document.getElementById('dbgClear').onclick=()=>{ document.getElementById('dbgList').innerHTML=''; };
document.getElementById('dbgClose').onclick=()=>{ localStorage.setItem('mb_debug','off'); applyDebug(); };

/* =================================================================
   GEMEINSAME UI-BAUSTEINE (v5.0)
   ic(name): Inline-SVG-Icon aus dem Sprite am Seitenanfang.
   askConfirm(): eigener Gefahr-Dialog (ersetzt native confirm()),
     Promise<boolean>, listet Betroffene/Zeitraum im Body.
   showCollision(): persistentes Banner bei gleichzeitigem Schreibzugriff.
   startLiveTimers(): registriert Fokus-Listener, Refresh- und Präsenz-
     Timer genau EINMAL (auch beim späteren Freischalten aus dem
     Nur-Lese-Modus keine Duplikate).
   saveFilters(): persistiert Maschinen-/Bereichs-/Personenfilter.
   ================================================================= */
function ic(name){ return '<svg class="ic" aria-hidden="true"><use href="#i-'+name+'"/></svg>'; }
/* askConfirm → ui/confirm.ts (window bridge). Phase 7 slice B10c. */
/* showCollision, the #collOk dismiss wiring → ui/collision-banner.ts (window bridge).
   liveTimersOn → net/live-connection.ts's own module state. Phase 7 slice B8. */
function saveFilters(){
  localStorage.setItem('mb_machsel', JSON.stringify([...S.machSel]));
  localStorage.setItem('mb_groupssel', JSON.stringify([...S.groupsSel]));
}
/* openHelp() → ui/components/HelpModal.tsx (window bridge). Phase 7 slice B9. */
document.getElementById('btnHelp').onclick=openHelp;

/* ================= Einstellungen (pro Gerät) ================= */
function applyTheme(){
  const pref=localStorage.getItem('mb_theme')||'auto';
  const dark = pref==='dark' || (pref==='auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{ applyTheme(); if(S.data) notify(); });
if(localStorage.getItem('mb_compact')==='on') document.body.classList.add('compact');


/* openSettings() → ui/components/SettingsModal.tsx (window bridge). Phase 7 slice B9. */

/* --- Ressourcenfilter „Filtern": Dropdown mit Suchfeld, Klappbaum und
   Checkboxen. Die Kategorie-Buttons (Maschinen/Messtechnik) filtern NUR die
   Liste im Dropdown (welche Kategorie-Abschnitte angezeigt werden) – sie
   verändern das RASTER NICHT. Die Häkchen isolieren einzelne Geräte im Raster
   (S.machSel). Klappbaum-Zustand (mfOpenCat/mfOpenGrp) und Listen-Kategorie-
   Filter (mfShow) leben pro Öffnen; beim Öffnen: Baum eingeklappt (nur
   „★ Favoriten" offen), beide Kategorien im Listenfilter aktiv. --- */
let mfOpenCat=null, mfOpenGrp=null, mfShow=null;
function fillMachSel(reset){
  const drop=document.getElementById('machDrop');
  if(reset || !mfOpenCat){ mfOpenCat=new Set(['fav']); mfOpenGrp=new Set(); mfShow=new Set(['maschine','messtechnik']); }
  const lbl=(m,cat,gk)=>`<label data-name="${esc((m.name+' '+m.group).toLowerCase())}" data-tcat="${cat}"${gk?` data-tgrp="${esc(gk)}"`:''}><input type="checkbox" class="mfCb" value="${esc(m.id)}" ${S.machSel.has(m.id)?'checked':''}> ${esc(m.name)}</label>`;
  const head=(k,label,fav)=>`<div class="grp cathead click" data-tcat="${k}"><span class="tarr">▸</span> ${fav?'★ ':''}${esc(label)}</div>`;
  let items='';
  // Favoriten ganz oben (eigene Top-Sektion, ohne Bereichs-Unterteilung)
  const favs=S.data.machines.filter(m=>S.favs.has(m.id));
  if(favs.length){ items+=head('fav','Favoriten',true); for(const m of favs) items+=lbl(m,'fav',''); }
  // Danach die beiden Kategorien mit ihren Bereichen
  const rest=S.data.machines.filter(m=>!S.favs.has(m.id)).sort((a,b)=>(catOf(a)==='messtechnik'?1:0)-(catOf(b)==='messtechnik'?1:0));
  let c=null, g=null;
  for(const m of rest){
    const mc=catOf(m);
    if(mc!==c){ c=mc; g=null; items+=head(mc, catLabel(mc), false); }
    const gk=mc+'::'+m.group;
    if(m.group!==g){ g=m.group; items+=`<div class="grp grpsub click" data-tgrp="${esc(gk)}" data-tcat="${mc}"><span class="tarr">▸</span> ${esc(m.group)}</div>`; }
    items+=lbl(m,mc,gk);
  }
  drop.innerHTML=`
    <div class="seg fill" style="margin-bottom:4px" id="mfCatSeg" role="group" aria-label="Kategorie in der Liste zeigen">
      ${CATS.map(([c,l])=>`<button data-c="${c}" class="${mfShow.has(c)?'on':''}" aria-pressed="${mfShow.has(c)}">${catIco(c)} ${l}</button>`).join('')}
    </div>
    <input type="text" id="machSearch" placeholder="Ressource suchen…" style="width:100%;margin-bottom:6px" autocomplete="off">
    <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center;justify-content:space-between">
      <span class="hint" style="margin:0" id="machCount"></span>
      <button class="btn small clearbtn" id="machClear">${ic('trash')} Filter löschen</button>
    </div>
    <div class="mlist" style="max-height:300px" id="machList">${items}</div>`;
  const cnt=()=>{ document.getElementById('machCount').textContent=S.machSel.size?S.machSel.size+' gewählt':'alle sichtbar'; };
  // Sichtbarkeit im Baum: Suchtext klappt alles auf (zeigt Treffer), sonst
  // richtet sie sich nach dem Klappzustand (mfOpenCat / mfOpenGrp).
  // „★ Favoriten" (tcat='fav') sind immer sichtbar; die Kategorie-Buttons (mfShow)
  // blenden nur die Maschinen-/Messtechnik-Abschnitte der Liste ein/aus.
  const inShow=tcat=> tcat==='fav' || mfShow.has(tcat);
  const applyView=()=>{
    const q=drop.querySelector('#machSearch').value.toLowerCase();
    const searching=!!q;
    drop.querySelectorAll('#machList label').forEach(l=>{
      let vis;
      if(searching) vis=l.dataset.name.includes(q) && inShow(l.dataset.tcat);
      else vis = inShow(l.dataset.tcat) && mfOpenCat.has(l.dataset.tcat) && (!l.dataset.tgrp || mfOpenGrp.has(l.dataset.tgrp));
      l.style.display=vis?'':'none';
    });
    drop.querySelectorAll('#machList .grpsub').forEach(h=>{
      h.style.display=(!searching && inShow(h.dataset.tcat) && mfOpenCat.has(h.dataset.tcat))?'':'none';
      const a=h.querySelector('.tarr'); if(a) a.textContent=mfOpenGrp.has(h.dataset.tgrp)?'▾':'▸';
    });
    drop.querySelectorAll('#machList .cathead').forEach(h=>{
      h.style.display=(!searching && inShow(h.dataset.tcat))?'':'none';
      const a=h.querySelector('.tarr'); if(a) a.textContent=mfOpenCat.has(h.dataset.tcat)?'▾':'▸';
    });
  };
  drop.querySelectorAll('#mfCatSeg button').forEach(b=>{
    b.onclick=()=>{ const c=b.dataset.c; mfShow.has(c)?mfShow.delete(c):mfShow.add(c);  // NUR die Liste, kein render()
      b.classList.toggle('on', mfShow.has(c)); b.setAttribute('aria-pressed', mfShow.has(c)); applyView(); };
  });
  drop.querySelectorAll('#machList .cathead').forEach(h=>{
    h.onclick=()=>{ const k=h.dataset.tcat; mfOpenCat.has(k)?mfOpenCat.delete(k):mfOpenCat.add(k); applyView(); };
  });
  drop.querySelectorAll('#machList .grpsub').forEach(h=>{
    h.onclick=()=>{ const k=h.dataset.tgrp; mfOpenGrp.has(k)?mfOpenGrp.delete(k):mfOpenGrp.add(k); applyView(); };
  });
  drop.querySelectorAll('.mfCb').forEach(cb=>{
    cb.onchange=()=>{ cb.checked?S.machSel.add(cb.value):S.machSel.delete(cb.value); saveFilters(); cnt(); updateMachBtn(); notify(); };
  });
  drop.querySelector('#machClear').onclick=()=>{ S.machSel.clear(); saveFilters(); fillMachSel(); notify(); };
  const se=drop.querySelector('#machSearch');
  se.oninput=applyView;
  se.focus();
  applyView(); cnt(); updateMachBtn();
}
function updateMachBtn(){
  const b=document.getElementById('machBtn');
  b.innerHTML = ic('search')+' '+(S.machSel.size ? `${S.machSel.size} gewählt ▾` : 'Filtern ▾');
  b.style.background = S.machSel.size ? 'var(--accent-light)' : '';
}
document.getElementById('machBtn').onclick = ev=>{
  ev.stopPropagation();
  const d=document.getElementById('machDrop');
  const wasOpen=d.classList.contains('open');
  d.classList.toggle('open');
  if(!wasOpen) fillMachSel(true);   // beim Öffnen: Baum eingeklappt (nur Favoriten offen)
};
document.getElementById('machDrop').onclick = ev=>ev.stopPropagation();
document.addEventListener('click', ()=>document.getElementById('machDrop').classList.remove('open'));
function searchActive(){ return S.machSel.size>0; }
function matchesSearch(m){ return S.machSel.size===0 || S.machSel.has(m.id); }

/* --- Group filter as checklist dropdown --- */
function groupList(){ return [...new Set(S.data.machines.map(m=>m.group))]; }
function fillGroupSel(){
  const drop=document.getElementById('groupDrop');
  drop.innerHTML =
    `<label><input type="checkbox" id="grpAll" ${S.groupsSel.size===0?'checked':''}> <b>Alle Bereiche</b></label><hr style="border:none;border-top:1px solid var(--border);margin:4px 0">` +
    groupList().map(g=>`<label><input type="checkbox" class="grpCb" value="${esc(g)}" ${S.groupsSel.has(g)?'checked':''}> ${esc(g)}</label>`).join('');
  drop.querySelector('#grpAll').onchange=()=>{ S.groupsSel.clear(); saveFilters(); fillGroupSel(); updateGroupBtn(); notify(); };
  drop.querySelectorAll('.grpCb').forEach(cb=>{
    cb.onchange=()=>{
      cb.checked ? S.groupsSel.add(cb.value) : S.groupsSel.delete(cb.value);
      if(S.groupsSel.size===groupList().length) S.groupsSel.clear(); // all selected = all
      saveFilters(); fillGroupSel(); updateGroupBtn(); notify();
    };
  });
  updateGroupBtn();
}
function updateGroupBtn(){
  const b=document.getElementById('groupBtn');
  b.textContent = S.groupsSel.size===0 ? 'Alle Bereiche ▾' : `${S.groupsSel.size} Bereich${S.groupsSel.size>1?'e':''} ▾`;
}
document.getElementById('groupBtn').onclick = ev=>{ ev.stopPropagation(); document.getElementById('groupDrop').classList.toggle('open'); };
document.getElementById('groupDrop').onclick = ev=>ev.stopPropagation();
document.addEventListener('click', ()=>document.getElementById('groupDrop').classList.remove('open'));



/* Buchungsliste einer Person (Serien zusammengefasst), mit Sprung ins Raster */




/* =================================================================
   ENDLOSES HORIZONTALES SCROLLEN → ui/grid-scroll.ts (window bridge). Phase 7 slice B3.
   ================================================================= */

/* --- Spaltenbreite der Maschinenspalte per Ziehen --- */
(function(){
  const saved=localStorage.getItem('mb_machw');
  if(saved) document.documentElement.style.setProperty('--machw', saved);
  let rs=null;
  document.addEventListener('mousedown', ev=>{
    if(ev.target.id!=='colResize') return;
    ev.preventDefault();
    const cur=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--machw'))||230;
    rs={x:ev.clientX, w:cur};
  });
  document.addEventListener('mousemove', ev=>{
    if(!rs) return;
    const w=Math.max(110, Math.min(560, rs.w + ev.clientX - rs.x));
    document.documentElement.style.setProperty('--machw', w+'px');
  });
  document.addEventListener('mouseup', ()=>{
    if(!rs) return;
    localStorage.setItem('mb_machw', getComputedStyle(document.documentElement).getPropertyValue('--machw').trim());
    rs=null;
  });
})();

/* =================================================================
   RENDERING
   render() baut das komplette Raster bei jeder Änderung als HTML-String neu
   (schnell genug für ~100 Maschinen × Dutzende Wochen). Nebenbei werden
   S.visM (gerenderte Maschinen-IDs, Zeilen) und S.visD (sichtbare ISO-Daten,
   Spalten) gefüllt – das Koordinatensystem der Auswahl. Sichtbare Wochen =
   S.weeks + S.extraWeeks; ensureOverflow() hält das Raster stets breiter als
   das Fenster, damit horizontal immer gescrollt werden kann.
   nameColor(): deterministische Personenfarbe aus dem Namens-Hash,
   themeabhängig hell (Text dunkel) bzw. dunkel (Text hell).
   ================================================================= */
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function nameColor(name){
  let h=0; for(const ch of name) h=(h*31+ch.charCodeAt(0))>>>0;
  return document.documentElement.dataset.theme==='dark'
    ? `hsl(${h%360} 35% 30%)`
    : `hsl(${h%360} 55% 88%)`;
}
function getBooking(mid,date){ const mb=S.data.bookings[mid]; return mb?mb[date]:undefined; }

/* --- Hauptkategorien: „Maschinen" (Hallen, Pool …) und „Messtechnik" ---
   Jede Ressource trägt optional m.cat='messtechnik'; fehlt das Feld, gilt sie
   als Maschine (alle Altbestände bleiben so ohne Migration gültig). Die
   Bereiche (m.group) sind Unterkategorien ihrer jeweiligen Hauptkategorie.
   S.cats steuert die Sichtbarkeit im Raster (Umschalt-Buttons im Spaltenkopf). */
const CATS=[['maschine','Maschinen'],['messtechnik','Messtechnik']];
/* catOf → core/machines.ts (window bridge). */
function catLabel(c){ return c==='messtechnik' ? 'Messtechnik' : 'Maschinen'; }
function catIco(c){ return ic(c==='messtechnik' ? 'gauge' : 'factory'); }  // einheitliches Icon je Kategorie
function groupCat(g){ const m=S.data.machines.find(x=>x.group===g); return catOf(m); }
function toggleCat(c){
  // Einfachklick: Kategorie im Raster ein-/ausklappen. Kein Zwang, eine aktiv
  // zu lassen – sind beide aus, zeigt das Raster nur noch die Favoriten.
  S.cats.has(c) ? S.cats.delete(c) : S.cats.add(c);
  localStorage.setItem('mb_cats', JSON.stringify([...S.cats]));
  notify();
}
/* Doppelklick auf Kategorie-Button/-Kopf: ALLE Unterkategorien (Bereiche) dieser
   Kategorie auf einmal auf- oder zuklappen (Toggle). Sind alle offen → alle zu,
   sonst → alle auf (und die Kategorie selbst aufgeklappt). */
function toggleAllGroupsInCat(c){
  if(!S.cats.has(c)){ S.cats.add(c); localStorage.setItem('mb_cats', JSON.stringify([...S.cats])); }
  const groups=[...new Set(S.data.machines.filter(m=>catOf(m)===c).map(m=>m.group))];
  const allOpen=groups.every(g=>!S.collapsed.has(g));
  groups.forEach(g=> allOpen ? S.collapsed.add(g) : S.collapsed.delete(g));
  localStorage.setItem('mb_collapsed', JSON.stringify([...S.collapsed]));
  notify();
}
/* Einfach-/Doppelklick trennen (sonst löst der Doppelklick erst den Einfach-
   Toggle aus): kurzer Timer, den der Doppelklick abbricht. */
let catTapTimer=null;
function catTap(c){ clearTimeout(catTapTimer); catTapTimer=setTimeout(()=>toggleCat(c), 220); }
function catTapCancel(){ clearTimeout(catTapTimer); }

/* --- Favoriten: immer oben, überall --- */
/* displayGroup, FAVGRP, orderedMachines() → dead code (see ui/grid.ts's displayGroup/
   orderedMachines, Phase 7 slice B1 — their only remaining callers). toggleFav →
   ui/favorite-jump.ts (window bridge). Phase 7 slice B10a. */

/* dpw, visibleDates → superseded by ui/grid.ts's visibleWeeks + ui/grid-scroll.ts's
   daysPerWeek (Phase 7 slice B1/B3); dead code once render() (their only caller) was deleted. */

/* render() → ui/components/Grid.tsx + ui/components/GridBody.tsx (window bridge). The React
   grid mounts once onto #grid in app.ts; its own `render()` export replaces this function and
   is called by the same store subscription that used to call this one. Phase 7 slice B1. */
/* ensureOverflow → ui/grid-scroll.ts (window bridge). Phase 7 slice B3. */

/* =================================================================
   ZELLEN-INTERAKTION (Excel-Verhalten)
   Modell: Sel.anchor und Sel.focus spannen ein Rechteck über S.visM×S.visD
   auf; computeSelCells() rechnet es aus, paintSel() färbt es nach jedem
   render() neu ein (der DOM wird ja komplett ersetzt).
   Eingaben:  Einzelklick = nur auswählen · Doppelklick = Buchen/Detail ·
   Ziehen oder Shift+Klick = Rechteck (Auto-Scroll am Rand via
   dragAutoScroll, Wochen hängen sich automatisch an) · Pfeiltasten bewegen,
   Shift+Pfeile erweitern, Enter öffnet, Esc hebt auf.
   Nach einem Zieh-Ende öffnet showCtx() das Buchen/Löschen-Menü.
   gotoNextFree()/gotoPrevFree(): ⏭/⏮-Sprünge je Maschine (Zeiger in
   nextFreePtr; Wechsel der Maschine setzt die übrigen Zeiger zurück).
   ================================================================= */
/* Sel, paintSel, clearSel → ui/grid-interaction.ts (window bridge). Phase 7 slice B2.
   cellEl, refreshCell, refreshDot, patchCells → ui/cell-patch.ts (window bridge).
   Phase 7 slice B4. */

/* nextFreePtr, gotoDateCenter, bookable, nextFreeAfter, prevFreeBefore, jumpToSlot,
   gotoNextFree, gotoPrevFree → ui/favorite-jump.ts (window bridge). Phase 7 slice B10a. */

/* openCellAction → ui/components/BookingDetailModal.tsx (window bridge). Phase 7 slice B4. */

/* gridEl, drag-select + auto-scroll, the grid's mousedown/mouseover/click/dblclick →
   ui/grid-interaction.ts (window bridge). Phase 7 slice B2. */

/* showCtx, hideCtx, and the outside-click dismissal → ui/components/ContextMenu.tsx (window
   bridge). Mounted once at boot onto #ctxMenu, same pattern as Grid.tsx onto #grid. Phase 7
   slice B10b. */

/* The grid's own keydown listener (arrow nav, Enter, Escape) → ui/grid-interaction.ts
   (window bridge). Phase 7 slice B2. (The separate Escape-closes-modal listener below is
   unrelated and stays here.) */

/* =================================================================
   MODAL / TOAST / UNDO
   The modal chrome itself is React-owned (ui/modal.tsx) as of Phase 7 slice B10d — see below.
   toast(msg, undoFn?, ms?): Hinweis unten; mit undoFn erscheint 9 s ein
   „Rückgängig"-Knopf, ms überschreibt die Anzeigedauer (Fehler: länger).
   offerUndo(msg, entries, label): entries=[{mid,date,prev}] beschreibt den
   VORHER-Zustand jeder Zelle; Rückgängig stellt ihn über mutate() wieder
   her (prev=null → Zelle wieder leeren).
   ================================================================= */
/* openModal, closeModal, modalSticky, lastFocusEl, expandModal + the #modalReopen click/
   overlay-click/Escape wiring → ui/modal.tsx (openReactModal/closeReactModal/
   collapseReactModal/expandReactModal — collapseModal was already dead, superseded by
   collapseReactModal in Phase 7 slice B7). openActiveUsers (below) was their only remaining
   caller. Phase 7 slice B10d. */
/* toast → ui/toast.ts (window bridge). Phase 7 slice B4. */
/* fmtDM, remoteMsg → net/sse.ts's formatDayMonth/remoteMessage (window bridge).
   queueRemote, runRemoteQ → net/live-connection.ts (window bridge). Phase 7 slice B8. */

/* offerUndo → ui/toast.ts (window bridge). openBookingForm, submitBooking, genGid →
   ui/components/BookingForm.tsx (window bridge). openBookingDetail →
   ui/components/BookingDetailModal.tsx (window bridge). Phase 7 slice B4. */

/* ================= Buchungsassistent =================
   machineChecklist, wireChecklistFilter, AS_TREE + asXxx tree adapters, asDevHTML/asGrpHTML,
   renderWork, wireWorkDnD, showAsTip, openAssistant, runAssistant → ui/components/
   AssistantModal.tsx + AssistantChecklist.tsx + AssistantTree.tsx + AssistantResults.tsx
   (window bridge). Tree edits + the N-of-M scheduling solver → core/assistant.ts (already
   ported, A4). Phase 7 slice B7. */


/* ================= Alle Buchungen: Tabelle mit Filtern ================= */
/* openAllBookings → ui/components/AllBookingsModal.tsx (window bridge). Phase 7 slice B5. */

/* ================= My bookings (mit Serien-Erkennung) =================
   Die Serien-Struktur wird beim Öffnen EINGEFROREN: Löscht man einzelne Tage,
   bleibt die Gruppierung stehen (keine Aufsplittung in Unter-Serien).
   Neu gruppiert wird erst beim nächsten Öffnen des Fensters. */
/* openMyBookings → ui/components/MyBookingsModal.tsx (window bridge). Phase 7 slice B5. */

/* ================= Statistik: Maschinen ⇄ Personen mit Drilldown ================= */
/* openStats → ui/components/StatsModal.tsx (window bridge). Phase 7 slice B5. */
document.getElementById('btnStats').onclick  = ()=>openStats();
document.getElementById('btnAdmin').onclick  = openAdmin;

/* ================= Admin: machines, status, log ================= */
/* openAdmin → ui/components/AdminModal.tsx (window bridge). Phase 7 slice B5. */
/* openMachineForm → ui/components/MachineFormModal.tsx (window bridge). Phase 7 slice B6. */
/* openLog() → ui/components/LogModal.tsx (window bridge). Phase 7 slice B9. */

/* =================================================================
   BACKEND-ADAPTER (Server-Variante)
   Ersetzt NUR die unterste Datenschicht: statt einer Datei über die File System
   Access API zu lesen/schreiben, spricht die App per fetch mit dem Server
   (/api/state, /api/mutate) und bekommt Änderungen live per SSE. Die gesamte
   Oberfläche und Logik darüber bleiben unverändert.
   ================================================================= */

/* --- portierte UI-/Wartungs-Helfer --- */
/* maintSlots, slotCovers, maintAt, anyMaint → core/machines.ts (window bridge).
   The German status-text helpers below stay here (presentation) and call the
   bridged predicates as before. */
/* maintText → ui/machine-text.ts (window bridge). */
function blockText(m,d){ return maintText(maintAt(m,d)); }
function maintKind(m){ const s=maintAt(m,todayStr()); return s?s.type:null; }
function catIco(c){ return ic(c==='messtechnik' ? 'gauge' : 'factory'); }
/* API, apiGet, apiPost, normalizeState → net/api.ts (window bridge). The HTTP data
   client (same-origin, fetch) is unchanged; SSE below still uses the bridged `API`. */
async function readFile(){ return normalizeState(await apiGet('/api/state')); }
/* writeFile()/S.handle/S.lastRaw/lastMtime removed in Phase 5.2 — dead FS-Access-API
   code from the old file-backed variant. Server mode persists via apiPost('/api/mutate')
   in persist() below; it never called writeFile (§14 D4). */

async function persist(fn, logEntry, result){
  saving = true;
  try{
    let out;
    if(result && Array.isArray(result.undo)){
      // Zell-Delta (Buchen/Löschen): prev + neuer Wert je Zelle → Compare-and-Set am Server
      const cells = result.undo.map(e=>({ mid:e.mid, day:e.date, prev:e.prev||null, val:(S.data.bookings[e.mid]||{})[e.date] || null }));
      out = await apiPost('/api/mutate', { cells, log:logEntry.action, user:S.user||'?' });
    } else {
      // strukturelle Änderung (Verwalten): komplette Maschinen-/Gruppenliste
      out = await apiPost('/api/mutate', { machines:S.data.machines, groups:S.data.groups, log:logEntry.action, user:S.user||'?' });
    }
    if(!out || out.error) throw new Error(out && out.error || 'Serverfehler');
    if(typeof out.rev==='number') S.data.revision = out.rev;
    if(out.conflicts && out.conflicts.length){
      showCollision();
      dbg('err','Teilkonflikt: '+out.conflicts.length+' Termin(e) waren bereits belegt');
      await refreshNow(true);   // autoritativen Stand holen und Ansicht angleichen
    } else {
      dbg('write', `${logEntry.action} ✓ (Rev ${out.rev})`);
    }
  }catch(e){
    dbg('err','Speichern fehlgeschlagen: '+e.message);
    toast('⚠️ Speichern fehlgeschlagen ('+e.message+') – hole aktuellen Stand…', null, 6000);
    try{ await refreshNow(true); }catch(_){}
  }finally{ saving=false; }
};

async function refreshNow(silent){
  try{
    const d = await readFile();
    S.data = d; notify(); stampRef();   // 4.1c: repaint via store (subscribed render)
    if(!silent) toast('Aktualisiert ✓');
  }catch(e){
    const el=document.getElementById('lastRef'); if(el) el.textContent='⚠ offline';
    if(!silent) toast('Aktualisieren fehlgeschlagen: '+e.message, null, 6000);
  }
};

/* setupFileObserver()/startRefreshTimer() removed in Phase 5.2 — empty FS-era stubs
   (no polling in server mode; the server pushes via SSE). Their call sites were dropped
   with them. */
/* Removed: migrateWeekends()/migrateMesstechnik() — obsolete one-time client-side
   Bestands-Migrationen from the old File-System-Access variant. They referenced the
   undeclared globals `migrating`/`migratingMess`, so under 'use strict' they threw
   "migrating is not defined" at init and never actually ran (non-fatal). The server
   is authoritative and already consistent ("Serverdaten sind bereits konsistent"):
   migrateMesstechnik needed a local folder (S.dir) that no longer exists, and the
   server rejects the weekend-bridge write (HTTP 400). Deleting them fixes the console
   error while preserving behavior exactly (no migration ran before; none runs now).
   Live weekend upkeep is unaffected — sweepWeekends still runs on every booking write. */

/* --- Live-Verbindung (Server-Sent Events): Push statt Polling ---
   connectSSE, startLiveTimers, presenceTick, applyPresence → ui/live-connection.ts (window
   bridge). Phase 7 slice B8/B10d. */

async function init(){
  document.getElementById('startScreen').style.display='none';
  try{ S.data = await readFile(); }
  catch(e){
    // Ordner-Buttons der alten Datei-Variante ausblenden – hier zählt nur die Serververbindung
    for(const id of ['btnPickFile','btnReadOnly','fsaHint']){ const el=document.getElementById(id); if(el) el.style.display='none'; }
    document.getElementById('startScreen').style.display='';
    document.getElementById('startMsg').innerHTML = 'Verbindung zum Server fehlgeschlagen: '+esc(e.message)+'<br>Läuft der Dienst? Bitte die Seite neu laden.';
    return;
  }
  startUI();
};

init();
/* v9.0 (Server-Variante) — Dieselbe Oberfläche, aber die Datenschicht spricht mit
   dem Node/SQLite-Server: Laden per GET /api/state, Änderungen per POST /api/mutate
   (Zell-Delta mit Compare-and-Set bzw. Maschinenliste), Live-Updates + Präsenz
   (mit Namen) per Server-Sent Events. Kein Dateizugriff, kein Ordner, kein Lock/
   Polling mehr — alles darüber (Raster, Assistent, Statistik, Buchungsgruppen,
   Undo, Filter) ist unverändert. Datei-Funktionen sind im BACKEND-ADAPTER oben
   überschrieben. Latenz für alle: unter ~1 s (Push statt Polling).
   v8.4 — Schreibweg entschlackt: Versionsring + Tagesbackup laufen jetzt NACH der
   Lock-Freigabe und im Hintergrund (ohne await); der Versionsring ist zusätzlich
   auf höchstens alle 90 s gedrosselt. Damit hält ein Schreiber den Lock nur noch
   für den eigentlichen Schreib-/Prüfvorgang (statt zusätzlich für 1–2 weitere
   volle Kopien) → weniger Stau/Ausreißer bei mehreren gleichzeitigen Schreibern.
   Der Flaschenhals bleibt der einzelne atomare Datei-Schreibvorgang (~6–9 s auf
   dem SMB-Server); darunter kommt man nur mit einem Server/Push (kein Datei-Share).
   v8.3 — Diagnose: Schreib-Phasen werden im Debug gemessen (Lock/Lesen/Schreiben/
   Prüflesen in ms), um den Latenz-Anteil des Schreibwegs vom Netz-/Cache-Anteil
   zu trennen.
   v8.2 — Latenz auf Netzlaufwerk verbessern: (1) nach transientem Lesefehler
   (Datei kurz gesperrt, weil ein Kollege schreibt) wird sofort in 0,5 s erneut
   ausgelesen statt einen ganzen Poll-Zyklus (~5 s) zu verlieren – bis zu 4×;
   „offline" erst nach mehreren Fehlversuchen. (2) mtime-Kurzschluss wird
   spätestens alle 30 s übergangen (Vollauslesen), falls das Netzlaufwerk eine
   veraltete Änderungszeit meldet. (3) Neue Intervall-Optionen 2 s/3 s für
   Netzlaufwerke. Erwartete Latenz dadurch grob vom ~2-fachen Intervall auf
   ~1× Intervall + Schreibzeit.
   v8.1 — Debug: Ausbreitungslatenz. Jede fremde Änderung wird beim Abgleich mit
   Erstell-Zeit (Zeitstempel des Absenders aus dem Log), Ankunftszeit und
   automatisch berechneter Latenz („erstellt … → angekommen … · Latenz X s")
   im Debug-Panel angezeigt. Misst OneDrive-Sync + Abgleich-Intervall; hängt von
   den (idealerweise NTP-synchronen) Uhren beider PCs ab.
   v8.0 — Buchungsgruppen (Stufe 1): Buchungen, die in einer Aktion mehrere
   Maschinen/Tage erzeugen (oder mit Titel gebucht werden), erhalten eine
   gemeinsame gid direkt an jeder Zelle ({name,ts,gid,gtitle?}) – kein separater
   Index, damit Undo automatisch stimmt und nichts aufzuräumen ist. Optionales
   Titelfeld im Buchungsdialog; im Zell-Detail „Ganze Buchungsgruppe löschen"
   (alle Maschinen/Tage der gid, Sa/So-Brücken werden mit aufgeräumt); Gruppen-
   titel im Zell-Tooltip. Altbestände ohne gid verhalten sich unverändert
   (Serien-Erkennung). Listen-Zusammenfassung folgt in Stufe 2.
   v7.7 — „Alle Buchungen": Sprung zur Buchung setzt jetzt den Maschinenfilter auf
   die Zielmaschine, damit ihre Zeile garantiert sichtbar ist (auch bei einge-
   klappter Kategorie).
   v7.6 — „Meine Buchungen": Button „Nur meine Maschinen im Plan zeigen" setzt den
   Maschinenfilter (S.machSel) auf genau die Geräte aus den eigenen Buchungen;
   Pin-Icon je Zeile springt zur Buchung im Zeitstrahl (klappt Kategorie/Bereich
   der Maschine bei Bedarf auf, damit die Zeile sichtbar ist).
   v7.5 — Assistent aufgeräumt: (1) keine Kategorie-Buttons mehr, (2) „★ Favoriten"
   oben, (3) neuer Button „Aktuellen Filter übernehmen" (hakt die im „Filtern"-Menü
   gewählten Geräte an und klappt deren Bereiche auf), (4) Assistent und Filter
   öffnen mit allen Kategorien/Bereichen eingeklappt (nur Favoriten offen).
   v7.4 — Kategorie-Buttons vereinheitlicht: „Alle" überall entfernt; es gibt
   nur noch zwei Auswahl-Buttons „Maschinen"/„Messtechnik" (Mehrfach-Toggle,
   standardmäßig beide an). Im „Filtern"-Dropdown filtern sie NUR die Liste
   (welche Kategorie-Abschnitte gezeigt werden) und verändern das Raster NICHT;
   Statistik und Assistent analog. Kategorie-Anzeige im Raster steuert man
   weiterhin ausschließlich über die zwei Buttons oben im Spaltenkopf.
   v7.3 — (1) Doppelklick auf Kategorie-Button oder -Kopfzeile klappt ALLE
   Bereiche der Kategorie auf einmal auf/zu (toggleAllGroupsInCat); Einfachklick
   bleibt „Kategorie ein/aus" (durch kurzen Timer getrennt). (2) Das „Filtern"-
   Dropdown ist ein Klappbaum: beim Öffnen sind Kategorien und Bereiche
   eingeklappt, nur „★ Favoriten" ist offen. (3) Favoriten stehen als eigene
   Sektion ganz oben. (4) „Häkchen aufheben" → „Filter löschen" als klar
   erkennbarer Button (Rahmen, Papierkorb-Icon).
   v7.2 — Einheitliches Kategorie-Modell + UI-Feinschliff (Impeccable-Runde):
   (1) Ein Zustand (S.cats) für alle Kategorie-Steuerungen: obere Buttons,
   Slider im „Filtern"-Dropdown und Kategorie-Kopfzeile im Raster tun dasselbe
   und bleiben synchron. Abwählen = EINKLAPPEN (Kopf bleibt sichtbar), nicht
   verschwinden. (2) Der Filter-Slider steuert jetzt das Raster; die Dropdown-
   Liste bleibt immer vollständig (Einklappen blendet die Liste NICHT aus) –
   plus Ein-Zeilen-Erklärung. (3) „★ Favoriten" als Top-Ebene im selben Stil
   wie Maschinen/Messtechnik. (4) Selector-Buttons (.seg/.catseg) mit sicht-
   baren Trennern, gleichmäßiger Breite, klaren Hover/Aktiv-Zuständen. (5) Gold-
   Stern als Token --star (Hell/Dunkel). (6) Screenreader: role=grid/row/
   gridcell/rowheader/columnheader, aria-expanded an Kopfzeilen und aria-label
   je Zelle (Maschine, Datum, frei/belegt/gesperrt).
   v7.1 — Kategorie-Feinschliff: (1) beide Umschalt-Buttons dürfen aus sein →
   Raster zeigt dann nur die Favoriten (Favoriten bleiben immer sichtbar).
   (2) Die Kategorie-Kopfzeilen im Raster sind jetzt im selben Stil wie die
   Bereichs-Überschriften und per Klick einklappbar (Pfeil). (3) Die oberen
   Buttons und der Kategorie-Kopf im „Filtern"-Dropdown sind synchron: ab-
   gewählte Kategorie erscheint dort eingeklappt, Klick auf den Kopf schaltet
   beides um. (4) „Filtern"- und Statistik-Liste: klarer grauer Trennstreifen
   zwischen den Kategorien, Liste rundet unten sauber ab.
   v7.0 — Zwei Hauptkategorien: „Maschinen" und „Messtechnik". 150 Messgeräte
   in 11 Bereichen (Kraft Messung, Verstärker, Weg Messung, …) samt Buchungen
   2026 aus Messgerätebelegung.xlsx. Import selbstheilend: liegt
   messtechnik_import.json im Datenordner und fehlt Messtechnik noch in der
   Datenbank, wird sie einmalig über mutate/persist übernommen (Lock+Revision
   → auch bei mehreren Clients konfliktfrei; nur freie Zellen werden gefüllt).
   m.cat='messtechnik' kennzeichnet Messtechnik; fehlendes Feld = Maschine.
   UI: Umschalt-Buttons im Spaltenkopf (Kategorie ein-/ausblenden, mind. eine
   aktiv), Kategorie-Trennzeilen im Raster, „Filtern"-Dropdown mit
   Alle/Maschinen/Messtechnik-Slider, Statistik mit Ressourcen-Kategorie-
   Switcher und einklappbaren Kategorie-/Bereichs-Kopfzeilen, Assistent-
   Checkliste mit Slider und einklappbaren Ebenen, Kategorie-Feld im
   Verwalten-Formular, Bereichs-Optgroups in „Alle Buchungen".
   v6.2 — Doppelklick auf den Namens-Chip öffnet die Liste der gerade aktiven
   Nutzer (mit „vor X s"); Einfachklick ändert weiterhin den Namen (kurz
   verzögert, damit der Doppelklick nicht erst das Namensfenster öffnet).
   v6.1 — Auto-Abgleich standardmäßig alle 5 s (dank Änderungszeit-Kurzschluss
   praktisch kostenlos bei unveränderter Datei); pro Gerät weiter umstellbar.
   v6.0 — Robuste Nebenläufigkeit: (1) globale revision in buchungen.json,
   (2) automatischer Retry (bis 6×) bei Konflikt/Lock-belegt, (3) kurzer
   Write-Lock lock.json mit 15-s-Timeout, (7) atomares Schreiben via FS-Access
   bestätigt, (8) Integritäts-Rücklesen (Struktur + Revision) nach jedem
   Schreiben, (10) Polling überspringt unveränderte Dateien per Änderungszeit
   + optionaler FileSystemObserver, (11) versionierte Wiederherstellung als
   6-Slot-Ring (buchungen_verlauf_N.json). Multi-File-Split (4/5) bewusst NICHT
   umgesetzt – bringt neue Konsistenzprobleme + mehr Sync-Konflikte.
   v5.8 — Änderungen von Kollegen werden beim Abgleich einzeln unten gemeldet
   (z. B. „Schönecker hat 1 Maschine gebucht (20.–24.07)"); Warteschlange zeigt
   sie nacheinander und pausiert während eines aktiven „Rückgängig". Eigene
   Aktionen und Auto-Migration werden nicht gemeldet.
   v5.7 — Kein Zurückspringen mehr nach Sprüngen: Zentrieren erfolgt jetzt
   sofort (instant) statt per Smooth-Animation (die mit dem Nutzer-Scroll
   kämpfte); Sprungziele bekommen 2 Wochen Puffer links + 4 rechts, und der
   Scroll-Handler pausiert 350 ms nach programmatischem Scrollen, damit das
   eigene Setzen von scrollLeft kein Re-Render/Reset auslöst.
   v5.6 — (1) Hilfe als kleiner „?"-Knopf, Hauptbuttons rücken auf. (2) Wochenend-
   Anzeige umschaltbar (Einstellungen): Sa/So werden als grau markierte Spalten
   ein-/ausgeblendet (dpw()=5|7). (3) Wochenend-Brücken gelten jetzt, sobald
   Freitag UND Montag belegt sind (auch zwei aufeinanderfolgende Serien
   verschiedener Personen) – Eigentümer = Freitags-Person; die Maschine ist am
   Wochenende dann nicht mehr „frei". Migration/Sweep entsprechend angepasst.
   v5.5 — Sofortiges Buchen/Löschen: mutate() wendet die Änderung optimistisch
   auf den Anzeige-Stand an (Zellen ändern sich im Klick-Moment); persist()
   speichert autoritativ im Hintergrund, merged Deltas gegen fremde Änderungen
   und rollt bei Fehler/Kollision sichtbar zurück. Auto-Refresh pausiert
   während des Speicherns (saving-Flag), damit die Ansicht nicht zurückspringt.
   v5.2 — Performance: (1) Gleitendes 12-Wochen-Fenster beim Endlos-Scrollen
   (MAXW) hält den DOM klein, statt unbegrenzt Wochen anzusammeln; beim
   Ziehen einer Auswahl wird weiter gewachsen, damit der Anker erhalten
   bleibt. (2) Buchen/Löschen/Undo patchen nur noch die betroffenen Zellen
   (patchCells/refreshCell/refreshDot) statt das Raster voll zu rendern.
   v5.4 — Bestands-Migration: missingWeekendBridges()/migrateWeekends()
   ergänzt fehlende Sa/So-Tage in allen bestehenden Fr→Mo-Serien (Start +
   nach Fremd-Updates, idempotent, im Hintergrund).
   v5.3 — Dialoge schließen SOFORT beim Klick (Buchen/Löschen); das Speichern
   läuft danach, Ergebnis kommt als Toast, Konflikte öffnen das Formular
   mit vorbefüllten Werten und Konfliktliste erneut.
   v5.1 — Wochenend-Brückentage in Serien + entblockter Speicherpfad. */
