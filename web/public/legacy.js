'use strict';
/* =================================================================
   GLOBALER ZUSTAND
   S bündelt den gesamten Laufzeitzustand. Grundsatz:
   - teamweite Daten kommen vom Server (S.data spiegelt /api/state),
   - gerätebezogene Vorlieben in localStorage (hier beim Start gelesen).
   ================================================================= */
const S = {
  data: null,          // Datenstand vom Server (/api/state)
  readOnly: false,
  user: localStorage.getItem('mb_user') || '',
  startMonday: mondayOf(new Date()),
  weeks: 2,            // Basis-Wochen; weitere hängen sich beim Scrollen automatisch an
  extraWeeks: 0,                          // auto-appended weeks while scrolling right
  machSel: new Set(JSON.parse(localStorage.getItem('mb_machsel') || '[]')),      // Maschinenfilter (IDs); leer = alle
  groupsSel: new Set(JSON.parse(localStorage.getItem('mb_groupssel') || '[]')),  // Bereichsfilter; leer = alle
  cats: new Set(JSON.parse(localStorage.getItem('mb_cats') || '["maschine","messtechnik"]')), // sichtbare Hauptkategorien
  collapsed: new Set(JSON.parse(localStorage.getItem('mb_collapsed') || '[]')),
  person: localStorage.getItem('mb_person') || '',           // Personenfilter (Hervorhebung)
  personOnly: localStorage.getItem('mb_persononly')==='on',  // nur Zeilen dieser Person
  favs: new Set(JSON.parse(localStorage.getItem('mb_favs') || '[]')),  // Favoriten (Maschinen-IDs)
  visM: [], visD: [],  // currently rendered machine ids (rows) and dates (columns)
  lastRaw: ''          // for change detection on auto-refresh
};

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
function statusRangeText(m){
  const ss=maintSlots(m); if(!ss.length) return '';
  const t=todayStr();
  const active=ss.find(s=>slotCovers(s,t)) || ss.slice().sort((a,b)=>(a.from||'0')<(b.from||'0')?-1:1)[0];
  return maintText(active) + (ss.length>1?` · +${ss.length-1} weitere`:'');
}
// Verfügbare Wochentage: m.days = 7-Zeichen-Maske Mo..So ('1'=verfügbar). Fehlt das Feld → alle Tage verfügbar.
const WD_SHORT=['Mo','Di','Mi','Do','Fr','Sa','So'];
function daysMaskText(m){
  if(!m.days || m.days.length!==7 || m.days==='1111111') return 'jeden Tag';
  const on=WD_SHORT.filter((_,i)=>m.days.charAt(i)==='1');
  return on.length ? on.join(', ') : 'keine Tage';
}
/* catOf, maintSlots, slotCovers, maintAt, isBlockedM, anyMaint, dayAvailable,
   cellBookable → core/machines.ts (provided as window globals by app.ts). */
function stampRef(){
  const el=document.getElementById('lastRef');
  if(el) el.textContent=new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
/* Struktur-/Integritätsprüfung: eine gelesene buchungen.json muss die
   Grundform haben, sonst arbeiten wir nicht mit kaputten Daten weiter. */
function validateData(d){
  if(!d || typeof d!=='object') throw new Error('kein JSON-Objekt');
  if(!Array.isArray(d.machines)) throw new Error('machines fehlt/ungültig');
  if(!d.bookings || typeof d.bookings!=='object') throw new Error('bookings fehlt/ungültig');
  d.log = Array.isArray(d.log) ? d.log : [];
  if(typeof d.revision!=='number') d.revision = 0; // Alt-Dateien ohne Revision
  return d;
}

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
  else render();
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
  render();
  prependWeek(); // eine Woche Vergangenheit als Scroll-Puffer nach links
  centerToday();
  stampRef();
  applyDebug();
  dbg('info','App gestartet — '+(S.data.machines?S.data.machines.length:0)+' Maschinen geladen'+(S.readOnly?' (Nur-Lese-Modus)':''));
  // Auto-refresh + Anwesenheit (einmalige Registrierung, auch bei späterem Freischalten)
  if(!S.readOnly){ startLiveTimers(); setupFileObserver(); }
}
document.getElementById('btnRefresh').onclick = ()=>refreshNow(false);

let presenceData={}; // letzter bekannter Anwesenheitsstand {Name: Zeitstempel} – für die Namensliste
/* Doppelklick auf den Namens-Chip: Liste der gerade aktiven Nutzer */
async function openActiveUsers(){
  try{ await presenceTick(); }catch(e){ handleError('presenceTick', e); }  // frischen Stand holen (eigener Heartbeat + fremde lesen)
  const now=Date.now();
  const rows=Object.entries(presenceData||{})
    .map(([name,ts])=>({name, ago:Math.round((now-ts)/1000)}))
    .filter(r=>r.ago<180)
    .sort((a,b)=>a.ago-b.ago);
  openModal(`
    <h2>${ic('user')} Gerade aktiv${rows.length?' ('+rows.length+')':''}</h2>
    ${rows.length ? '<div class="resultlist" style="max-height:320px">'+rows.map(r=>`
      <div class="mybk"><div><b>${esc(r.name)}</b>${r.name.toLowerCase()===(S.user||'').toLowerCase()?' <span class="hint" style="margin:0">(du)</span>':''}</div>
        <span class="hint" style="margin:0">${r.ago<12?'gerade eben':'vor '+r.ago+' s'}</span></div>`).join('')+'</div>'
      : '<p class="hint">Zurzeit ist niemand aktiv.</p>'}
    <div class="modal-actions"><button class="btn primary" onclick="closeModal()">Schließen</button></div>`);
}

/* ================= User name ================= */
let presCache={txt:'–', title:'Gerade aktive Nutzer'};
function setPres(txt, title){
  presCache={txt, title};
  const el=document.getElementById('presBadge');
  if(el){ el.textContent=txt; el.title=title; }
}
function updateUserChip(){
  // kleine, tiefgestellte Online-Zahl VOR dem Nutzer-Icon im Namens-Chip
  document.getElementById('userChip').innerHTML =
    '<span id="presBadge" title="'+esc(presCache.title)+'">'+esc(presCache.txt)+'</span>'+ic('user')+' '+esc(S.user||'Name?');
}
function askUserName(firstRun){
  openModal(`
    <h2>Wie heißt du?</h2>
    <div class="formrow"><label>Name</label><input type="text" id="unInput" value="${esc(S.user)}" placeholder="Nachname"></div>
    <div class="modal-actions">${firstRun?'':'<button class="btn" onclick="closeModal()">Abbrechen</button>'}
      <button class="btn primary" id="unSave">Speichern</button></div>`);
  const inp=document.getElementById('unInput'); inp.focus();
  const save=()=>{ const v=inp.value.trim(); if(!v){ inp.focus(); return; }
    S.user=v; localStorage.setItem('mb_user',v); updateUserChip(); closeModal(); render();
    dbg('user','Name gesetzt: '+v); presenceTick(); };
  document.getElementById('unSave').onclick=save;
  inp.onkeydown=e=>{ if(e.key==='Enter') save(); };
}
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
function resetView(){ S.extraWeeks=0; document.getElementById('gridWrap').scrollLeft=0; }
/* Zeitpunkt des letzten programmatischen Scrollens: kurz danach ignoriert der
   Scroll-Handler die Fenster-Erweiterung, damit unser eigenes Setzen von
   scrollLeft nicht sofort ein Re-Render + Positions-Reset auslöst
   (das war die Ursache für das „Zurückspringen" nach einem Sprung). */
let lastProgScroll=0;
function centerCol(dISO){
  const cell=document.querySelector(`td.cell[data-date="${dISO}"]`);
  const wrap=document.getElementById('gridWrap');
  if(!cell||!wrap) return;
  wrap.scrollLeft = Math.max(0, cell.offsetLeft - wrap.clientWidth/2 + cell.offsetWidth/2); // instant, mittig
  lastProgScroll = performance.now();
}
function centerToday(){
  requestAnimationFrame(()=>centerCol(todayStr()));
}
document.getElementById('btnToday').onclick = ()=>{ S.startMonday=mondayOf(new Date()); resetView(); render(); prependWeek(); centerToday(); };
document.getElementById('btnPrev').onclick  = ()=>{ S.startMonday=addDays(S.startMonday,-7); render(); };
document.getElementById('btnNext').onclick  = ()=>{ S.startMonday=addDays(S.startMonday, 7); render(); };
function jumpToMonth(){
  // Jahr zweistellig (26 = 2026); vierstellige Eingaben werden auch akzeptiert
  let yy=parseInt(document.getElementById('jumpYear').value);
  if(isNaN(yy)) yy=new Date().getFullYear();
  const y = yy>=1000 ? yy : 2000+yy;
  const mo=parseInt(document.getElementById('jumpMonth').value)||0;
  S.startMonday=mondayOf(new Date(Date.UTC(y,mo,1)));
  const first=ymd(S.startMonday);
  resetView(); render(); prependWeek(); gotoDate(first);
}
document.getElementById('jumpMonth').onchange = jumpToMonth;
document.getElementById('jumpYear').onchange  = jumpToMonth;
function syncJumpControls(){
  const ref=addDays(S.startMonday,3); // Wochenmitte, damit z. B. Mo 29.06. als „Juli" gilt
  document.getElementById('jumpMonth').value = String(ref.getUTCMonth());
  document.getElementById('jumpYear').value  = String(ref.getUTCFullYear()%100);
}
/* Monat/Jahr oben an die aktuell SICHTBARE (linke) Spalte anpassen – läuft beim
   horizontalen Scrollen mit. Setzt nur die Werte (löst kein onchange/Springen aus). */
function updateJumpFromScroll(){
  const wrap=document.getElementById('gridWrap');
  const ths=document.querySelectorAll('#grid thead th[data-date]');
  if(!wrap || !ths.length) return;
  const machw=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--machw'))||230;
  const leftEdge=wrap.getBoundingClientRect().left + machw + 2;   // direkt rechts neben der Maschinenspalte
  let pick=null;
  for(const th of ths){ if(th.getBoundingClientRect().right > leftEdge){ pick=th.dataset.date; break; } }
  if(!pick) pick=ths[ths.length-1].dataset.date;
  const d=parseYmd(pick);
  const mo=document.getElementById('jumpMonth'), yr=document.getElementById('jumpYear');
  if(mo) mo.value=String(d.getUTCMonth());
  if(yr) yr.value=String(d.getUTCFullYear()%100);
}
let jumpRaf=0;
function scheduleJumpSync(){ if(jumpRaf) return; jumpRaf=requestAnimationFrame(()=>{ jumpRaf=0; updateJumpFromScroll(); }); }
/* Zu einem Datum springen: Spalte an den ANFANG (direkt neben der Maschinenspalte) */
function gotoDate(dISO){
  requestAnimationFrame(()=>{
    const cell=document.querySelector(`td.cell[data-date="${dISO}"]`);
    const wrap=document.getElementById('gridWrap');
    if(!cell || !wrap) return;
    const machw=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--machw'))||230;
    wrap.scrollLeft = Math.max(0, cell.offsetLeft - machw - 10); // instant statt smooth (kein Zurückspringen)
    lastProgScroll = performance.now();
  });
}
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
function askConfirm(opts){
  return new Promise(res=>{
    document.getElementById('cfTitle').textContent = opts.title || 'Wirklich löschen?';
    document.getElementById('cfBody').innerHTML = opts.body || '';
    const yBtn=document.getElementById('cfYes');
    yBtn.textContent = opts.yes || 'Löschen';
    yBtn.className = opts.danger===false ? 'btn primary' : 'btn dangerfill';  // neutrale Abfrage vs. Löschen
    document.getElementById('cfNo').textContent = opts.no || 'Abbrechen';
    const box=document.getElementById('confirm2');
    box.classList.add('open');
    document.getElementById('cfNo').focus();
    const done=v=>{
      box.classList.remove('open');
      document.getElementById('cfYes').onclick=null;
      document.getElementById('cfNo').onclick=null;
      res(v);
    };
    document.getElementById('cfYes').onclick=()=>done(true);
    document.getElementById('cfNo').onclick=()=>done(false);
  });
}
function showCollision(){ document.getElementById('collBanner').classList.add('show'); }
document.getElementById('collOk').onclick=()=>document.getElementById('collBanner').classList.remove('show');
let liveTimersOn=false;
function saveFilters(){
  localStorage.setItem('mb_machsel', JSON.stringify([...S.machSel]));
  localStorage.setItem('mb_groupssel', JSON.stringify([...S.groupsSel]));
}
/* Legende + Tastaturkürzel */
function openHelp(){
  openModal(`
    <h2>${ic('help')} Legende &amp; Bedienung</h2>
    <div class="statgrp">Farben &amp; Markierungen im Raster</div>
    <div class="hint" style="font-size:13px;line-height:1.7">
      <b>Farbige Zelle</b> = Buchung; die Farbe ergibt sich aus dem Namen der Person (immer gleich).<br>
      <b>Blauer Rahmen</b> = deine eigene Buchung.<br>
      <b>Oranger Rahmen</b> = Tastatur-Fokus.<br>
      <b>Blaue Tönung</b> = aktuelle Markierung (Ziehen/Shift).<br>
      <b>Schraffierte Zelle</b> = Maschine gesperrt (Wartung/defekt, ggf. zeitlich begrenzt).<br>
      <b>Ausgegraute Zelle</b> = an diesem Wochentag nicht verfügbar (nicht buchbar).<br>
      <span class="dot free"></span> heute frei · <span class="dot busy"></span> heute belegt · <span class="statdot maint">${ic('bolt')}</span> Wartung / <span class="statdot broken">${ic('bolt')}</span> defekt · <span class="dot unavail"></span> heute nicht verfügbar (vor dem Maschinennamen).<br>
      <b style="color:var(--star)">★</b> = Favorit (erscheint oben in „★ Favoriten"), ☆ zum Anheften.<br>
      ${ic('next')} springt zum nächsten freien Termin der Maschine (mehrfach drückbar), ${ic('prev')} wieder zurück bis heute.
    </div>
    <div class="statgrp">Maus</div>
    <div class="hint" style="font-size:13px;line-height:1.7">
      <b>Klick</b> = Zelle auswählen · <b>Doppelklick</b> = Buchen bzw. Buchung öffnen ·
      <b>Ziehen</b> = Bereich markieren (am Rand scrollt es automatisch weiter) ·
      <b>Shift+Klick</b> = Auswahl bis zur Zelle aufspannen · Loslassen öffnet das Buchen/Löschen-Menü.
    </div>
    <div class="statgrp">Tastatur</div>
    <div class="hint" style="font-size:13px;line-height:1.7">
      <b>Pfeiltasten</b> = Zelle bewegen · <b>Shift+Pfeile</b> = Auswahl erweitern ·
      <b>Enter</b> = Buchen/Menü öffnen · <b>Esc</b> = Auswahl/Dialog schließen.
    </div>
    <div class="statgrp">Buchen</div>
    <div class="hint" style="font-size:13px;line-height:1.7">
      Beim Buchen wird der <b>gesamte Zeitraum inkl. Wochenenden</b> gebucht und als <b>Buchungsgruppe</b>
      zusammengefasst (gemeinsam löschbar über das Zellen-Detail). Das Feld <b>Notiz</b> dient zugleich als
      Gruppentitel. Gesperrte Tage (Wartung/defekt) und nicht verfügbare Wochentage werden übersprungen.
    </div>
    <div class="statgrp">${ic('compass')} Buchungsassistent</div>
    <div class="hint" style="font-size:13px;line-height:1.7">
      Geräte in der Liste anhaken – sie erscheinen unter „Ausgewählte Geräte". Standard: <b>alle</b> müssen
      gleichzeitig frei sein. Gleichwertige Geräte per <b>Drag &amp; Drop</b> aufeinander ziehen bildet eine
      <b>Bedarfsgruppe</b>; über die Zahl legst du fest, wie viele davon frei sein müssen („N von …"). Gruppen
      lassen sich verschachteln. Ergebnisse springen ins Raster (Assistent klappt dabei nur ein – Tab links
      zum Wiederaufklappen); ist nach der letzten Buchung alles frei, sind die Tage offen wählbar.
    </div>
    <div class="statgrp">${ic('table')} Buchungslisten &amp; Statistik</div>
    <div class="hint" style="font-size:13px;line-height:1.7">
      <b>Alle Buchungen</b>: filtern nach Person/Maschine/Bereich/Zeitraum und sortieren (Termin, zuletzt
      gebucht, Bereich, Maschine, Person); je Eintrag steht auch, wann gebucht wurde.
      <b>Statistik</b>: Zeitraum standardmäßig ab 1. Januar; drei Tabs <b>${ic('factory')} Ressourcen</b>,
      <b>${ic('user')} Personen</b> und <b>${ic('bolt')} Wartung</b> (Anzahl der Wartungs-/Ausfall-Instanzen
      und gesperrte Tage je Maschine).
    </div>
    <div class="statgrp">${ic('wrench')} Verwalten</div>
    <div class="hint" style="font-size:13px;line-height:1.7">
      Maschinen/Messtechnik anlegen &amp; bearbeiten (sortierbar: manuell, alphabetisch, nach Bereich).
      Pro Gerät: <b>verfügbare Wochentage</b> (nicht gewählte sind im Plan ausgegraut &amp; nicht buchbar)
      und beliebig viele <b>Wartungs-/Ausfall-Slots</b> („in Wartung"/„defekt" mit Zeitraum). Diese
      überlagern Buchungen (grau schraffiert), verhindern neue Buchungen und sind nur hier lösch-/änderbar.
    </div>
    <div class="statgrp">Daten</div>
    <div class="hint" style="font-size:13px;line-height:1.7">
      Der Plan aktualisiert sich automatisch. Jede Buchung/Löschung lässt sich 9 Sekunden lang rückgängig
      machen. Tägliche Backups liegen als buchungen_backup_JJJJ-MM-TT.json im Datenordner.
    </div>
    <div class="modal-actions"><button class="btn primary" onclick="closeModal()">Alles klar</button></div>`);
}
document.getElementById('btnHelp').onclick=openHelp;

/* ================= Einstellungen (pro Gerät) ================= */
function applyTheme(){
  const pref=localStorage.getItem('mb_theme')||'auto';
  const dark = pref==='dark' || (pref==='auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{ applyTheme(); if(S.data) render(); });
if(localStorage.getItem('mb_compact')==='on') document.body.classList.add('compact');


function openSettings(){
  const theme=localStorage.getItem('mb_theme')||'auto';
  const presence=localStorage.getItem('mb_presence')!=='off';
  const compact=localStorage.getItem('mb_compact')==='on';
  const weekends=localStorage.getItem('mb_weekends')==='on';
  openModal(`
    <h2>${ic('gear')} Einstellungen</h2>
    <div class="formrow"><label>Datenquelle</label>
      <div style="flex:1"><b>Server</b> <span class="hint" style="margin:0">(zentrale Datenbank · Live-Updates)</span></div>
      <button class="btn" id="setFolder">${ic('refresh')} Neu verbinden</button></div>
    <div class="formrow"><label>Design</label>
      <select id="setTheme">
        <option value="auto" ${theme==='auto'?'selected':''}>Wie System</option>
        <option value="light" ${theme==='light'?'selected':''}>Hell</option>
        <option value="dark" ${theme==='dark'?'selected':''}>Dunkel</option>
      </select></div>
    <div class="formrow"><label>Anwesenheit</label>
      <label style="min-width:auto"><input type="checkbox" id="setPresence" ${presence?'checked':''}> meinen Namen als „aktiv" teilen</label></div>
    <div class="formrow"><label>Ansicht</label>
      <label style="min-width:auto"><input type="checkbox" id="setCompact" ${compact?'checked':''}> kompakte Zeilen (mehr Maschinen sichtbar)</label></div>
    <div class="formrow"><label>Wochenenden</label>
      <label style="min-width:auto"><input type="checkbox" id="setWeekends" ${weekends?'checked':''}> Samstag &amp; Sonntag anzeigen (grau markiert)</label></div>
    <div class="formrow"><label>Name</label>
      <div style="flex:1"><b>${esc(S.user||'–')}</b></div>
      <button class="btn" id="setName">${ic('user')} Ändern…</button></div>
    <div class="formrow"><label>Debug</label>
      <label style="min-width:auto"><input type="checkbox" id="setDebug" ${dbgOn()?'checked':''}> Debug-Panel anzeigen (protokolliert Schreiben, Updates, Nutzer, Fehler)</label></div>
    <div class="modal-actions"><button class="btn primary" onclick="closeModal()">Fertig</button></div>`);
  document.getElementById('setTheme').onchange = ev=>{
    localStorage.setItem('mb_theme', ev.target.value); applyTheme(); render();
  };
  document.getElementById('setPresence').onchange = ev=>{
    localStorage.setItem('mb_presence', ev.target.checked?'on':'off'); presenceTick();
  };
  document.getElementById('setWeekends').onchange = ev=>{
    localStorage.setItem('mb_weekends', ev.target.checked?'on':'off');
    S.extraWeeks=0; render(); centerToday();
  };
  document.getElementById('setCompact').onchange = ev=>{
    localStorage.setItem('mb_compact', ev.target.checked?'on':'off');
    document.body.classList.toggle('compact', ev.target.checked);
  };
  document.getElementById('setName').onclick = ()=>askUserName(false);
  document.getElementById('setDebug').onchange = ev=>{
    localStorage.setItem('mb_debug', ev.target.checked?'on':'off'); applyDebug();
  };
  document.getElementById('setFolder').onclick = ()=>{ connectSSE(); refreshNow(false); };
}

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
    cb.onchange=()=>{ cb.checked?S.machSel.add(cb.value):S.machSel.delete(cb.value); saveFilters(); cnt(); updateMachBtn(); render(); };
  });
  drop.querySelector('#machClear').onclick=()=>{ S.machSel.clear(); saveFilters(); fillMachSel(); render(); };
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
  drop.querySelector('#grpAll').onchange=()=>{ S.groupsSel.clear(); saveFilters(); fillGroupSel(); updateGroupBtn(); render(); };
  drop.querySelectorAll('.grpCb').forEach(cb=>{
    cb.onchange=()=>{
      cb.checked ? S.groupsSel.add(cb.value) : S.groupsSel.delete(cb.value);
      if(S.groupsSel.size===groupList().length) S.groupsSel.clear(); // all selected = all
      saveFilters(); fillGroupSel(); updateGroupBtn(); render();
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
   ENDLOSES HORIZONTALES SCROLLEN
   Rechts: nahe am rechten Rand wird eine Woche angehängt (extraWeeks++),
   Scrollposition bleibt erhalten. Links: nahe am linken Rand wird eine
   Woche VORANGESTELLT (startMonday -7, extraWeeks++) und scrollLeft um die
   neue Breite kompensiert – die Ansicht steht optisch still. Am absoluten
   Anschlag (scrollLeft=0) feuert kein Scroll-Event mehr, darum fängt ein
   wheel-Listener das Weiter-Scrollen ab. Nach Sprüngen stellt prependWeek()
   sofort eine Puffer-Woche voran, damit der Balken nie am Anschlag klebt.
   extendPending entprellt; Obergrenze 150 Zusatzwochen.
   ================================================================= */
let extendPending=false;
const MAXW=12; // Wochenfenster-Obergrenze: hält den DOM klein und JEDEN Render schnell
function weekWidth(){
  const c=document.querySelector('td.cell');
  return c ? (c.offsetWidth+1)*dpw()+9 : 500;
}
function prependWeek(){
  // Woche links anfügen; oberhalb des Fensters wird stattdessen GESCHOBEN
  // (rechte Woche fällt weg) – Scrollposition bleibt optisch stabil
  if(extendPending) return;
  extendPending=true;
  const el=document.getElementById('gridWrap');
  const keep=el.scrollLeft, before=el.scrollWidth;
  S.startMonday=addDays(S.startMonday,-7);
  if(S.extraWeeks<MAXW || Sel.dragging) S.extraWeeks++; // beim Ziehen: wachsen statt schieben (Anker behalten)
  render();
  const grew=el.scrollWidth-before;
  el.scrollLeft = keep + (grew>0 ? grew : weekWidth());
  setTimeout(()=>{ extendPending=false; }, 80);
}
document.getElementById('gridWrap').addEventListener('scroll', ev=>{
  const el=ev.target;
  scheduleJumpSync();   // Monat/Jahr oben an die aktuell sichtbare Spalte anpassen
  if(extendPending || S.extraWeeks>=150) return;
  if(performance.now()-lastProgScroll < 350) return; // kurz nach programmatischem Scrollen NICHT erweitern
  if(el.scrollLeft + el.clientWidth > el.scrollWidth - 250){
    extendPending=true;
    const keep=el.scrollLeft;
    if(S.extraWeeks<MAXW || Sel.dragging){         // wachsen
      S.extraWeeks++;
      render();
      el.scrollLeft=keep;
    } else {                                        // Fenster nach rechts schieben
      S.startMonday=addDays(S.startMonday,7);
      render();
      el.scrollLeft=Math.max(0, keep-weekWidth());
    }
    setTimeout(()=>{ extendPending=false; }, 100);
  } else if(el.scrollLeft < 150){
    prependWeek();
  }
});
/* Am linken Anschlag löst Scrollen kein scroll-Event mehr aus – Mausrad abfangen */
document.getElementById('gridWrap').addEventListener('wheel', ev=>{
  const el=ev.currentTarget;
  const goingLeft = ev.deltaX < 0 || (ev.shiftKey && ev.deltaY < 0);
  if(goingLeft && el.scrollLeft <= 0) prependWeek();
}, {passive:true});

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
  render();
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
  render();
}
/* Einfach-/Doppelklick trennen (sonst löst der Doppelklick erst den Einfach-
   Toggle aus): kurzer Timer, den der Doppelklick abbricht. */
let catTapTimer=null;
function catTap(c){ clearTimeout(catTapTimer); catTapTimer=setTimeout(()=>toggleCat(c), 220); }
function catTapCancel(){ clearTimeout(catTapTimer); }

/* --- Favoriten: immer oben, überall --- */
const FAVGRP='★ Favoriten';
function displayGroup(m){ return S.favs.has(m.id) ? FAVGRP : m.group; }
function orderedMachines(){
  const rank=m=>catOf(m)==='messtechnik'?1:0;    // Maschinen vor Messtechnik (sort ist stabil)
  const favs=S.data.machines.filter(m=>S.favs.has(m.id));
  const rest=S.data.machines.filter(m=>!S.favs.has(m.id)).slice().sort((a,b)=>rank(a)-rank(b));
  return favs.concat(rest);
}
function toggleFav(mid){
  S.favs.has(mid) ? S.favs.delete(mid) : S.favs.add(mid);
  localStorage.setItem('mb_favs', JSON.stringify([...S.favs]));
  render();
}

function dpw(){ return localStorage.getItem('mb_weekends')==='on' ? 7 : 5; } // Tage je Woche im Raster
function visibleDates(){
  const out=[]; const n=dpw(); // Woche = 5 (Mo–Fr) oder 7 (Mo–So) ISO-Daten
  for(let w=0;w<S.weeks+S.extraWeeks;w++){
    const wk=[]; for(let i=0;i<n;i++) wk.push(ymd(addDays(S.startMonday,w*7+i)));
    out.push(wk);
  }
  return out;
}

function render(){
  const weeks = visibleDates();
  S.visD = weeks.flat();
  S.visM = [];
  const tS = todayStr();
  const thead = document.querySelector('#grid thead');
  const tbody = document.querySelector('#grid tbody');

  // Header: two rows (KW + weekday/date). Im Maschinenspalten-Kopf sitzen die
  // Kategorie-Umschalter: „an" = Kategorie im Raster aufgeklappt, „aus" =
  // eingeklappt (die Kopfzeile bleibt sichtbar). Derselbe Zustand (S.cats)
  // wird auch vom Slider im Filter-Dropdown und der Kategorie-Kopfzeile gesetzt.
  const catBtns=CATS.map(([c,l])=>`<button class="catbtn ${S.cats.has(c)?'on':''}" data-cat="${c}"
    title="${l} ${S.cats.has(c)?'einklappen':'aufklappen'}" aria-pressed="${S.cats.has(c)}">${catIco(c)}<span class="lbl">${l}</span></button>`).join('');
  let h1=`<tr role="row"><th class="machcol" rowspan="2" role="columnheader"><div class="catseg" role="group" aria-label="Kategorien ein-/ausklappen">${catBtns}</div><span id="colResize" title="Spaltenbreite ziehen"></span></th>`;
  let h2=`<tr role="row">`;
  const N=dpw();
  weeks.forEach((wk,i)=>{
    if(i>0){ h1+='<th class="gap" rowspan="2" aria-hidden="true"></th>'; }
    h1+=`<th colspan="${N}" role="columnheader">KW ${isoWeek(parseYmd(wk[0]))}</th>`;
    wk.forEach(d=>{ const dd=parseYmd(d); const we=isWeekend(dd);
      h2+=`<th class="${d===tS?'today':''} ${we?'wknd':''}" role="columnheader">${weekdayName(dd)}<br>${fmtShort(dd)}</th>`; });
  });
  thead.innerHTML=h1+'</tr>'+h2+'</tr>';
  thead.querySelectorAll('.catbtn').forEach(b=>{
    b.onclick=ev=>{ ev.stopPropagation(); catTap(b.dataset.cat); };                          // Einfach: Kategorie ein/aus
    b.ondblclick=ev=>{ ev.stopPropagation(); catTapCancel(); toggleAllGroupsInCat(b.dataset.cat); }; // Doppel: alle Bereiche auf/zu
    b.title = b.title + ' · Doppelklick: alle Bereiche auf-/zuklappen';
  });
  document.documentElement.style.setProperty('--theadh', (thead.offsetHeight||47)+'px'); // für klebende Bereichszeilen

  // Body
  const gcount=new Map(); // Maschinen je (Anzeige-)Bereich für die Kopfzeilen
  for(const mm of orderedMachines()){ const g=displayGroup(mm); gcount.set(g,(gcount.get(g)||0)+1); }
  const totalCol = weeks.length*N + (weeks.length-1); // Tages- + Lückenspalten
  const dlbl={}; for(const d of S.visD) dlbl[d]=fmtLong(d); // Datums-Labels für aria (einmal je Render)
  let html=''; let curGroup=null; let curCat=null; let curCatClosed=false;
  for(const m of orderedMachines()){
    const dg=displayGroup(m); // Favoriten erscheinen in der Gruppe „★ Favoriten" ganz oben
    if(S.groupsSel.size && dg!==FAVGRP && !S.groupsSel.has(m.group)) continue;
    if(!matchesSearch(m)) continue;
    // Hauptkategorie-Kopfzeile (nicht über den Favoriten). Top-Ebene, im selben
    // Stil wie „★ Favoriten"; einklappbar über S.cats – abgewählte Kategorie bleibt
    // als Kopf sichtbar, nur ihre Bereiche/Zeilen werden ausgeblendet. Explizit
    // gewählte Maschinen (Häkchenfilter) heben das Einklappen auf.
    if(dg!==FAVGRP && catOf(m)!==curCat){
      curCat=catOf(m); curGroup=null;
      curCatClosed = !S.cats.has(curCat) && !searchActive();
      html+=`<tr class="grouprow catrow ${!S.cats.has(curCat)?'collapsed':''}" role="row" data-catgroup="${curCat}">
        <td role="rowheader" aria-expanded="${S.cats.has(curCat)}"><span class="arrow">▼</span> ${esc(catLabel(curCat))}</td><td colspan="${totalCol}" style="background:var(--grpbg)" aria-hidden="true"></td></tr>`;
    }
    if(dg!==FAVGRP && curCatClosed) continue;   // Kategorie zugeklappt → Bereiche/Zeilen überspringen
    if(dg!==curGroup){
      curGroup=dg;
      // „★ Favoriten" ist eine eigene Top-Ebene → gleiche Dicke/Stil wie die
      // Kategorie-Kopfzeilen (catrow); normale Bereiche bleiben eine Ebene darunter.
      const isFav = curGroup===FAVGRP;
      html+=`<tr class="grouprow ${isFav?'catrow':''} ${S.collapsed.has(curGroup)?'collapsed':''}" role="row" data-group="${esc(curGroup)}">
        <td role="rowheader" aria-expanded="${!S.collapsed.has(curGroup)}"><span class="arrow">▼</span> ${esc(curGroup)}<span class="gcount">${gcount.get(curGroup)||0}</span></td><td colspan="${totalCol}" style="background:var(--grpbg)" aria-hidden="true"></td></tr>`;
    }
    if(S.collapsed.has(dg) && !searchActive()) continue;
    S.visM.push(m.id);
    const hasStatus = anyMaint(m);
    const mkind = maintKind(m);   // heute aktive Sperre-Art (oder null, wenn nur geplant)
    const statusTag = hasStatus?`<span class="tag ${esc(mkind||'wartung')}" title="${esc(statusRangeText(m))}">${mkind==='defekt'?'defekt':(mkind?'Wartung':'Sperre geplant')}</span>`:'';
    const infoIcon = m.info?` <span class="machinfo" title="${esc(m.info)}">${ic('info')}</span>`:'';
    // Heute-Indikator am Zeilenanfang (CSS-Punkt mit Textalternative)
    const tb=getBooking(m.id,tS);
    const dslot = maintAt(m,tS);
    const dot = dslot
      ? `<span class="statdot ${dslot.type==='defekt'?'broken':'maint'}" role="img" aria-label="heute ${dslot.type==='defekt'?'defekt':'in Wartung'}" title="heute gesperrt – ${esc(blockText(m,tS))}">${ic('bolt')}</span>`
      : tb ? `<span class="dot busy" role="img" aria-label="heute belegt von ${esc(tb.name)}" title="heute belegt: ${esc(tb.name)}"></span>`
           : !dayAvailable(m,tS) ? `<span class="dot unavail" role="img" aria-label="heute nicht verfügbar" title="an diesem Wochentag nicht verfügbar (verfügbar: ${esc(daysMaskText(m))})"></span>`
           : `<span class="dot free" role="img" aria-label="heute frei" title="heute frei"></span>`;
    const star=`<span class="favstar ${S.favs.has(m.id)?'fav':''}" data-fav="${esc(m.id)}" role="button" aria-label="${S.favs.has(m.id)?'Favorit entfernen':'Als Favorit anheften'}" title="${S.favs.has(m.id)?'Favorit entfernen':'Als Favorit anheften'}">${S.favs.has(m.id)?'★':'☆'}</span>`;
    const nextBtn=`<span class="nextfree" data-nf="${esc(m.id)}" role="button" aria-label="Zum nächsten freien Termin von ${esc(m.name)}" title="Zum nächsten freien Termin springen (mehrfach drückbar)">${ic('next')}</span>`;
    const hasBack = !!(nextFreePtr[m.id] && (prevFreeBefore(m, nextFreePtr[m.id]) || nextFreePtr[m.id]!==tS));
    const backBtn = hasBack?`<span class="nextfree back" data-nb="${esc(m.id)}" role="button" aria-label="Eine freie Zelle zurück" title="Eine freie Zelle zurück (bis heute)">${ic('prev')}</span>`:'';
    html+=`<tr role="row"><td class="machcol ${hasBack?'hasback':''}" role="rowheader" title="${esc(m.name)} (${esc(m.group)})${m.info?' — '+esc(m.info):''}${hasStatus?' — '+esc(statusRangeText(m)):''}">${star}${dot}${esc(m.name)}${infoIcon} ${statusTag}${backBtn}${nextBtn}</td>`;
    const mnm=esc(m.name);
    weeks.forEach((wk,i)=>{
      if(i>0) html+='<td class="gap" aria-hidden="true"></td>';
      wk.forEach(d=>{
        const b=getBooking(m.id,d);
        const isToday=d===tS;
        const we=isWeekend(parseYmd(d))?'wknd':'';
        // aria-label: Screenreader liest beim Fokuswechsel Maschine + Datum + Status
        if(isBlockedM(m,d)){
          html+=`<td class="cell blocked ${isToday?'today':''} ${we}" role="gridcell" data-mid="${esc(m.id)}" data-date="${d}" aria-label="${mnm}, ${dlbl[d]}, gesperrt" title="${esc(blockText(m,d))}">${b?esc(b.name):''}</td>`;
        } else if(b){
          const mine = S.user && b.name.toLowerCase()===S.user.toLowerCase();
          const dim = false;
          html+=`<td class="cell booked ${mine?'mine':''} ${dim?'dim':''} ${isToday?'today':''} ${we}" role="gridcell" data-mid="${esc(m.id)}" data-date="${d}"
            style="background:${nameColor(b.name)}" aria-label="${mnm}, ${dlbl[d]}, belegt von ${esc(b.name)}" title="${esc(b.name)}${b.note?' — '+esc(b.note):''}${b.gtitle?' — 📁 '+esc(b.gtitle):''}">${esc(b.name)}</td>`;
        } else if(!dayAvailable(m,d)){
          html+=`<td class="cell unavail ${isToday?'today':''} ${we}" role="gridcell" data-mid="${esc(m.id)}" data-date="${d}" aria-label="${mnm}, ${dlbl[d]}, nicht verfügbar" title="an diesem Wochentag nicht verfügbar (verfügbar: ${esc(daysMaskText(m))})"></td>`;
        } else {
          html+=`<td class="cell free ${isToday?'today':''} ${we}" role="gridcell" data-mid="${esc(m.id)}" data-date="${d}" aria-label="${mnm}, ${dlbl[d]}, frei"></td>`;
        }
      });
    });
    html+='</tr>';
  }
  tbody.innerHTML=html;
  paintSel(); // Auswahl/Fokus nach dem Neuaufbau wieder setzen
  syncJumpControls();
  requestAnimationFrame(ensureOverflow);
}
/* Grid immer breiter als der Viewport halten, damit man in jeder Wochenansicht
   nach rechts scrollen kann (löst dann das automatische Anhängen weiterer Wochen aus) */
function ensureOverflow(){
  const el=document.getElementById('gridWrap');
  if(el.style.display==='none') return;
  if(S.extraWeeks<100 && el.scrollWidth <= el.clientWidth + 60){
    S.extraWeeks++; render();
  }
}

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
const Sel = { anchor:null, focus:null, cells:[], dragging:false, didDrag:false };
function cellEl(mid,date){ return document.querySelector(`td.cell[data-mid="${CSS.escape(mid)}"][data-date="${date}"]`); }
function computeSelCells(){
  if(!Sel.anchor || !Sel.focus) return [];
  const r1=S.visM.indexOf(Sel.anchor.mid), r2=S.visM.indexOf(Sel.focus.mid);
  const c1=S.visD.indexOf(Sel.anchor.date), c2=S.visD.indexOf(Sel.focus.date);
  if(r1<0||r2<0||c1<0||c2<0) return [];
  const cells=[];
  for(let r=Math.min(r1,r2); r<=Math.max(r1,r2); r++)
    for(let c=Math.min(c1,c2); c<=Math.max(c1,c2); c++)
      cells.push({mid:S.visM[r], date:S.visD[c]});
  return cells;
}
function paintSel(){
  document.querySelectorAll('td.cell.sel').forEach(el=>{ el.classList.remove('sel'); el.removeAttribute('aria-selected'); });
  document.querySelectorAll('td.cell.kfocus').forEach(el=>{ el.classList.remove('kfocus'); el.removeAttribute('tabindex'); });
  Sel.cells=computeSelCells();
  for(const c of Sel.cells){ const el=cellEl(c.mid,c.date); if(el){ el.classList.add('sel'); el.setAttribute('aria-selected','true'); } }
  if(Sel.focus){ const el=cellEl(Sel.focus.mid,Sel.focus.date); if(el){ el.classList.add('kfocus'); el.setAttribute('tabindex','0'); } } // roving tabindex
}
function clearSel(){ Sel.anchor=Sel.focus=null; Sel.cells=[]; paintSel(); hideCtx(); }

/* =================================================================
   GEZIELTES ZELL-PATCHING (Performance)
   Nach Buchen/Löschen werden nur die betroffenen Zellen im DOM
   aktualisiert statt das komplette Raster neu zu bauen. Die Liste der
   betroffenen Zellen liefern die Undo-Einträge der Mutation gratis mit.
   Strukturelle Änderungen (Maschinen anlegen/löschen/sortieren, Status)
   und Fremdänderungen per Refresh nutzen weiterhin render().
   ================================================================= */
function refreshCell(mid, date){
  const el=cellEl(mid, date); if(!el) return; // z. B. Wochenendtag: keine Zelle
  const m=machById(mid); if(!m) return;
  const tS=todayStr(); const isToday=date===tS;
  const b=getBooking(mid, date);
  if(isBlockedM(m, date)){
    el.className='cell blocked'+(isToday?' today':'');
    el.style.background=''; el.title=blockText(m,date); el.textContent=b?b.name:'';
  } else if(b){
    const mine=S.user && b.name.toLowerCase()===S.user.toLowerCase();
    const dim=false;
    el.className='cell booked'+(mine?' mine':'')+(dim?' dim':'')+(isToday?' today':'');
    el.style.background=nameColor(b.name);
    el.title=b.name+(b.note?' — '+b.note:'');
    el.textContent=b.name;
  } else if(!dayAvailable(m, date)){
    el.className='cell unavail'+(isToday?' today':'');
    el.style.background=''; el.title='an diesem Wochentag nicht verfügbar'; el.textContent='';
  } else {
    el.className='cell free'+(isToday?' today':'');
    el.style.background=''; el.title=''; el.textContent='';
  }
}
function refreshDot(mid){
  const any=cellEl(mid, S.visD[0]); if(!any) return;
  const row=any.closest('tr'); if(!row) return;
  const dot=row.querySelector('.dot'); if(!dot) return;   // Wartung/defekt nutzt .statdot (Blitz) – bleibt statisch
  const m=machById(mid); if(!m) return;
  const tS=todayStr(); const tb=getBooking(mid, tS);
  if(tb){ dot.className='dot busy'; dot.title='heute belegt: '+tb.name; }
  else if(!dayAvailable(m, tS)){ dot.className='dot unavail'; dot.title='an diesem Wochentag nicht verfügbar'; }
  else { dot.className='dot free'; dot.title='heute frei'; }
}
function patchCells(entries){
  const mids=new Set();
  for(const e of entries){ refreshCell(e.mid, e.date); mids.add(e.mid); }
  mids.forEach(refreshDot);
  paintSel(); // Auswahl-/Fokusmarker wiederherstellen (className wurde ersetzt)
}

/* Zum nächsten freien Werktag einer Maschine springen.
   Mehrfach drückbar: jeder Klick springt RELATIV vom zuletzt gefundenen Slot weiter.
   Ist ab dem Slot nichts mehr gebucht/gesperrt (dauerhaft frei), wird der Knopf ausgegraut. */
const nextFreePtr={};        // mid -> zuletzt angesprungener freier Tag (ISO)
function gotoDateCenter(dISO){
  requestAnimationFrame(()=>centerCol(dISO)); // instant, mittig – kein Zurückspringen mehr
}
/* Nächster freier Werktag ab (exklusive) fromIso; null wenn keiner in ~2 Jahren */
function nextFreeAfter(m, fromIso){
  let d = fromIso ? addDays(parseYmd(fromIso),1) : parseYmd(todayStr());
  for(let i=0;i<730;i++){
    if(!isWeekend(d)){
      const iso=ymd(d);
      if(!getBooking(m.id,iso) && !isBlockedM(m,iso) && dayAvailable(m,iso)) return iso;
    }
    d=addDays(d,1);
  }
  return null;
}
/* Vorheriger freier Werktag vor fromIso, aber nicht vor heute; null wenn keiner */
function prevFreeBefore(m, fromIso){
  const t=todayStr();
  let d=addDays(parseYmd(fromIso),-1);
  while(ymd(d)>=t){
    if(!isWeekend(d)){
      const iso=ymd(d);
      if(!getBooking(m.id,iso) && !isBlockedM(m,iso) && dayAvailable(m,iso)) return iso;
    }
    d=addDays(d,-1);
  }
  return null;
}
/* Gemeinsamer Sprung: rendern, markieren, zentrieren */
function jumpToSlot(m, iso, isBack){
  const mid=m.id;
  // Fenster MIT Puffer auf beiden Seiten aufbauen: 2 Wochen vor dem Ziel, 4 danach.
  // So hat der Slot echten Scroll-Spielraum links UND rechts, und beim Scrollen
  // muss nicht sofort eine Woche an-/vorangestellt werden (das war das Ruckeln).
  S.startMonday=addDays(mondayOf(parseYmd(iso)),-14);
  S.extraWeeks=4;
  document.getElementById('gridWrap').scrollLeft=0;
  render();
  Sel.anchor={mid, date:iso}; Sel.focus={mid, date:iso}; paintSel(); // Zelle markieren
  gotoDateCenter(iso); // Slot mittig auf dem Bildschirm
  // Hinweis, falls ab hier nichts mehr gebucht/gesperrt ist
  const mb=S.data.bookings[mid]||{};
  const lastBooked=Object.keys(mb).filter(x=>x>=todayStr()).sort().pop()||'';
  const _ms=maintSlots(m); const lastBlock = _ms.length ? (_ms.some(s=>!s.until)?'9999-12-31':_ms.map(s=>s.until).sort().pop()) : '';
  const hint = iso > (lastBooked>lastBlock?lastBooked:lastBlock) ? ' (ab hier dauerhaft frei)' : '';
  toast(`${m.name}: ${isBack?'zurück zu':'freier Termin'} ${fmtLong(iso)}${hint}`);
}
function gotoNextFree(mid){
  const m=machById(mid); if(!m) return;
  // Wechsel auf eine andere Maschine: Zähler der übrigen Maschinen zurücksetzen
  // (deren ⏮-Knopf verschwindet damit beim nächsten Rendern)
  for(const k of Object.keys(nextFreePtr)) if(k!==mid) delete nextFreePtr[k];
  const found=nextFreeAfter(m, nextFreePtr[mid]||null);
  if(!found){ toast(`${m.name}: kein freier Termin in den nächsten 2 Jahren gefunden.`); return; }
  nextFreePtr[mid]=found;
  jumpToSlot(m, found, false);
}
/* Freie Zelle für freie Zelle zurück – als letzter Schritt: Sprung auf den heutigen Tag */
function gotoPrevFree(mid){
  const m=machById(mid); if(!m) return;
  if(!nextFreePtr[mid]) return;
  const prev=prevFreeBefore(m, nextFreePtr[mid]);
  if(prev){ nextFreePtr[mid]=prev; jumpToSlot(m, prev, true); return; }
  const t=todayStr();
  if(nextFreePtr[mid]!==t){ nextFreePtr[mid]=t; jumpToSlot(m, t, true); } // letzter Klick: heute
  else toast(`${m.name}: bereits am heutigen Tag.`);
}

function openCellAction(mid,date){
  const m=machById(mid); if(!m) return;
  const b=getBooking(mid,date);
  if(isBlockedM(m,date) && !b){
    toast(`${m.name}: ${blockText(m,date)}`); return;
  }
  if(!dayAvailable(m,date) && !b){
    toast(`${m.name}: an diesem Wochentag nicht verfügbar (verfügbar: ${daysMaskText(m)}).`); return;
  }
  b ? openBookingDetail(m,date,b) : openBookingForm([mid],date,date);
}

const gridEl=document.querySelector('#grid');
/* Auto-Scroll während des Ziehens: am Rand weiterscrollen, damit man über den
   sichtbaren Bereich hinaus markieren kann (Wochen hängen sich automatisch an) */
let dragPos=null, dragScrollTimer=null;
function startDragScroll(){ clearInterval(dragScrollTimer); dragScrollTimer=setInterval(dragAutoScroll, 60); }
function stopDragScroll(){ clearInterval(dragScrollTimer); dragScrollTimer=null; dragPos=null; }
document.addEventListener('mousemove', ev=>{ if(Sel.dragging) dragPos={x:ev.clientX, y:ev.clientY}; });
function dragAutoScroll(){
  if(!Sel.dragging || !dragPos) return;
  const el=document.getElementById('gridWrap');
  const r=el.getBoundingClientRect();
  const machw=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--machw'))||230;
  const edge=45; let moved=false;
  if(dragPos.x > r.right-edge){ el.scrollLeft+=30; moved=true; }
  else if(dragPos.x < r.left+machw+edge){
    if(el.scrollLeft<=0) prependWeek(); else el.scrollLeft-=30;
    moved=true;
  }
  if(dragPos.y > r.bottom-edge){ el.scrollTop+=24; moved=true; }
  else if(dragPos.y < r.top+60 && el.scrollTop>0){ el.scrollTop-=24; moved=true; }
  if(moved && Sel.focus){
    // Zelle unter dem (stillstehenden) Cursor neu ermitteln und Auswahl erweitern
    const x=Math.min(Math.max(dragPos.x, r.left+machw+6), r.right-6);
    const y=Math.min(Math.max(dragPos.y, r.top+55), r.bottom-6);
    const t=document.elementFromPoint(x,y);
    const td=t && t.closest ? t.closest('td.cell') : null;
    if(td && (td.dataset.mid!==Sel.focus.mid || td.dataset.date!==Sel.focus.date)){
      Sel.focus={mid:td.dataset.mid, date:td.dataset.date};
      Sel.didDrag=true;
      paintSel();
    }
  }
}
gridEl.addEventListener('mousedown', ev=>{
  if(ev.button!==0) return;
  const td=ev.target.closest('td.cell'); if(!td) return;
  hideCtx();
  if(ev.shiftKey && Sel.anchor){
    // Shift+Klick: Auswahl vom bestehenden Anker bis zu dieser Zelle aufspannen
    Sel.dragging=true; Sel.didDrag=true;
    Sel.focus={mid:td.dataset.mid, date:td.dataset.date};
    paintSel();
    ev.preventDefault();
    startDragScroll();
    return;
  }
  Sel.dragging=true; Sel.didDrag=false;
  Sel.anchor={mid:td.dataset.mid, date:td.dataset.date};
  Sel.focus={...Sel.anchor};
  paintSel();
  ev.preventDefault(); // no text selection while dragging
  startDragScroll();
});
gridEl.addEventListener('mouseover', ev=>{
  if(!Sel.dragging) return;
  const td=ev.target.closest('td.cell'); if(!td) return;
  if(td.dataset.mid!==Sel.focus.mid || td.dataset.date!==Sel.focus.date){
    Sel.focus={mid:td.dataset.mid, date:td.dataset.date};
    Sel.didDrag=true;
    paintSel();
  }
});
document.addEventListener('mouseup', ev=>{
  if(!Sel.dragging) return;
  Sel.dragging=false;
  stopDragScroll();
  if(Sel.didDrag && Sel.cells.length>1) showCtx(ev.clientX, ev.clientY);
});
gridEl.addEventListener('click', ev=>{
  const fs = ev.target.closest('.favstar');
  if(fs){ toggleFav(fs.dataset.fav); return; }
  const nb = ev.target.closest('[data-nb]');
  if(nb){ gotoPrevFree(nb.dataset.nb); return; }
  const nf = ev.target.closest('[data-nf]');
  if(nf){ gotoNextFree(nf.dataset.nf); return; }
  const gr = ev.target.closest('tr.grouprow');
  if(gr){
    if(gr.dataset.catgroup){ catTap(gr.dataset.catgroup); return; }  // Einfach: Kategorie ein/aus · Doppel (siehe dblclick): alle Bereiche
    const g=gr.dataset.group;
    S.collapsed.has(g)?S.collapsed.delete(g):S.collapsed.add(g);
    localStorage.setItem('mb_collapsed',JSON.stringify([...S.collapsed])); render(); return; }
  if(Sel.didDrag){ Sel.didDrag=false; return; } // drag end, not a click
  // single click only selects the cell (via mousedown) – booking opens on double-click
});
gridEl.addEventListener('dblclick', ev=>{
  const gr = ev.target.closest('tr.grouprow');
  if(gr && gr.dataset.catgroup){ catTapCancel(); toggleAllGroupsInCat(gr.dataset.catgroup); return; } // alle Bereiche der Kategorie auf/zu
  const td = ev.target.closest('td.cell'); if(!td) return;
  openCellAction(td.dataset.mid, td.dataset.date);
});

/* Context menu on selection */
function showCtx(x,y){
  const menu=document.getElementById('ctxMenu');
  const mids=[...new Set(Sel.cells.map(c=>c.mid))];
  const dates=Sel.cells.map(c=>c.date).sort();
  const from=dates[0], to=dates[dates.length-1];
  const booked=Sel.cells.filter(c=>getBooking(c.mid,c.date));
  const names=[...new Set(booked.map(c=>getBooking(c.mid,c.date).name))];
  menu.innerHTML=`
    <div style="padding:4px 10px;font-size:12px;color:var(--muted)">${mids.length} Maschine(n) · ${fmtLong(from)}${from!==to?' – '+fmtLong(to):''}</div>
    <button id="cxBook">${ic('cal')} Buchen…</button>
    ${booked.length?`<button id="cxDel" title="betroffen: ${esc(names.join(', '))}">${ic('trash')} ${booked.length} Buchung(en) löschen</button>`:''}
    <button id="cxClose">Abbrechen</button>`;
  menu.style.display='block';
  const r=menu.getBoundingClientRect();
  menu.style.left=Math.max(4, Math.min(x, innerWidth - r.width - 10))+'px';
  menu.style.top =Math.max(4, Math.min(y, innerHeight - r.height - 10))+'px';
  document.getElementById('cxBook').onclick=()=>{ hideCtx(); openBookingForm(mids, from, to); };
  const d=document.getElementById('cxDel');
  if(d) d.onclick=async ()=>{
    hideCtx();
    if(!await askConfirm({
      title:'Markierte Buchungen löschen?',
      body:`<b>${booked.length}</b> Buchung(en) im Bereich ${esc(fmtLong(from))}${from!==to?' – '+esc(fmtLong(to)):''}.<br>Betroffen: <b>${esc(names.join(', '))}</b>`,
      yes:`${booked.length} Buchung(en) löschen`
    })) return;
    const cells=[...Sel.cells];
    clearSel(); // Markierung sofort aufheben – snappy, Zellen patchen gleich nach
    const res=await mutate(fresh=>{
      let n=0; const undo=[];
      for(const c of cells){
        const mb=fresh.bookings[c.mid];
        if(mb && mb[c.date]){ undo.push({mid:c.mid,date:c.date,prev:{...mb[c.date]}}); delete mb[c.date]; n++; }
      }
      for(const mid2 of mids) undo.push(...sweepWeekends(fresh, mid2)); // Sa/So-Brückentage aufräumen
      return {n, undo};
    }, `Bereich gelöscht: ${mids.length} Maschine(n), ${from} bis ${to}`);
    if(res && !res.abort){ offerUndo(`${res.n} Buchung(en) gelöscht.`, res.undo, 'Bereich löschen'); }
  };
  document.getElementById('cxClose').onclick=()=>{ hideCtx(); clearSel(); };
}
function hideCtx(){ document.getElementById('ctxMenu').style.display='none'; }
document.addEventListener('mousedown', ev=>{
  const m=document.getElementById('ctxMenu');
  if(m.style.display!=='none' && !m.contains(ev.target)) hideCtx();
});

/* Keyboard navigation: arrows move, Shift+arrows extend, Enter opens, Escape clears */
document.addEventListener('keydown', ev=>{
  if(document.getElementById('overlay').classList.contains('open')) return;
  const t=ev.target;
  if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT')) return;
  const arrows={ArrowLeft:[0,-1], ArrowRight:[0,1], ArrowUp:[-1,0], ArrowDown:[1,0]};
  if(arrows[ev.key]){
    ev.preventDefault();
    if(!S.visM.length || !S.visD.length) return;
    if(!Sel.focus){
      Sel.focus={mid:S.visM[0], date:S.visD[0]}; Sel.anchor={...Sel.focus};
    } else {
      const [dr,dc]=arrows[ev.key];
      let r=S.visM.indexOf(Sel.focus.mid)+dr, c=S.visD.indexOf(Sel.focus.date)+dc;
      if(c>=S.visD.length && S.extraWeeks<150){ S.extraWeeks++; render(); } // grow to the right
      if(c<0 && S.extraWeeks<150){ prependWeek(); c=S.visD.indexOf(Sel.focus.date)+dc; } // grow to the left
      r=Math.max(0, Math.min(S.visM.length-1, r));
      c=Math.max(0, Math.min(S.visD.length-1, c));
      Sel.focus={mid:S.visM[r], date:S.visD[c]};
      if(!ev.shiftKey) Sel.anchor={...Sel.focus};
    }
    paintSel();
    const el=cellEl(Sel.focus.mid, Sel.focus.date);
    if(el) el.scrollIntoView({block:'nearest', inline:'nearest'});
  } else if(ev.key==='Enter' && Sel.focus){
    ev.preventDefault();
    if(Sel.cells.length>1){
      const el=cellEl(Sel.focus.mid, Sel.focus.date);
      const r=el?el.getBoundingClientRect():{right:120,bottom:120};
      showCtx(r.right, r.bottom);
    } else openCellAction(Sel.focus.mid, Sel.focus.date);
  } else if(ev.key==='Escape'){ clearSel(); }
});

/* =================================================================
   MODAL / TOAST / UNDO
   openModal(html): tauscht den Inhalt des einen Overlay-Dialogs aus –
   alle Fenster (Buchen, Listen, Statistik, Verwalten …) nutzen ihn.
   toast(msg, undoFn?, ms?): Hinweis unten; mit undoFn erscheint 9 s ein
   „Rückgängig"-Knopf, ms überschreibt die Anzeigedauer (Fehler: länger).
   offerUndo(msg, entries, label): entries=[{mid,date,prev}] beschreibt den
   VORHER-Zustand jeder Zelle; Rückgängig stellt ihn über mutate() wieder
   her (prev=null → Zelle wieder leeren).
   ================================================================= */
let lastFocusEl=null;
let modalSticky=false;  // „sticky": nicht per Klick daneben / Esc schließbar (nur über Buttons)
function openModal(html, opts){
  modalSticky = !!(opts && opts.sticky);
  lastFocusEl=document.activeElement;
  document.getElementById('modalReopen').classList.remove('show'); // neuer Dialog → evtl. eingeklappten verwerfen
  const mo=document.getElementById('modal');
  mo.innerHTML=html;
  document.getElementById('overlay').classList.add('open');
  mo.focus(); // Screenreader/Tastatur landen im Dialog
}
function closeModal(){
  modalSticky=false;
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('modalReopen').classList.remove('show');
  if(lastFocusEl && lastFocusEl.focus){ try{ lastFocusEl.focus(); }catch(e){} } // Fokus zurückgeben
}
// Dialog einklappen (Inhalt/Status bleibt erhalten) → schwebender Tab links zum Wiederaufklappen
function collapseModal(){
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('modalReopen').classList.add('show');
}
function expandModal(){
  document.getElementById('modalReopen').classList.remove('show');
  document.getElementById('overlay').classList.add('open');
  document.getElementById('modal').focus();
}
document.getElementById('modalReopen').addEventListener('click',expandModal);
// Klick auf den Hintergrund bzw. Esc schließt nur, wenn der Dialog NICHT sticky ist.
document.getElementById('overlay').addEventListener('click',ev=>{ if(ev.target.id==='overlay' && !modalSticky) closeModal(); });
document.addEventListener('keydown',ev=>{ if(ev.key==='Escape' && !modalSticky) closeModal(); });
let toastTimer;
function toast(msg, undoFn, ms){
  const t=document.getElementById('toast');
  if(undoFn){
    t.innerHTML=esc(msg)+' <button id="undoBtn">↩ Rückgängig</button>';
    t.classList.add('action');
    document.getElementById('undoBtn').onclick=()=>{ t.classList.remove('show','action'); undoFn(); };
  } else {
    t.textContent=msg; t.classList.remove('action');
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show','action'), ms || (undoFn?9000:3500));
}
/* --- Benachrichtigungen über Änderungen der Kollegen (jede einzeln) ---
   Beim Abgleich neu hinzugekommene fremde Protokolleinträge werden nacheinander
   unten eingeblendet. Eine kleine Warteschlange zeigt sie einzeln (je ~2,6 s)
   und pausiert, solange gerade ein „Rückgängig"-Hinweis aktiv ist. */
function fmtDM(iso){ return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8,10)+'.'+iso.slice(5,7)+'.' : iso; }
function remoteMsg(l){
  const a=String(l.action||'');
  let mm;
  if((mm=a.match(/^Buchung:\s*(.+?),\s*(\d+)\s*Maschine.*?,\s*(\S+)\s*bis\s*(\S+)/)))
    return `${mm[1]} hat ${mm[2]} Maschine${mm[2]==='1'?'':'n'} gebucht (${fmtDM(mm[3])}–${fmtDM(mm[4])})`;
  if((mm=a.match(/^Gelöscht:\s*(.+?)\s*auf\s*(.+?),\s*(\d+)/)))
    return `${l.user} hat ${mm[3]} Tag(e) von „${mm[1]}" auf ${mm[2]} gelöscht`;
  if(a.startsWith('Bereich gelöscht')) return `${l.user} hat einen Buchungsbereich gelöscht`;
  if(a.startsWith('Maschine')) return `${l.user}: ${a}`;
  return `${l.user}: ${a}`;
}
let remoteQ=[], remoteRunning=false;
function queueRemote(msg){
  remoteQ.push(msg);
  if(remoteQ.length>8) remoteQ=remoteQ.slice(-8); // Meldungsflut begrenzen
  if(!remoteRunning) runRemoteQ();
}
function runRemoteQ(){
  if(!remoteQ.length){ remoteRunning=false; return; }
  const t=document.getElementById('toast');
  if(t.classList.contains('action') && t.classList.contains('show')){ setTimeout(runRemoteQ, 1500); return; } // Undo läuft -> warten
  remoteRunning=true;
  toast(remoteQ.shift(), null, 2600);
  setTimeout(runRemoteQ, 2800);
}

/* Bietet nach einer Aktion 9 s lang „Rückgängig" an. entries: [{mid,date,prev}] */
function offerUndo(msg, entries, label){
  if(!entries || !entries.length){ toast(msg); return; }
  toast(msg, async ()=>{
    const res=await mutate(fresh=>{
      for(const e of entries){
        fresh.bookings[e.mid]=fresh.bookings[e.mid]||{};
        if(e.prev) fresh.bookings[e.mid][e.date]=e.prev;
        else delete fresh.bookings[e.mid][e.date];
      }
      return {ok:1, undo:entries}; // gleiche Zellen -> Patch-Pfad statt Voll-Render
    }, 'Rückgängig: '+label);
    if(res && !res.abort) toast('Rückgängig gemacht ✓');
  });
}

/* =================================================================
   BUCHEN
   openBookingForm(mids, von, bis): EIN Formular für 1..n Maschinen (Einzel-
   klick, Bereichsauswahl und Assistent nutzen denselben Weg).
   submitBooking(): bucht alle Werktage im Zeitraum über mutate(). Konflikte
   (belegt oder gesperrt) werden gegen den FRISCHEN Dateistand ermittelt und
   im Dialog gelistet – „Nur freie Termine buchen" überspringt sie. Jede
   erfolgreiche Buchung bekommt 9 s Rückgängig (offerUndo).
   ================================================================= */
function openBookingForm(mids, from, to){
  const machines = mids.map(id=>machById(id)).filter(Boolean);
  openModal(`
    <h2>Buchen</h2>
    <div class="formrow"><label>Maschine(n)</label><div style="flex:1">${machines.map(m=>esc(m.name)).join('<br>')}</div></div>
    <div class="formrow"><label>Name</label><input type="text" id="bkName" value="${esc(S.user)}"></div>
    <div class="formrow"><label>Von</label><input type="date" id="bkFrom" value="${from}">
      <label style="min-width:auto">Bis</label><input type="date" id="bkTo" value="${to}"></div>
    <div class="formrow"><label>Notiz</label><input type="text" id="bkNote" placeholder="optional – Zweck / Kommentar"></div>
    <div id="bkConflicts"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Abbrechen</button>
      <button class="btn primary" id="bkSave">Buchen</button>
    </div>`, {sticky:true});
  document.getElementById('bkSave').onclick = ()=>submitBooking(mids,false);
}
function genGid(){ return 'g_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
async function submitBooking(mids, skipConflicts){
  const name=document.getElementById('bkName').value.trim();
  const from=document.getElementById('bkFrom').value, to=document.getElementById('bkTo').value;
  const note=document.getElementById('bkNote').value.trim();
  const title=note;   // Titel & Notiz zusammengelegt: dient zugleich als Gruppentitel
  if(!name){ toast('Bitte Namen eingeben.'); return; }
  if(!from||!to||from>to){ toast('Bitte gültigen Zeitraum wählen.'); return; }
  // ALLE Tage buchen (inkl. Wochenenden im Zeitraum): so ist die Maschine
  // auch Sa/So Teil der Serie und nicht scheinbar „frei"
  const dates=allDaysRange(from,to);
  if(!dates.length){ toast('Bitte gültigen Zeitraum wählen.'); return; }
  if(dates.length*mids.length>500){ toast('Zeitraum zu groß (max. ~500 Einzelbuchungen).'); return; }

  closeModal(); // Dialog SOFORT schließen – das Speichern läuft im Anschluss, Ergebnis kommt als Toast

  const res = await mutate(fresh=>{
    // check conflicts against FRESH data (belegte Tage + zeitlich gesperrte Tage)
    const conflicts=[];
    for(const mid of mids){
      const m=fresh.machines.find(x=>x.id===mid);
      if(!m) continue;
      const mb=fresh.bookings[mid]||{};
      for(const d of dates){
        if(!dayAvailable(m,d)) continue; // an nicht verfügbaren Wochentagen wird einfach nicht gebucht (Serie überspringt sie)
        if(isBlockedM(m,d)) conflicts.push({mid, date:d, by:`gesperrt (${maintAt(m,d)?.type||'Wartung'})`});
        else if(mb[d]) conflicts.push({mid, date:d, by:mb[d].name});
      }
    }
    if(conflicts.length && !skipConflicts) return {abort:true, conflicts};
    const ts=new Date().toISOString();
    // Buchungsgruppe: eine gemeinsame gid, wenn diese Aktion mehr als eine Zelle
    // erzeugt (mehrere Maschinen und/oder Tage) ODER ein Titel gesetzt wurde.
    const isGroup = mids.length>1 || dates.length>1 || !!title;
    const gid = isGroup ? genGid() : null;
    const extra = gid ? {gid, ...(title?{gtitle:title}:{})} : {};
    let count=0; const undo=[];
    for(const mid of mids){
      const m=fresh.machines.find(x=>x.id===mid);
      if(!m) continue;
      fresh.bookings[mid]=fresh.bookings[mid]||{};
      for(const d of dates){
        if(fresh.bookings[mid][d] || isBlockedM(m,d) || !dayAvailable(m,d)) continue; // nie überschreiben / Sperren + nicht verfügbare Wochentage respektieren
        fresh.bookings[mid][d]={name, ...(note?{note}:{}), ts, ...extra};
        undo.push({mid, date:d, prev:null});
        count++;
      }
    }
    return {count, undo};
  }, `Buchung: ${name}, ${mids.length} Maschine(n), ${from} bis ${to}`);

  if(res && res.conflicts){
    // Konflikte: Formular mit denselben Werten und der Konfliktliste wieder öffnen
    openBookingForm(mids, from, to);
    document.getElementById('bkName').value=name;
    document.getElementById('bkNote').value=note;
    const m2n=id=>{const m=machById(id); return m?m.name:id;};
    const list=res.conflicts.slice(0,15).map(c=>`• ${esc(m2n(c.mid))} ${fmtLong(c.date)}: ${esc(c.by)}`).join('<br>');
    document.getElementById('bkConflicts').innerHTML =
      `<div class="conflictbox"><b>${res.conflicts.length} Termin(e) bereits belegt / gesperrt:</b><br>${list}${res.conflicts.length>15?'<br>…':''}</div>
       <div class="modal-actions" style="margin-top:4px">
         <button class="btn primary" id="bkForce">Nur freie Termine buchen</button></div>`;
    document.getElementById('bkForce').onclick=()=>submitBooking(mids,true);
    return;
  }
  if(res && !res.abort){ offerUndo(`${res.count} Buchung(en) eingetragen ✓`, res.undo, 'Buchung'); }
}

/* ================= Booking detail / delete ================= */
function openBookingDetail(m, date, b){
  // find contiguous run of same name on this machine (weekday-adjacent)
  const run=[date];
  const mb=S.data.bookings[m.id]||{};
  const step=(s,dir)=>{ let d=parseYmd(s); do{ d=addDays(d,dir); }while(isWeekend(d)); return ymd(d); };
  let d=date; while(mb[step(d,-1)] && mb[step(d,-1)].name===b.name){ d=step(d,-1); run.unshift(d); }
  d=date; while(mb[step(d,1)] && mb[step(d,1)].name===b.name){ d=step(d,1); run.push(d); }
  // Buchungsgruppe: alle Zellen (über alle Maschinen) mit derselben gid
  const gid=b.gid||null;
  let gMids=new Set(), gDates=new Set();
  if(gid){
    for(const mid of Object.keys(S.data.bookings)){ const bb=S.data.bookings[mid];
      for(const dd of Object.keys(bb)){ if(bb[dd] && bb[dd].gid===gid){ gMids.add(mid); gDates.add(dd); } } }
  }
  const gDatesArr=[...gDates].sort();
  const gWorkdays=gDatesArr.filter(x=>!isWeekend(parseYmd(x)));
  const gTitle=b.gtitle||'';
  openModal(`
    <h2>Buchung</h2>
    <div class="formrow"><label>Maschine</label><div>${esc(m.name)}</div></div>
    <div class="formrow"><label>Datum</label><div>${fmtLong(date)}</div></div>
    <div class="formrow"><label>Gebucht von</label><div><b>${esc(b.name)}</b></div>
      <button class="btn small" id="bdStats" title="Personenstatistik von ${esc(b.name)} öffnen">${ic('chart')} Statistik</button></div>
    ${b.note?`<div class="formrow"><label>Notiz</label><div>${esc(b.note)}</div></div>`:''}
    ${b.ts?`<div class="formrow"><label>Eingetragen</label><div class="hint" style="margin:0">${new Date(b.ts).toLocaleString('de-DE')}</div></div>`:''}
    ${gid?`<p class="hint">${ic('folder')} Teil einer Buchungsgruppe${gTitle?`: <b>${esc(gTitle)}</b>`:''} — ${gMids.size} Maschine${gMids.size===1?'':'n'}, ${gWorkdays.length} Werktag${gWorkdays.length===1?'':'e'} (${fmtLong(gDatesArr[0])} – ${fmtLong(gDatesArr[gDatesArr.length-1])})</p>`
      : (run.length>1?`<p class="hint">Diese Buchung ist Teil einer Serie: ${fmtLong(run[0])} – ${fmtLong(run[run.length-1])} (${run.length} Werktage)</p>`:'')}
    <div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap">
      <button class="btn" onclick="closeModal()">Schließen</button>
      ${gid?`<button class="btn danger" id="bdDelGroup">Ganze Buchungsgruppe löschen</button>`
           :(run.length>1?`<button class="btn danger" id="bdDelRun">Ganze Serie löschen</button>`:'')}
      <button class="btn danger" id="bdDel">Diesen Tag löschen</button>
    </div>`);
  document.getElementById('bdStats').onclick=()=>{ openStats(b.name.toLowerCase()); };
  const del=async dates=>{
    closeModal(); // sofort zu – Löschung läuft im Anschluss
    const res=await mutate(fresh=>{
      const fmb=fresh.bookings[m.id]||{}; let n=0; const undo=[];
      for(const dd of dates){
        if(fmb[dd] && fmb[dd].name===b.name){ undo.push({mid:m.id,date:dd,prev:{...fmb[dd]}}); delete fmb[dd]; n++; }
      }
      undo.push(...sweepWeekends(fresh, m.id)); // verwaiste Sa/So-Brückentage mit entfernen
      return {n, undo};
    },`Gelöscht: ${b.name} auf ${m.name}, ${dates.length} Tag(e)`);
    if(res&&!res.abort){ offerUndo(`${res.n} Buchung(en) gelöscht.`, res.undo, 'Löschen'); }
  };
  document.getElementById('bdDel').onclick=()=>del([date]);
  const btnRun=document.getElementById('bdDelRun');
  if(btnRun) btnRun.onclick=async ()=>{
    if(await askConfirm({
      title:'Ganze Serie löschen?',
      body:`<b>${esc(b.name)}</b> auf <b>${esc(m.name)}</b><br>${esc(fmtLong(run[0]))} – ${esc(fmtLong(run[run.length-1]))} (${run.length} Werktage)`,
      yes:`${run.length} Tage löschen`
    })) del(run);
  };
  const btnGrp=document.getElementById('bdDelGroup');
  if(btnGrp) btnGrp.onclick=async ()=>{
    if(!await askConfirm({
      title:'Ganze Buchungsgruppe löschen?',
      body:`<b>${esc(gTitle||'Buchung')}</b> von <b>${esc(b.name)}</b><br>${gMids.size} Maschine${gMids.size===1?'':'n'}, ${gWorkdays.length} Werktag${gWorkdays.length===1?'':'e'}: ${esc(fmtLong(gDatesArr[0]))} – ${esc(fmtLong(gDatesArr[gDatesArr.length-1]))}`,
      yes:'Buchungsgruppe löschen'
    })) return;
    closeModal();
    const res=await mutate(fresh=>{
      // gegen den FRISCHEN Stand: alle Zellen mit dieser gid entfernen
      const undo=[]; let n=0; const affected=new Set();
      for(const mid of Object.keys(fresh.bookings)){ const fmb=fresh.bookings[mid];
        for(const dd of Object.keys(fmb)){ if(fmb[dd] && fmb[dd].gid===gid){ undo.push({mid, date:dd, prev:{...fmb[dd]}}); delete fmb[dd]; n++; affected.add(mid); } } }
      for(const mid of affected) undo.push(...sweepWeekends(fresh, mid)); // Sa/So-Brückentage aufräumen
      return {n, undo};
    }, `Gruppe gelöscht: ${gTitle||gid} (${b.name})`);
    if(res && !res.abort) offerUndo(`Buchungsgruppe gelöscht (${res.n} Tag(e)).`, res.undo, 'Löschen');
  };
}

/* ================= Booking assistant =================
   machineChecklist(): Ressourcen-Checkliste mit Kategorie-Slider (Alle /
   Maschinen / Messtechnik) sowie einklappbaren Hauptkategorie- und
   Bereichs-Kopfzeilen. wireChecklistFilter() verdrahtet Suche + Slider +
   Klappen; die Sichtbarkeit jeder Zeile ergibt sich aus allen drei Kriterien
   (Suchtext schlägt Klappzustand: wer sucht, sieht Treffer immer). */
/* Geräte-Checkliste (Assistent): derselbe Klappbaum wie im „Filtern"-Dropdown –
   „★ Favoriten" oben (aufgeklappt), darunter Maschinen/Messtechnik mit ihren
   Bereichen (beim Öffnen eingeklappt). Keine Kategorie-Buttons. */
function machineChecklist(id, preChecked=new Set()){
  const lbl=(m,cat,gk)=>{
    const st = anyMaint(m); const stk=maintKind(m);
    const inf = m.info?` <span class="machinfo" title="${esc(m.info)}" onclick="event.preventDefault();event.stopPropagation()">${ic('info')}</span>`:'';
    return `<label data-name="${esc((m.name+' '+m.group).toLowerCase())}" data-tcat="${cat}"${gk?` data-tgrp="${esc(gk)}"`:''}><input type="checkbox" value="${esc(m.id)}" ${preChecked.has(m.id)?'checked':''}> ${esc(m.name)}${inf} ${st?`<span class="tag ${esc(stk||'wartung')}" title="${esc(statusRangeText(m))}">${stk==='defekt'?'defekt':'Wartung'}</span>`:''}</label>`;
  };
  let html=`<input type="text" id="${id}Search" placeholder="filtern…" style="width:100%;margin-bottom:4px" autocomplete="off"><div class="mlist" id="${id}List">`;
  const favs=S.data.machines.filter(m=>S.favs.has(m.id));
  if(favs.length){ html+=`<div class="grp cathead click" data-tcat="fav"><span class="tarr">▸</span> ★ Favoriten</div>`; for(const m of favs) html+=lbl(m,'fav',''); }
  const rest=S.data.machines.filter(m=>!S.favs.has(m.id)).sort((a,b)=>(catOf(a)==='messtechnik'?1:0)-(catOf(b)==='messtechnik'?1:0));
  let c=null, g=null;
  for(const m of rest){
    const mc=catOf(m);
    if(mc!==c){ c=mc; g=null; html+=`<div class="grp cathead click" data-tcat="${mc}"><span class="tarr">▸</span> ${catLabel(mc)}</div>`; }
    const gk=mc+'::'+m.group;
    if(m.group!==g){ g=m.group; html+=`<div class="grp grpsub click" data-tgrp="${esc(gk)}" data-tcat="${mc}"><span class="tarr">▸</span> ${esc(g)}</div>`; }
    html+=lbl(m,mc,gk);
  }
  return html+'</div>';
}
function wireChecklistFilter(id){
  const list=document.getElementById(id+'List');
  const openCat=new Set(['fav']), openGrp=new Set();   // beim Öffnen: alles zu außer Favoriten
  const apply=()=>{
    const q=document.getElementById(id+'Search').value.toLowerCase();
    const searching=!!q;
    list.querySelectorAll('label').forEach(l=>{
      let vis;
      if(searching) vis=l.dataset.name.includes(q);
      else vis = openCat.has(l.dataset.tcat) && (!l.dataset.tgrp || openGrp.has(l.dataset.tgrp));
      l.style.display=vis?'':'none';
    });
    list.querySelectorAll('.grpsub').forEach(h=>{
      h.style.display=(!searching && openCat.has(h.dataset.tcat))?'':'none';
      const a=h.querySelector('.tarr'); if(a) a.textContent=openGrp.has(h.dataset.tgrp)?'▾':'▸';
    });
    list.querySelectorAll('.cathead').forEach(h=>{
      h.style.display=searching?'none':'';
      const a=h.querySelector('.tarr'); if(a) a.textContent=openCat.has(h.dataset.tcat)?'▾':'▸';
    });
  };
  document.getElementById(id+'Search').oninput=apply;
  list.querySelectorAll('.cathead').forEach(h=>h.onclick=()=>{ const k=h.dataset.tcat; openCat.has(k)?openCat.delete(k):openCat.add(k); apply(); });
  list.querySelectorAll('.grpsub').forEach(h=>h.onclick=()=>{ const k=h.dataset.tgrp; openGrp.has(k)?openGrp.delete(k):openGrp.add(k); apply(); });
  // „Aktuellen Filter übernehmen": hakt die im „Filtern"-Menü gewählten Geräte an
  // und klappt deren Kategorien/Bereiche auf, damit sie sichtbar sind.
  const adopt=document.getElementById(id+'Adopt');
  if(adopt) adopt.onclick=()=>{
    if(!S.machSel.size){ toast('Kein Filter aktiv – im „Filtern"-Menü Geräte auswählen.'); return; }
    let n=0;
    list.querySelectorAll('label').forEach(l=>{
      const inp=l.querySelector('input');
      if(S.machSel.has(inp.value)){ inp.checked=true; n++; openCat.add(l.dataset.tcat); if(l.dataset.tgrp) openGrp.add(l.dataset.tgrp); }
    });
    apply();
    toast(n+' Gerät'+(n===1?'':'e')+' aus dem Filter übernommen.');
  };
  apply();
}
/* ================= Buchungsassistent: Bedarfs-Baukasten (Drag & Drop) =================
   Datenmodell: Baum aus Knoten. Wurzel = UND (alle direkten Kinder müssen erfüllt sein).
     dev  = { uid, type:'dev', id }
     grp  = { uid, type:'grp', need:N, color:hue, children:[...] }   // N von M frei genügt
   Verschachtelung erlaubt (Gruppen in Gruppen). Nur Laufzeit – kein Einfluss auf Buchungen/Stammdaten. */
let AS_TREE={children:[]}, AS_ADDED=new Set(), AS_UID=0, asColorI=0, asDragUid=null;
const AS_HUES=[210,150,275,32,344,190,95,258];
const asUid=()=>'n'+(++AS_UID);
const asNextColor=()=>AS_HUES[(asColorI++)%AS_HUES.length];
function asById(id){ return machById(id); }
function asFind(uid,node=AS_TREE){ for(const c of node.children){ if(c.uid===uid) return c; if(c.type==='grp'){ const r=asFind(uid,c); if(r) return r; } } return null; }
function asFindParent(uid,node=AS_TREE){ for(const c of node.children){ if(c.uid===uid) return node; if(c.type==='grp'){ const r=asFindParent(uid,c); if(r) return r; } } return null; }
function asIsAncestor(aUid,bUid){ if(aUid===bUid) return true; const a=asFind(aUid); return a && a.type==='grp' && !!asFind(bUid,a); }
function asDetach(uid){ const p=asFindParent(uid); if(!p) return null; const i=p.children.findIndex(c=>c.uid===uid); return p.children.splice(i,1)[0]; }
function asDevs(node=AS_TREE){ let a=[]; for(const c of node.children){ if(c.type==='dev') a.push(c.id); else a=a.concat(asDevs(c)); } return a; }
function asCleanup(node=AS_TREE){
  for(const c of node.children) if(c.type==='grp') asCleanup(c);
  node.children = node.children.flatMap(c=>{
    if(c.type!=='grp') return [c];
    if(c.children.length===0) return [];            // leere Gruppe entfernen
    if(c.children.length===1) return [c.children[0]]; // Ein-Element-Gruppe auflösen
    c.need=Math.max(1,Math.min(c.children.length,c.need));
    return [c];
  });
}
function asAdd(id){ if(AS_ADDED.has(id)) return false; AS_TREE.children.push({uid:asUid(),type:'dev',id}); AS_ADDED.add(id); return true; }
function asGroupOnto(dragUid,targetUid){        // Gerät auf Gerät → neue Gruppe
  if(dragUid===targetUid || asIsAncestor(dragUid,targetUid)) return;
  const dragNode=asDetach(dragUid); if(!dragNode) return;
  const p=asFindParent(targetUid); if(!p){ AS_TREE.children.push(dragNode); return; }
  const ti=p.children.findIndex(c=>c.uid===targetUid);
  p.children.splice(ti,1,{uid:asUid(),type:'grp',need:1,color:asNextColor(),children:[p.children[ti],dragNode]});
  asCleanup();
}
function asJoin(dragUid,grpUid){                 // Element in Gruppe verschieben
  if(asIsAncestor(dragUid,grpUid)) return;
  const g=asFind(grpUid); if(!g||g.type!=='grp') return;
  const n=asDetach(dragUid); if(!n) return; g.children.push(n); asCleanup();
}
function asToRoot(dragUid){ const n=asDetach(dragUid); if(!n) return; AS_TREE.children.push(n); asCleanup(); }
function asDissolve(uid){ const g=asFind(uid), p=asFindParent(uid); if(!g||!p) return; const i=p.children.findIndex(c=>c.uid===uid); p.children.splice(i,1,...g.children); asCleanup(); renderWork(); }
function asChangeNeed(uid,delta){ const g=asFind(uid); if(!g) return; g.need=Math.max(1,Math.min(g.children.length,g.need+delta)); renderWork(); }
function asRemove(uid){ const n=asFind(uid); if(n&&n.type==='dev'){ const cb=document.querySelector(`#asList input[value="${CSS.escape(n.id)}"]`); if(cb) cb.checked=false; } asDetach(uid); asCleanup(); AS_ADDED=new Set(asDevs()); renderWork(); }

function asDevHTML(c){
  const m=asById(c.id); if(!m) return '';
  const inf=m.info?` <span class="machinfo" title="${esc(m.info)}" onclick="event.stopPropagation()">${ic('info')}</span>`:'';
  const st=anyMaint(m)?` <span class="tag ${esc(maintKind(m)||'wartung')}" title="${esc(statusRangeText(m))}">${maintKind(m)==='defekt'?'defekt':'Wartung'}</span>`:'';
  return `<div class="asnode asdev" draggable="true" data-uid="${c.uid}" title="${esc(m.name)} (${esc(m.group)})">${esc(m.name)}${inf}${st}<span class="rm" data-rm="${c.uid}" title="Aus Auswahl entfernen">✕</span></div>`;
}
function asGrpHTML(g){
  const M=g.children.length, h=g.color;
  const kids=g.children.map(c=>c.type==='grp'?asGrpHTML(c):asDevHTML(c)).join('');
  const reduHint = M>g.need ? ` <span class="hint" style="margin:0">– alle gleichwertigen Geräte hier?</span>` : '';
  return `<div class="asnode asgrp" draggable="true" data-uid="${g.uid}" style="border-color:hsl(${h} 60% 55%);background:hsla(${h},60%,55%,.10)">
    <div class="asgrp-head" title="Gruppe ziehen zum Verschachteln">
      <b>Bedarf:</b> brauche
      <span class="asgrp-need">
        <button class="asstep" data-dec="${g.uid}" tabindex="-1" title="weniger">–</button>
        <input type="number" class="asNeed" data-need="${g.uid}" value="${g.need}" min="1" max="${M}">
        <button class="asstep" data-inc="${g.uid}" tabindex="-1" title="mehr">+</button>
      </span> von ${M}${reduHint}
      <span class="rm" data-dis="${g.uid}" title="Gruppe auflösen" style="margin-left:auto">✕ auflösen</span>
    </div>
    <div class="asgrp-kids" data-dropgrp="${g.uid}">${kids}</div>
  </div>`;
}
function renderWork(){
  const w=document.getElementById('asWork'); if(!w) return;
  if(!AS_TREE.children.length){ w.innerHTML='<span class="hint" style="margin:0">Oben Geräte anhaken – sie erscheinen hier. Gleichwertige per Drag &amp; Drop aufeinander ziehen = Bedarfsgruppe (dann genügt „N von … frei").</span>'; return; }
  const groups=AS_TREE.children.filter(c=>c.type==='grp');
  const loose=AS_TREE.children.filter(c=>c.type==='dev');
  let html='';
  if(groups.length){ html+='<div class="catlbl">Bedarfsgruppen</div>'+groups.map(asGrpHTML).join(''); }
  if(loose.length){
    html+='<div class="catlbl">Einzelgeräte</div>';
    const byG={}; for(const c of loose){ const m=asById(c.id); const k=m?m.group:'—'; (byG[k]=byG[k]||[]).push(c); }
    for(const k of Object.keys(byG)) html+=byG[k].map(asDevHTML).join('');
  }
  w.innerHTML=html;
  w.querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>asChangeNeed(b.dataset.inc,1));
  w.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>asChangeNeed(b.dataset.dec,-1));
  w.querySelectorAll('input[data-need]').forEach(inp=>{ inp.onchange=()=>{ const g=asFind(inp.dataset.need); if(g){ g.need=Math.max(1,Math.min(g.children.length,parseInt(inp.value)||1)); renderWork(); } }; inp.onclick=e=>e.stopPropagation(); });
  w.querySelectorAll('[data-rm]').forEach(x=>x.onclick=e=>{ e.stopPropagation(); asRemove(x.dataset.rm); });
  w.querySelectorAll('[data-dis]').forEach(x=>x.onclick=e=>{ e.stopPropagation(); asDissolve(x.dataset.dis); });
}
function asClearHi(){ const w=document.getElementById('asWork'); if(!w) return; w.classList.remove('dragover-root'); w.querySelectorAll('.dragover').forEach(n=>n.classList.remove('dragover')); }
function wireWorkDnD(){
  const w=document.getElementById('asWork'); if(!w) return;
  w.addEventListener('dragstart',e=>{ const n=e.target.closest('[data-uid]'); if(!n) return; asDragUid=n.dataset.uid; n.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',asDragUid); e.stopPropagation(); });
  w.addEventListener('dragend',()=>{ w.querySelectorAll('.dragging').forEach(n=>n.classList.remove('dragging')); asClearHi(); asDragUid=null; });
  w.addEventListener('dragover',e=>{ if(!asDragUid) return; e.preventDefault(); e.dataTransfer.dropEffect='move'; asClearHi();
    const kids=e.target.closest('.asgrp-kids'), dev=e.target.closest('.asdev'), grp=e.target.closest('.asgrp');
    if(dev && dev.dataset.uid!==asDragUid) dev.classList.add('dragover');
    else if(kids) kids.classList.add('dragover');
    else if(grp) grp.classList.add('dragover');
    else w.classList.add('dragover-root');
  });
  w.addEventListener('drop',e=>{ if(!asDragUid) return; e.preventDefault(); e.stopPropagation();
    const drag=asDragUid; asDragUid=null; asClearHi();
    const dev=e.target.closest('.asdev'), kids=e.target.closest('.asgrp-kids');
    if(dev && dev.dataset.uid!==drag) asGroupOnto(drag,dev.dataset.uid);
    else if(kids) asJoin(drag,kids.dataset.dropgrp);
    else asToRoot(drag);
    AS_ADDED=new Set(asDevs()); renderWork();
  });
}
let asTipTimer;
function showAsTip(el,msg){
  const tip=document.getElementById('asTip');
  tip.textContent=msg; tip.classList.add('show');
  const r=el.getBoundingClientRect(), tw=tip.offsetWidth, th=tip.offsetHeight;
  let left=Math.max(6, Math.min(r.left + r.width/2 - tw/2, window.innerWidth-tw-6));
  let top=r.top - th - 8; if(top<6) top=r.bottom+8;
  tip.style.left=left+'px'; tip.style.top=top+'px';
  tip.style.setProperty('--tipx', (r.left + r.width/2 - left - 5)+'px');
  clearTimeout(asTipTimer); asTipTimer=setTimeout(()=>tip.classList.remove('show'), 2000);
}
function openAssistant(){
  AS_TREE={children:[]}; AS_ADDED=new Set(); AS_UID=0; asColorI=0; asDragUid=null;
  const t=todayStr(), end=ymd(addDays(parseYmd(t),56));
  openModal(`
    <h2>${ic('compass')} Buchungsassistent</h2>
    ${machineChecklist('as')}
    <div class="catlbl" style="margin-top:4px">Ausgewählte Geräte <span class="hint" style="font-weight:400;text-transform:none;letter-spacing:0">– gleichwertige aufeinander ziehen = Bedarfsgruppe</span></div>
    <div id="asWork" class="aswork"></div>
    <div class="formrow"><label>Suchen von</label><input type="date" id="asFrom" value="${t}">
      <label style="min-width:auto">bis</label><input type="date" id="asTo" value="${end}"></div>
    <div class="formrow"><label>Mind. Tage am Stück</label><input type="number" id="asMin" value="1" min="1" max="30" style="width:70px"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Abbrechen</button>
      <button class="btn primary" id="asGo">Freie Termine suchen</button></div>
    <div id="asResults"></div>`);
  wireChecklistFilter('as');
  renderWork(); wireWorkDnD();
  // Häkchen → Gerät erscheint sofort unten (bzw. verschwindet wieder)
  document.querySelectorAll('#asList input[type="checkbox"]').forEach(cb=>cb.addEventListener('change',()=>asToggleId(cb.value, cb.checked)));
  document.getElementById('asGo').onclick=runAssistant;
}
async function runAssistant(){
  if(!AS_TREE.children.length){ toast('Bitte oben Geräte übernehmen.'); return; }
  const from=document.getElementById('asFrom').value, to=document.getElementById('asTo').value;
  const minDays=Math.max(1,parseInt(document.getElementById('asMin').value)||1);
  if(!from||!to||from>to){ toast('Bitte gültigen Zeitraum wählen.'); return; }
  // „Alle gleichwertigen Geräte erfasst?" – nachfragen, wenn es echte Redundanz gibt (need < Anzahl)
  const anyRedund=node=>node.children.some(c=> c.type==='grp' && (c.children.length>Math.max(1,Math.min(c.children.length,c.need)) || anyRedund(c)));
  if(anyRedund(AS_TREE)){
    const ok=await askConfirm({ title:'Alle gleichwertigen Geräte erfasst?', yes:'Ja, Termine suchen', no:'Zurück', danger:false,
      body:'In mindestens einer Bedarfsgruppe brauchst du weniger Geräte, als enthalten sind (Redundanz). Sind dort alle gleichwertigen Geräte enthalten? Fehlende ggf. oben zur Auswahl hinzufügen.' });
    if(!ok) return;
  }
  const hasGroup=AS_TREE.children.some(c=>c.type==='grp');
  const allIds=[...new Set(asDevs())];
  const days=weekdayRange(from,to);
  const isFreeDev=(id,d)=>{ const m=asById(id); return !!m && !getBooking(id,d) && !isBlockedM(m,d) && dayAvailable(m,d); };
  const nodeNeed=g=>Math.max(1,Math.min(g.children.length,g.need));
  const nodeFree=(node,d)=> node.type==='dev' ? isFreeDev(node.id,d)
      : node.children.filter(c=>nodeFree(c,d)).length >= nodeNeed(node);
  const dayOk=d=>AS_TREE.children.every(c=>nodeFree(c,d));   // Wurzel = UND
  const free=days.filter(dayOk);
  // werktags-zusammenhängende Läufe
  const runs=[]; let cur=[];
  const nextWd=s=>{ let d=parseYmd(s); do{ d=addDays(d,1);}while(isWeekend(d)); return ymd(d); };
  for(const d of free){ if(cur.length && nextWd(cur[cur.length-1])===d) cur.push(d); else { if(cur.length) runs.push(cur); cur=[d]; } }
  if(cur.length) runs.push(cur);
  // Offene Läufe: reicht ein Lauf bis ans Ende des Suchfensters, ist danach (bis zur nächsten echten
  // Buchung/Sperre) alles frei → über das Fenster hinaus verlängern, damit man beliebig lang wählen kann.
  const openRuns=new Set(), EXT_CAP=520;
  for(const r of runs){
    if(nextWd(r[r.length-1]) > to){
      openRuns.add(r);
      let d=nextWd(r[r.length-1]), n=0;
      while(dayOk(d) && n<EXT_CAP){ r.push(d); d=nextWd(d); n++; }
    }
  }
  const good=runs.filter(r=>r.length>=minDays);
  const box=document.getElementById('asResults');
  if(!good.length){ box.innerHTML='<p class="hint"><b>Keine passenden Termine im Zeitraum gefunden.</b> Zeitraum vergrößern, „brauche N" senken oder Geräte entfernen.</p>'; return; }
  const rangeText=sel=>sel.length===1?fmtLong(sel[0]):`${fmtLong(sel[0])} – ${fmtLong(sel[sel.length-1])}`;
  const selFor=i=>{ const r=good[i]; const inp=box.querySelector(`.asDays[data-i="${i}"]`); const n=Math.max(1,Math.min(r.length,parseInt(inp&&inp.value)||1)); return r.slice(0,n); };
  // Für ein gewähltes Fenster je Bedarf „need" Geräte vorauswählen (bevorzugt durchgehend frei)
  const winFree=(node,sel)=>sel.every(d=>nodeFree(node,d));
  const pickNode=(node,sel)=> node.type==='dev' ? [node.id]
      : [...node.children].sort((a,b)=>(winFree(b,sel)?1:0)-(winFree(a,sel)?1:0)).slice(0,nodeNeed(node)).flatMap(c=>pickNode(c,sel));
  const pickFor=sel=>[...new Set(AS_TREE.children.flatMap(c=>pickNode(c,sel)))];
  box.innerHTML=`<h2 style="margin-top:14px">Passende Termine:</h2>
    <div class="resultlist">`+
    good.slice(0,30).map((r,i)=>{
      const def=Math.min(minDays,r.length), sel=r.slice(0,def);
      const open=openRuns.has(r);
      const picked=pickFor(sel).map(id=>asById(id)?.name).filter(Boolean);
      const pickHint=hasGroup?`<br><span class="hint" style="margin:0">Vorschlag: ${picked.length?picked.map(esc).join(', '):'—'}</span>`:'';
      const winTxt=open?`ab ${fmtLong(r[0])} durchgehend frei (offen – ${r.length} Tage wählbar)`:`freies Fenster: ${rangeText(r)} (${r.length} Tag${r.length>1?'e':''})`;
      return `<div class="res"><div><b class="asRange" data-i="${i}">${rangeText(sel)}</b><br>
        <span class="hint" style="margin:0">${winTxt}</span>${pickHint}</div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="number" class="asDays" data-i="${i}" value="${def}" min="1" data-max="${r.length}" style="width:62px" title="Anzahl Tage (ab Fensteranfang)">
        <button class="btn small" data-show="${i}" title="Zum Termin springen und Zeilen auf die gewählten Geräte filtern" aria-label="Termin anzeigen">${ic('pin')}</button>
        <button class="btn small primary" data-i="${i}">Buchen…</button></div></div>`;
    }).join('')+'</div>';
  box.querySelectorAll('.asDays').forEach(inp=>{
    const max=parseInt(inp.dataset.max)||1;
    const tipMsg=`Im freien Fenster sind nur ${max} Tag${max>1?'e':''} am Stück verfügbar.`;
    const clamp=()=>{
      if((parseInt(inp.value)||1) > max){ inp.value=max; showAsTip(inp, tipMsg); }   // Pfeil/Eingabe über Fensterlänge → begrenzen + Hinweis
      const i=+inp.dataset.i;
      box.querySelector(`.asRange[data-i="${i}"]`).textContent=rangeText(selFor(i));
    };
    inp.oninput=clamp;   // deckt Spinner-Pfeile, Tastatur und Direkteingabe ab (kein max-Attribut → Event feuert auch an der Grenze)
  });
  box.querySelectorAll('button[data-i]').forEach(btn=>{ btn.onclick=()=>{ const sel=selFor(+btn.dataset.i); openBookingForm(pickFor(sel), sel[0], sel[sel.length-1]); }; });
  box.querySelectorAll('button[data-show]').forEach(btn=>{
    btn.onclick=()=>{
      const sel=selFor(+btn.dataset.show);
      collapseModal();   // Assistent einklappen statt schließen – Auswahl & Ergebnisse bleiben erhalten
      S.machSel=new Set(allIds);
      saveFilters(); updateMachBtn();
      S.startMonday=mondayOf(parseYmd(sel[0]));
      resetView(); render(); prependWeek();
      clearSel();
      gotoDate(sel[0]);
    };
  });
}


/* ================= Alle Buchungen: Tabelle mit Filtern ================= */
function computeAllRuns(){
  // alle zukünftigen Buchungen als Serien (gleiche Person, zusammenhängende Werktage)
  const t=todayStr();
  const nextWd=s=>{ let d=parseYmd(s); do{ d=addDays(d,1);}while(isWeekend(d)); return ymd(d); };
  const runs=[];
  for(const m of orderedMachines()){
    const mb=S.data.bookings[m.id]||{};
    const ds=Object.keys(mb).filter(d=>d>=t && !isWeekend(parseYmd(d))).sort();
    const runTs=arr=>arr.map(d=>(mb[d]&&mb[d].ts)||'').filter(Boolean).sort()[0]||''; // frühester Erstell-Zeitstempel der Serie
    let cur=[], curName=null;
    for(const d of ds){
      const nm=mb[d].name;
      if(cur.length && curName===nm && nextWd(cur[cur.length-1])===d) cur.push(d);
      else { if(cur.length) runs.push({m, name:curName, dates:cur, ts:runTs(cur)}); cur=[d]; curName=nm; }
    }
    if(cur.length) runs.push({m, name:curName, dates:cur, ts:runTs(cur)});
  }
  runs.sort((a,b)=>a.dates[0]<b.dates[0]?-1:1);
  return runs;
}
function openAllBookings(){
  const t=todayStr();
  openModal(`
    <h2>${ic('table')} Alle Buchungen (ab heute)</h2>
    <div class="abfilters">
      <div class="fld"><label>Person</label><input type="text" id="abPerson" placeholder="Kolmanovskyi"></div>
      <div class="fld"><label>Maschine</label><input type="text" id="abMach" placeholder="Berger"></div>
      <div class="fld"><label>Bereich</label>
        <select id="abGroup"><option value="">Alle</option>${CATS.map(([c,l])=>{
          const gs=groupList().filter(g=>groupCat(g)===c);
          return gs.length?`<optgroup label="${l}">${gs.map(g=>`<option>${esc(g)}</option>`).join('')}</optgroup>`:'';
        }).join('')}</select></div>
      <div class="fld"><label>Sortieren</label>
        <select id="abSort">
          <option value="termin">Termin der Buchung</option>
          <option value="erstellt">Zuletzt gebucht</option>
          <option value="bereich">Bereich</option>
          <option value="maschine">Maschine</option>
          <option value="person">Person</option>
        </select></div>
      <div class="fld"><label>Von</label><input type="date" id="abFrom" value="${t}"></div>
      <div class="fld"><label>Bis</label><input type="date" id="abTo" value=""></div>
    </div>
    <div class="hint" id="abCount" style="margin:0 0 6px"></div>
    <div class="resultlist" style="max-height:420px" id="abList"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Schließen</button></div>`);
  const runsAll=computeAllRuns();
  document.getElementById('abSort').value = localStorage.getItem('mb_absort') || 'termin';
  const sorters={
    termin:   (a,b)=> a.dates[0]<b.dates[0]?-1:(a.dates[0]>b.dates[0]?1:0),
    erstellt: (a,b)=> (b.ts||'').localeCompare(a.ts||''),                       // neueste Buchung zuerst
    bereich:  (a,b)=> (a.m.group||'').localeCompare(b.m.group||'','de') || a.m.name.localeCompare(b.m.name,'de') || (a.dates[0]<b.dates[0]?-1:1),
    maschine: (a,b)=> a.m.name.localeCompare(b.m.name,'de') || (a.dates[0]<b.dates[0]?-1:1),
    person:   (a,b)=> (a.name||'').localeCompare(b.name||'','de') || (a.dates[0]<b.dates[0]?-1:1),
  };
  const renderList=()=>{
    const p=document.getElementById('abPerson').value.trim().toLowerCase();
    const mq=document.getElementById('abMach').value.trim().toLowerCase();
    const g=document.getElementById('abGroup').value;
    const f=document.getElementById('abFrom').value, o=document.getElementById('abTo').value;
    const sort=document.getElementById('abSort').value;
    const rows=runsAll.filter(r=>
      (!p || r.name.toLowerCase().includes(p)) &&
      (!mq || r.m.name.toLowerCase().includes(mq)) &&
      (!g || r.m.group===g) &&
      (!f || r.dates[r.dates.length-1]>=f) &&
      (!o || r.dates[0]<=o)
    ).sort(sorters[sort]||sorters.termin).slice(0,300);
    document.getElementById('abCount').textContent=rows.length+' Einträge'+(rows.length===300?' (gekürzt)':'');
    document.getElementById('abList').innerHTML = rows.map((r,i)=>`
      <div class="mybk"><div style="min-width:0">
        <div class="abmach"><b>${esc(r.m.name)}</b> <span class="hint" style="margin:0">· ${esc(r.m.group)}</span></div>
        <div class="abdate">${r.dates.length>1?`${fmtLong(r.dates[0])} – ${fmtLong(r.dates[r.dates.length-1])}`:fmtLong(r.dates[0])} <span class="tag">${r.dates.length} Tag${r.dates.length>1?'e':''}</span></div>
        <div class="hint" style="margin:0">${ic('user')} ${esc(r.name)}${r.ts?` <span style="opacity:.8">· gebucht am ${esc(new Date(r.ts).toLocaleString('de-DE'))}</span>`:''}</div>
      </div>
      <button class="btn small" data-goto="${i}" title="Im Plan anzeigen" aria-label="Im Plan anzeigen">${ic('pin')}</button></div>`).join('')
      || '<p class="hint">Keine Buchungen für diese Filter gefunden.</p>';
    document.querySelectorAll('#abList [data-goto]').forEach(el=>el.onclick=()=>{
      const r=rows[+el.dataset.goto];
      closeModal();
      // Filter auf die Zielmaschine setzen, damit ihre Zeile garantiert sichtbar
      // ist (auch wenn ihre Kategorie/ihr Bereich eingeklappt ist).
      S.machSel=new Set([r.m.id]); saveFilters(); updateMachBtn();
      S.startMonday=mondayOf(parseYmd(r.dates[0])); resetView(); render(); prependWeek(); gotoDate(r.dates[0]);
      toast(`Plan gefiltert auf „${r.m.name}".`, null, 4000);
    });
  };
  ['abPerson','abMach','abGroup','abFrom','abTo'].forEach(id=>{
    const el=document.getElementById(id); el.oninput=renderList; el.onchange=renderList;
  });
  document.getElementById('abSort').onchange=()=>{ localStorage.setItem('mb_absort',document.getElementById('abSort').value); renderList(); };
  renderList();
}

/* ================= My bookings (mit Serien-Erkennung) =================
   Die Serien-Struktur wird beim Öffnen EINGEFROREN: Löscht man einzelne Tage,
   bleibt die Gruppierung stehen (keine Aufsplittung in Unter-Serien).
   Neu gruppiert wird erst beim nächsten Öffnen des Fensters. */
const myExpanded=new Set();
let myRuns=[];
let myShowPast=false;   // Checkbox in „Meine Buchungen": auch vergangene Buchungen zeigen
function computeMyRuns(){
  const t=todayStr();
  const nextWd=s=>{ let d=parseYmd(s); do{ d=addDays(d,1);}while(isWeekend(d)); return ymd(d); };
  const runs=[];
  for(const m of orderedMachines()){
    const mb=S.data.bookings[m.id]||{};
    const ds=Object.keys(mb).filter(d=>d>=t && !isWeekend(parseYmd(d)) && mb[d].name.toLowerCase()===S.user.toLowerCase()).sort();
    let cur=[];
    for(const d of ds){
      if(cur.length && nextWd(cur[cur.length-1])===d) cur.push(d);
      else { if(cur.length) runs.push({m, dates:cur}); cur=[d]; }
    }
    if(cur.length) runs.push({m, dates:cur});
  }
  runs.sort((a,b)=>a.dates[0]<b.dates[0]?-1:1);
  return runs;
}
function openMyBookings(){
  if(!S.user){ askUserName(false); return; }
  myRuns=computeMyRuns();   // Struktur einfrieren
  renderMyBookings();
}
function renderMyBookings(){
  const pl=S.user.toLowerCase();
  // live = Tage, die (noch) existieren und mir gehören; Struktur aus myRuns
  const runs=myRuns
    .map(r=>({m:r.m, all:r.dates,
      dates:r.dates.filter(d=>{ const b=getBooking(r.m.id,d); return b && b.name.toLowerCase()===pl; })}))
    .filter(r=>r.dates.length);
  const myMids=[...new Set(runs.map(r=>r.m.id))];   // Geräte, auf denen ich Buchungen habe
  openModal(`
    <h2>${ic('clip')} Meine Buchungen (ab heute)</h2>
    ${myMids.length?`<div style="margin-bottom:8px"><button class="btn small" id="myFilter">${ic('search')} Nur meine Maschinen im Plan zeigen (${myMids.length})</button></div>`:''}
    ${runs.length? `<div class="resultlist" style="max-height:440px">`+runs.map((r,i)=>{
      const key=r.m.id+'|'+r.all[0];
      const exp=myExpanded.has(key);
      const isSerie=r.all.length>1;
      const note=d=>{ const b=getBooking(r.m.id,d); return b&&b.note?` <span class="hint" style="margin:0">(${esc(b.note)})</span>`:''; };
      const head=`<div class="mybk"><div>
          ${isSerie?`<span class="chip" data-x="${i}" title="Tage ${exp?'einklappen':'ausklappen'}">${exp?'▾':'▸'}</span> `:''}
          ${isSerie?`${fmtLong(r.dates[0])} – ${fmtLong(r.dates[r.dates.length-1])} <span class="tag">${r.dates.length} Tag${r.dates.length>1?'e':''}</span>`:fmtLong(r.dates[0])}
          — <b>${esc(r.m.name)}</b>${!isSerie?note(r.dates[0]):''}</div>
        <div style="display:flex;gap:6px">
          <button class="btn small" data-goto="${i}" title="Im Plan anzeigen (dorthin springen)" aria-label="Im Plan anzeigen">${ic('pin')}</button>
          <button class="btn small danger" data-del="${i}">${isSerie?'Serie löschen':'Löschen'}</button></div></div>`;
      const days=(isSerie&&exp)? `<div class="daylist">`+r.dates.map(d=>`
        <div class="mybk"><div>${fmtLong(d)}${note(d)}</div>
        <button class="btn small danger" data-day="${i}|${d}">Löschen</button></div>`).join('')+'</div>' : '';
      return head+days;
    }).join('')+'</div>'
    : '<p class="hint">Keine zukünftigen Buchungen unter deinem Namen gefunden.</p>'}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Schließen</button></div>`);
  const mf=document.getElementById('myFilter');
  if(mf) mf.onclick=()=>{
    S.machSel=new Set(myMids); saveFilters(); updateMachBtn(); render(); closeModal();
    toast(`Plan gefiltert: nur deine ${myMids.length} Maschine${myMids.length===1?'':'n'}. Aufheben über „Filtern → Filter löschen".`, null, 6000);
  };
  // Pin: zur Buchung im Zeitstrahl springen (Zeile sichtbar machen: Kategorie/Bereich aufklappen)
  document.querySelectorAll('#modal [data-goto]').forEach(el=>el.onclick=()=>{
    const r=runs[+el.dataset.goto]; const m=r.m; const iso=r.dates[0];
    closeModal();
    S.cats.add(catOf(m)); localStorage.setItem('mb_cats', JSON.stringify([...S.cats]));
    S.collapsed.delete(m.group); if(S.favs.has(m.id)) S.collapsed.delete(FAVGRP);
    localStorage.setItem('mb_collapsed', JSON.stringify([...S.collapsed]));
    S.startMonday=mondayOf(parseYmd(iso));
    resetView(); render(); prependWeek(); gotoDate(iso);
  });
  document.querySelectorAll('#modal [data-x]').forEach(el=>el.onclick=()=>{
    const r=runs[+el.dataset.x]; const key=r.m.id+'|'+r.all[0];
    myExpanded.has(key)?myExpanded.delete(key):myExpanded.add(key);
    renderMyBookings();
  });
  const delDates=async (m, dates)=>{
    const res=await mutate(fresh=>{
      const mb=fresh.bookings[m.id]||{}; let n=0; const undo=[];
      for(const d of dates){
        if(mb[d] && mb[d].name.toLowerCase()===S.user.toLowerCase()){
          undo.push({mid:m.id,date:d,prev:{...mb[d]}}); delete mb[d]; n++;
        }
      }
      undo.push(...sweepWeekends(fresh, m.id)); // Sa/So-Brückentage aufräumen
      return {n, undo};
    }, `Gelöscht: ${S.user} auf ${m.name}, ${dates.length} Tag(e)`);
    if(res && !res.abort){ renderMyBookings(); offerUndo(`${res.n} Buchung(en) gelöscht.`, res.undo, 'Löschen'); }
  };
  document.querySelectorAll('#modal [data-del]').forEach(el=>el.onclick=async ()=>{
    const r=runs[+el.dataset.del];
    if(r.dates.length>1 && !await askConfirm({
      title:'Ganze Serie löschen?',
      body:`Deine Serie auf <b>${esc(r.m.name)}</b>:<br>${esc(fmtLong(r.dates[0]))} – ${esc(fmtLong(r.dates[r.dates.length-1]))} (${r.dates.length} Tage)`,
      yes:`${r.dates.length} Tage löschen`
    })) return;
    delDates(r.m, r.dates);
  });
  document.querySelectorAll('#modal [data-day]').forEach(el=>el.onclick=()=>{
    const parts=el.dataset.day.split('|'); const r=runs[+parts[0]];
    delDates(r.m, [parts[1]]);
  });
}

/* ================= Statistik: Maschinen ⇄ Personen mit Drilldown ================= */
function openStats(presetPerson){
  const t=todayStr();
  const from=`${new Date().getFullYear()}-01-01`, to=t;   // Standard: 1. Januar des Jahres bis heute
  let mode=presetPerson?'p':'m';   // 'm' = Ressourcen, 'p' = Personen
  let selM=null;                   // Drilldown: Maschinen-ID
  let selP=presetPerson||null;     // Drilldown: Personen-Key (lowercase)
  const stShow=new Set(['maschine','messtechnik']); // sichtbare Kategorien (Auswahl-Buttons)
  const stClosed=new Set();        // eingeklappte Bereiche/Kategorien ('c:maschine' bzw. 'g:Bereich')
  let agg=null;
  openModal(`
    <h2>${ic('chart')} Statistik</h2>
    <div class="formrow"><label>Von</label><input type="date" id="stFrom" value="${from}">
      <label style="min-width:auto">Bis</label><input type="date" id="stTo" value="${to}"></div>
    <div class="formrow">
      <div class="seg"><button id="segM" class="${mode==='m'?'on':''}">${ic('factory')} Ressourcen</button><button id="segP" class="${mode==='p'?'on':''}">${ic('user')} Personen</button><button id="segW" class="${mode==='w'?'on':''}">${ic('bolt')} Wartung</button></div>
      <div class="seg" id="stCatSeg" role="group" aria-label="Kategorie wählen" style="${mode==='m'?'':'display:none'}">
        ${CATS.map(([c,l])=>`<button data-c="${c}" class="on" aria-pressed="true">${catIco(c)} ${l}</button>`).join('')}
      </div>
    </div>
    <div class="formrow">
      <input type="text" id="stFilter" placeholder="filtern…" style="flex:1;min-width:120px" autocomplete="off">
      <button class="btn small" id="stBack" style="display:none">← Übersicht</button>
    </div>
    <div id="stOut"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Schließen</button></div>`);

  const compute=()=>{
    const f=document.getElementById('stFrom').value, o=document.getElementById('stTo').value;
    if(!f||!o||f>o){ toast('Bitte gültigen Zeitraum wählen.'); return false; }
    const days=weekdayRange(f,o);
    const machRows=[]; const persons=new Map();
    for(const m of orderedMachines()){
      const mb=S.data.bookings[m.id]||{};
      let n=0; const pmap=new Map();
      for(const d of days){
        const b=mb[d]; if(!b||!b.name) continue;
        n++;
        const k=b.name.toLowerCase();
        pmap.set(k,{name:b.name, days:(pmap.get(k)?pmap.get(k).days:0)+1});
        if(!persons.has(k)) persons.set(k,{name:b.name, days:0, machines:new Map()});
        const e=persons.get(k); e.days++;
        e.machines.set(m.name,(e.machines.get(m.name)||0)+1);
      }
      machRows.push({m, n, pct: days.length?Math.round(n*100/days.length):0, persons:pmap});
    }
    // Wartung/Ausfall: Instanzen (Slots, die den Zeitraum schneiden) + gesperrte Kalendertage
    const calDays=allDaysRange(f,o);
    const maintRows=[]; let maintInst=0, maintDays=0;
    for(const m of orderedMachines()){
      const inRange=maintSlots(m).filter(s=>(!s.until||s.until>=f)&&(!s.from||s.from<=o));
      let dc=0; for(const d of calDays) if(isBlockedM(m,d)) dc++;
      if(inRange.length||dc){ maintRows.push({m, inst:inRange.length, days:dc}); maintInst+=inRange.length; maintDays+=dc; }
    }
    agg={days, machRows, persons, maint:{rows:maintRows, inst:maintInst, days:maintDays}};
    return true;
  };

  const bar=p=>`<div class="statbar"><div style="width:${p}%"></div></div>`;

  const renderStats=()=>{
    const out=document.getElementById('stOut'); if(!agg){ out.innerHTML=''; return; }
    const q=document.getElementById('stFilter').value.trim().toLowerCase();
    document.getElementById('stBack').style.display=(selM||selP)?'':'none';
    const total=agg.days.length;
    let html='';
    if(mode==='m' && selM){
      // Drilldown Maschine: wer hat sie belegt?
      const r=agg.machRows.find(x=>x.m.id===selM);
      if(!r){ selM=null; return renderStats(); }
      const ps=[...r.persons.values()].sort((a,b)=>b.days-a.days);
      const maxD=ps.length?ps[0].days:1;
      html=`<p class="hint"><b>${esc(r.m.name)}</b> (${esc(r.m.group)}) — belegt an <b>${r.n}</b> von ${total} Werktagen (${r.pct}%)</p>
        <div class="statgrp">${ic('user')} Am meisten belegt von</div>
        <div class="resultlist" style="max-height:380px">`+
        (ps.length? ps.map(p=>`<div class="statrow">
          <span class="nm">${esc(p.name)}</span>${bar(Math.round(p.days*100/maxD))}
          <span class="pct">${p.days} Tg · ${r.n?Math.round(p.days*100/r.n):0}%</span></div>`).join('')
        : '<p class="hint">Keine Buchungen im Zeitraum.</p>')+'</div>';
    } else if(mode==='p' && selP){
      // Drilldown Person: welche Maschinen?
      const p=agg.persons.get(selP);
      if(!p){ selP=null; return renderStats(); }
      const ms=[...p.machines.entries()].sort((a,b)=>b[1]-a[1]);
      const maxD=ms.length?ms[0][1]:1;
      html=`<p class="hint"><b>${esc(p.name)}</b> — <b>${p.days}</b> gebuchte Maschinentage auf ${p.machines.size} Maschine${p.machines.size===1?'':'n'}</p>
        <div class="statgrp">${ic('factory')} Meistgenutzte Maschinen</div>
        <div class="resultlist" style="max-height:380px">`+
        ms.map(([mn,d])=>`<div class="statrow">
          <span class="nm" title="${esc(mn)}">${esc(mn)}</span>${bar(Math.round(d*100/maxD))}
          <span class="pct">${d} Tg · ${Math.round(d*100/p.days)}%</span></div>`).join('')+'</div>';
    } else if(mode==='m'){
      // Übersicht Ressourcen: nach Hauptkategorie und Bereich gegliedert;
      // beide Ebenen sind per Klick auf die Kopfzeile einklappbar (stClosed).
      // Die Auswahl-Buttons (stShow) blenden eine Kategorie ganz aus.
      const catsOrdered=[]; const byCat=new Map();  // cat -> [Gruppenname...] in Reihenfolge
      const byGroup=new Map();
      for(const r of agg.machRows){
        if(q && !r.m.name.toLowerCase().includes(q)) continue;
        if(!stShow.has(catOf(r.m))) continue;
        const c=catOf(r.m), g=r.m.group;
        if(!byCat.has(c)){ byCat.set(c,[]); catsOrdered.push(c); }
        if(!byGroup.has(g)){ byGroup.set(g,[]); byCat.get(c).push(g); }
        byGroup.get(g).push(r);
      }
      let sum=0,cnt=0,body='';
      for(const c of catsOrdered){
        const cClosed=stClosed.has('c:'+c);
        const cRows=byCat.get(c).flatMap(g=>byGroup.get(g));
        const cavg=Math.round(cRows.reduce((s,r)=>s+r.pct,0)/(cRows.length||1));
        if(catsOrdered.length>1)
          body+=`<div class="statgrp cathead click ${cClosed?'closed':''}" data-fold="c:${c}"><span class="arrow">▼</span> ${catLabel(c)} · Ø ${cavg}%</div>`;
        if(cClosed){ sum+=cRows.reduce((s,r)=>s+r.pct,0); cnt+=cRows.length; continue; }
        for(const g of byCat.get(c)){
          const rows=byGroup.get(g).sort((a,b)=>b.pct-a.pct || a.m.name.localeCompare(b.m.name,'de'));
          const gavg=Math.round(rows.reduce((s,r)=>s+r.pct,0)/(rows.length||1));
          sum+=rows.reduce((s,r)=>s+r.pct,0); cnt+=rows.length;
          const gClosed=stClosed.has('g:'+g);
          body+=`<div class="statgrp click ${gClosed?'closed':''}" data-fold="g:${esc(g)}"><span class="arrow">▼</span> ${esc(g)} · Ø ${gavg}%</div>`;
          if(gClosed) continue;
          body+=rows.map(r=>`<div class="statrow click" data-selm="${esc(r.m.id)}" title="Klicken: wer hat ${esc(r.m.name)} belegt?">
            <span class="nm">${esc(r.m.name)}</span>${bar(r.pct)}
            <span class="pct">${r.n}/${total} · ${r.pct}%</span></div>`).join('');
        }
      }
      const avg=cnt?Math.round(sum/cnt):0;
      html=`<p class="hint">${total} Werktage</p>
        <div class="resultlist" style="max-height:400px">`+body+'</div>';
    } else if(mode==='w'){
      // Übersicht Wartung/Ausfall: Anzahl Instanzen + gesperrte Tage je Maschine
      const rows=agg.maint.rows.filter(r=>!q||r.m.name.toLowerCase().includes(q))
        .sort((a,b)=>b.days-a.days || b.inst-a.inst || a.m.name.localeCompare(b.m.name,'de'));
      const maxD=rows.length?Math.max(1,rows[0].days):1;
      html=`<p class="hint"><b>${agg.maint.inst}</b> Wartungs-/Ausfall-Instanz${agg.maint.inst===1?'':'en'} · <b>${agg.maint.days}</b> gesperrte Tage im Zeitraum</p>
        <div class="resultlist" style="max-height:400px">`+
        (rows.length? rows.map(r=>`<div class="statrow">
          <span class="nm" title="${esc(r.m.group)}">${esc(r.m.name)}</span>${bar(Math.round(r.days*100/maxD))}
          <span class="pct">${r.inst}× · ${r.days} Tg</span></div>`).join('')
        : '<p class="hint">Keine Wartungs-/Ausfallzeiten im Zeitraum.</p>')+'</div>';
    } else {
      // Übersicht Personen: Vielbucher zuerst, Zeilen klickbar
      const ps=[...agg.persons.values()].filter(p=>!q||p.name.toLowerCase().includes(q))
        .sort((a,b)=>b.days-a.days || a.name.localeCompare(b.name,'de'));
      const maxD=ps.length?ps[0].days:1;
      html=`<p class="hint">${ps.length} Person${ps.length===1?'':'en'} mit Buchungen im Zeitraum — Zeile anklicken für die Maschinen-Aufschlüsselung</p>
        <div class="resultlist" style="max-height:400px">`+
        ps.map(p=>`<div class="statrow click" data-selp="${esc(p.name.toLowerCase())}" title="Klicken: welche Maschinen nutzt ${esc(p.name)}?">
          <span class="nm">${esc(p.name)}</span>${bar(Math.round(p.days*100/maxD))}
          <span class="pct">${p.days} Tg · ${p.machines.size} Masch.</span></div>`).join('')+'</div>';
    }
    out.innerHTML=html;
    out.querySelectorAll('[data-selm]').forEach(el=>el.onclick=()=>{ selM=el.dataset.selm; renderStats(); });
    out.querySelectorAll('[data-selp]').forEach(el=>el.onclick=()=>{ selP=el.dataset.selp; renderStats(); });
    out.querySelectorAll('[data-fold]').forEach(el=>el.onclick=()=>{      // Kategorie/Bereich ein-/ausklappen
      const k=el.dataset.fold; stClosed.has(k)?stClosed.delete(k):stClosed.add(k); renderStats(); });
  };

  const setMode=mm=>{
    mode=mm; selM=null; selP=null;
    document.getElementById('segM').classList.toggle('on', mode==='m');
    document.getElementById('segP').classList.toggle('on', mode==='p');
    document.getElementById('segW').classList.toggle('on', mode==='w');
    document.getElementById('stCatSeg').style.display = mode==='m' ? '' : 'none';
    document.getElementById('stFilter').value='';
    renderStats();
  };
  document.getElementById('segM').onclick=()=>setMode('m');
  document.getElementById('segP').onclick=()=>setMode('p');
  document.getElementById('segW').onclick=()=>setMode('w');
  document.querySelectorAll('#stCatSeg button').forEach(b=>{
    b.onclick=()=>{ const c=b.dataset.c; stShow.has(c)?stShow.delete(c):stShow.add(c);
      b.classList.toggle('on', stShow.has(c)); b.setAttribute('aria-pressed', stShow.has(c));
      renderStats(); };
  });
  document.getElementById('stFilter').oninput=renderStats;
  document.getElementById('stBack').onclick=()=>{ selM=null; selP=null; renderStats(); };
  // Zeitraum ändern → automatisch neu berechnen (kein „Berechnen"-Knopf mehr)
  document.getElementById('stFrom').onchange=()=>{ if(compute()) renderStats(); };
  document.getElementById('stTo').onchange=()=>{ if(compute()) renderStats(); };
  if(compute()) renderStats();
}
document.getElementById('btnStats').onclick  = ()=>openStats();
document.getElementById('btnAdmin').onclick  = openAdmin;

/* ================= Admin: machines, status, log ================= */
function openAdmin(){
  let adSort = localStorage.getItem('mb_admsort') || 'manual';
  openModal(`
    <h2>${ic('wrench')} Verwalten</h2>
    <div class="formrow">
      <button class="btn primary" id="adAdd">＋ Maschine hinzufügen</button>
      <button class="btn" id="adLog">${ic('doc')} Änderungsprotokoll</button>
    </div>
    <div class="formrow">
      <input type="text" id="adSearch" placeholder="Maschine suchen…" style="flex:1">
      <label style="min-width:auto">Sortieren</label>
      <select id="adSort">
        <option value="manual" ${adSort==='manual'?'selected':''}>Standard (manuell)</option>
        <option value="name" ${adSort==='name'?'selected':''}>Alphabetisch (A–Z)</option>
        <option value="group" ${adSort==='group'?'selected':''}>Nach Bereich</option>
      </select>
    </div>
    <div class="mlist" style="max-height:380px" id="adList"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Schließen</button></div>`);
  const renderList=()=>{
    const q=(document.getElementById('adSearch').value||'').toLowerCase();
    const manual = adSort==='manual';
    let rows=S.data.machines.slice();
    if(adSort==='name') rows.sort((a,b)=>a.name.localeCompare(b.name,'de'));
    else if(adSort==='group') rows.sort((a,b)=>(a.group||'').localeCompare(b.group||'','de') || a.name.localeCompare(b.name,'de'));
    rows=rows.filter(m=>(m.name+' '+m.group).toLowerCase().includes(q));
    document.getElementById('adList').innerHTML = rows.length ? rows.map(m=>`
      <div class="admrow">
        <span class="nm" title="${esc(m.name)}">${esc(m.name)} <span class="hint" style="margin:0">(${esc(m.group)})</span>
          ${anyMaint(m)?`<span class="tag ${esc(maintKind(m)||'wartung')}" title="${esc(statusRangeText(m))}">${maintKind(m)==='defekt'?'defekt':'Wartung'}${maintSlots(m).length>1?' ×'+maintSlots(m).length:''}</span>`:''}${(m.days&&m.days!=='1111111')?`<span class="hint" style="margin:0" title="verfügbare Wochentage">· ${esc(daysMaskText(m))}</span>`:''}</span>
        ${manual?`<button class="btn small" data-up="${esc(m.id)}" title="nach oben">↑</button>
        <button class="btn small" data-down="${esc(m.id)}" title="nach unten">↓</button>`:''}
        <button class="btn small" data-edit="${esc(m.id)}">Bearbeiten</button>
      </div>`).join('') : '<p class="hint">Keine Maschine gefunden.</p>';
    document.querySelectorAll('#adList [data-edit]').forEach(b=>b.onclick=()=>openMachineForm(b.dataset.edit));
    document.querySelectorAll('#adList [data-up]').forEach(b=>b.onclick=()=>moveById(b.dataset.up,-1));
    document.querySelectorAll('#adList [data-down]').forEach(b=>b.onclick=()=>moveById(b.dataset.down,1));
  };
  const moveById=async (id,dir)=>{
    const res=await mutate(fresh=>{
      const idx=fresh.machines.findIndex(m=>m.id===id); const j=idx+dir;
      if(idx<0||j<0||j>=fresh.machines.length) return {abort:true};
      if(fresh.machines[idx].group!==fresh.machines[j].group) return {abort:true}; // nur innerhalb desselben Bereichs tauschen
      [fresh.machines[idx],fresh.machines[j]]=[fresh.machines[j],fresh.machines[idx]];
    },'Reihenfolge geändert');
    if(res&&res.abort) return;
    renderList();
  };
  document.getElementById('adAdd').onclick=()=>openMachineForm(null);
  document.getElementById('adLog').onclick=openLog;
  document.getElementById('adSearch').oninput=renderList;
  document.getElementById('adSort').onchange=ev=>{ adSort=ev.target.value; localStorage.setItem('mb_admsort',adSort); renderList(); };
  document.getElementById('adSearch').focus();
  renderList();
}
function openMachineForm(mid){
  const m = mid? machById(mid) : {name:'',group:groupList()[0]||'',info:'',status:'ok',statusNote:'',statusFrom:'',statusUntil:''};
  openModal(`
    <h2>${mid?'Ressource bearbeiten':'Neue Ressource'}</h2>
    <div class="formrow"><label>Name</label><input type="text" id="mfName" value="${esc(m.name)}"></div>
    <div class="formrow"><label>Kategorie</label>
      <select id="mfCat">${CATS.map(([c,l])=>`<option value="${c}" ${catOf(m)===c?'selected':''}>${l}</option>`).join('')}</select>
    </div>
    <div class="formrow"><label>Bereich</label>
      <select id="mfGroup">${CATS.map(([c,l])=>{
        const gs=groupList().filter(g=>groupCat(g)===c);
        return gs.length?`<optgroup label="${l}">${gs.map(g=>`<option ${g===m.group?'selected':''}>${esc(g)}</option>`).join('')}</optgroup>`:'';
      }).join('')}</select>
      <input type="text" id="mfNewGroup" placeholder="…oder neuen Bereich eingeben" style="flex:1">
    </div>
    <div class="formrow"><label>Info</label><input type="text" id="mfInfo" value="${esc(m.info||'')}" placeholder="z. B. Ansprechpartner, Hinweise"></div>
    <div class="formrow"><label>Redundanzgruppe</label>
      <input type="text" id="mfRedu" value="${esc(m.redu||'')}" placeholder="z. B. „Rauheitsmessgerät" – gleichwertige Geräte, gleicher Name" style="flex:1" list="mfReduList">
      <datalist id="mfReduList">${[...new Set(S.data.machines.map(x=>x.redu).filter(Boolean))].sort().map(r=>`<option value="${esc(r)}">`).join('')}</datalist></div>
    <div class="formrow"><label>Verfügbare Tage</label>
      <div id="mfDays" style="display:flex;flex-wrap:wrap;gap:10px;flex:1">
        ${WD_SHORT.map((w,i)=>`<label style="display:inline-flex;align-items:center;gap:4px;font-weight:400;min-width:auto"><input type="checkbox" class="mfDay" data-wd="${i}" ${(!m.days||m.days.length!==7||m.days.charAt(i)!=='0')?'checked':''}> ${w}</label>`).join('')}
      </div></div>
    <div class="mfsection">
      <h3 style="margin:10px 0 4px;font-size:15px">Wartung / Ausfallzeiten</h3>
      <div id="mfMaint"></div>
      <div class="formrow"><button class="btn small" id="mfAddMaint">＋ Wartung/Defekt hinzufügen</button></div>
    </div>
    <div class="modal-actions">
      ${mid?'<button class="btn danger" id="mfDel">Löschen</button><span class="spacer"></span>':''}
      <button class="btn" id="mfBack">Zurück</button>
      <button class="btn primary" id="mfSave">Speichern</button>
    </div>`);
  document.getElementById('mfBack').onclick=openAdmin;
  // Wartungs-/Ausfall-Slots: Laufzeit-Liste, aus vorhandenen Slots (inkl. Alt-Status) initialisiert
  let maintList = maintSlots(m).map(s=>({type:(s.type==='defekt'?'defekt':'wartung'), from:s.from||'', until:s.until||'', note:s.note||''}));
  const renderMaint=()=>{
    const box=document.getElementById('mfMaint');
    box.innerHTML = maintList.length ? maintList.map((s,i)=>`
      <div class="maintrow" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid var(--border);border-radius:8px;padding:6px;margin-bottom:6px">
        <select data-mt="${i}">
          <option value="wartung" ${s.type!=='defekt'?'selected':''}>in Wartung</option>
          <option value="defekt" ${s.type==='defekt'?'selected':''}>defekt</option>
        </select>
        <label style="min-width:auto">von</label><input type="date" data-mf="${i}" value="${esc(s.from)}">
        <label style="min-width:auto">bis</label><input type="date" data-mu="${i}" value="${esc(s.until)}">
        <input type="text" data-mn="${i}" value="${esc(s.note)}" placeholder="Grund/Notiz" style="flex:1;min-width:120px">
        <button class="btn small danger" data-mrm="${i}" title="Slot löschen" aria-label="Slot löschen">✕</button>
      </div>`).join('') : '<p class="hint" style="margin:2px 0 6px">Keine Wartungs-/Ausfallzeiten. Mit „＋" hinzufügen.</p>';
    box.querySelectorAll('[data-mt]').forEach(el=>el.onchange=()=>maintList[+el.dataset.mt].type=el.value);
    box.querySelectorAll('[data-mf]').forEach(el=>el.onchange=()=>maintList[+el.dataset.mf].from=el.value);
    box.querySelectorAll('[data-mu]').forEach(el=>el.onchange=()=>maintList[+el.dataset.mu].until=el.value);
    box.querySelectorAll('[data-mn]').forEach(el=>el.oninput=()=>maintList[+el.dataset.mn].note=el.value);
    box.querySelectorAll('[data-mrm]').forEach(el=>el.onclick=()=>{ maintList.splice(+el.dataset.mrm,1); renderMaint(); });
  };
  renderMaint();
  document.getElementById('mfAddMaint').onclick=()=>{ maintList.push({type:'wartung',from:'',until:'',note:''}); renderMaint(); };
  document.getElementById('mfSave').onclick=async ()=>{
    const name=document.getElementById('mfName').value.trim();
    const group=(document.getElementById('mfNewGroup').value.trim()||document.getElementById('mfGroup').value).trim();
    const cat=document.getElementById('mfCat').value;
    const info=document.getElementById('mfInfo').value.trim();
    const redu=document.getElementById('mfRedu').value.trim();
    const daysArr=[...document.querySelectorAll('#mfDays .mfDay')].sort((a,b)=>a.dataset.wd-b.dataset.wd);
    const daysMaskRaw=daysArr.map(c=>c.checked?'1':'0').join('');
    const daysMask=(daysMaskRaw==='1111111')?null:daysMaskRaw;
    // Wartungs-Slots normalisieren + validieren
    const maint = maintList.map(s=>({type:(s.type==='defekt'?'defekt':'wartung'), from:(s.from||'').trim(), until:(s.until||'').trim(), ...( (s.note||'').trim() ? {note:(s.note||'').trim()} : {} )}));
    for(const s of maint){ if(s.from && s.until && s.from>s.until){ toast('Wartungs-Zeitraum ungültig (von liegt nach bis).'); return; } }
    if(!name||!group){ toast('Name und Bereich sind Pflicht.'); return; }
    if(daysMask && !daysMask.includes('1')){ toast('Mindestens einen verfügbaren Wochentag wählen.'); return; }
    const applyFields=(o)=>{
      o.name=name; o.group=group; o.info=info;
      if(redu) o.redu=redu; else delete o.redu;               // Redundanz-Markierung (nur Label)
      if(daysMask) o.days=daysMask; else delete o.days;        // verfügbare Wochentage
      if(maint.length) o.maint=maint; else delete o.maint;     // Wartungs-/Ausfall-Slots
      delete o.status; delete o.statusNote; delete o.statusFrom; delete o.statusUntil; // Alt-Status durch maint ersetzt
      if(cat==='messtechnik') o.cat='messtechnik'; else delete o.cat; // 'maschine' = Standard (kein Feld)
    };
    const res=await mutate(fresh=>{
      if(mid){
        const fm=fresh.machines.find(x=>x.id===mid); if(!fm) return {abort:true};
        applyFields(fm);
      } else {
        let base=name.toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'maschine';
        let id=base,n=2; while(fresh.machines.some(x=>x.id===id)) id=`${base}-${n++}`;
        let idx=fresh.machines.length;
        for(let i=fresh.machines.length-1;i>=0;i--) if(fresh.machines[i].group===group){ idx=i+1; break; }
        const nm={id}; applyFields(nm);
        fresh.machines.splice(idx,0,nm);
      }
    }, mid?`Maschine bearbeitet: ${name}`:`Maschine angelegt: ${name}`);
    if(res&&res.abort) return;
    fillGroupSel(); openAdmin(); toast('Gespeichert ✓');
  };
  const del=document.getElementById('mfDel');
  if(del) del.onclick=async ()=>{
    if(!await askConfirm({
      title:'Maschine löschen?',
      body:`<b>${esc(m.name)}</b> (${esc(m.group)}) wird entfernt — <b>inklusive aller zugehörigen Buchungen</b>. Das lässt sich nicht rückgängig machen.`,
      yes:'Maschine löschen'
    })) return;
    const res=await mutate(fresh=>{
      const i=fresh.machines.findIndex(x=>x.id===mid); if(i<0) return {abort:true};
      fresh.machines.splice(i,1); delete fresh.bookings[mid];
    },`Maschine gelöscht: ${m.name}`);
    if(res&&res.abort) return;
    fillGroupSel(); openAdmin(); toast('Maschine gelöscht.');
  };
}
function openLog(){
  const log=S.data.log||[];
  openModal(`
    <h2>${ic('doc')} Änderungsprotokoll <span class="tag">letzte ${Math.min(log.length,200)}</span></h2>
    <div class="resultlist" style="max-height:420px">
      ${log.slice(0,200).map(l=>`<div class="logrow"><span class="ts">${new Date(l.ts).toLocaleString('de-DE')}</span><b>${esc(l.user)}</b>: ${esc(l.action)}</div>`).join('')||'<p class="hint">Noch keine Einträge.</p>'}
    </div>
    <div class="modal-actions"><button class="btn" id="lgBack">Zurück</button><button class="btn" onclick="closeModal()">Schließen</button></div>`);
  document.getElementById('lgBack').onclick=openAdmin;
}

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
function maintText(s){ if(!s) return ''; const f=s.from?fmtLong(s.from):'sofort', u=s.until?fmtLong(s.until):'unbegrenzt'; return `${s.type==='defekt'?'defekt':'Wartung'}: ${f} – ${u}${s.note?' ('+s.note+')':''}`; }
function blockText(m,d){ return maintText(maintAt(m,d)); }
function maintKind(m){ const s=maintAt(m,todayStr()); return s?s.type:null; }
function catIco(c){ return ic(c==='messtechnik' ? 'gauge' : 'factory'); }
function asDevUid(id,node=AS_TREE){ for(const c of node.children){ if(c.type==='dev'&&c.id===id) return c.uid; if(c.type==='grp'){ const r=asDevUid(id,c); if(r) return r; } } return null; }
function asToggleId(id,on){ if(on){ asAdd(id); } else { const u=asDevUid(id); if(u){ asDetach(u); asCleanup(); } } AS_ADDED=new Set(asDevs()); renderWork(); }
const API = '';   // gleiche Herkunft wie die ausgelieferte Seite
async function apiGet(path){ const r=await fetch(API+path); if(!r.ok) throw new Error('Server '+r.status); return r.json(); }
async function apiPost(path, body){ const r=await fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return r.json(); }

async function readFile(){
  const d = await apiGet('/api/state');
  d.revision = d.rev || 0; d.log = d.log || [];
  return validateData(d);
};
async function writeFile(data){
  const w = await S.handle.createWritable();  // FS-Access-API: schreibt in Swap-Datei …
  const txt = JSON.stringify(data, null, 1);
  await w.write(txt); await w.close();        // … und ersetzt die Datei ATOMAR beim Schließen (Punkt 7)
  S.lastRaw = txt;
  try{ lastMtime = (await S.handle.getFile()).lastModified; }catch(e){}
};   // im Server-Modus ungenutzt

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
    S.data = d; render(); stampRef();
    if(!silent) toast('Aktualisiert ✓');
  }catch(e){
    const el=document.getElementById('lastRef'); if(el) el.textContent='⚠ offline';
    if(!silent) toast('Aktualisieren fehlgeschlagen: '+e.message, null, 6000);
  }
};

async function setupFileObserver(){};
/* Removed: migrateWeekends()/migrateMesstechnik() — obsolete one-time client-side
   Bestands-Migrationen from the old File-System-Access variant. They referenced the
   undeclared globals `migrating`/`migratingMess`, so under 'use strict' they threw
   "migrating is not defined" at init and never actually ran (non-fatal). The server
   is authoritative and already consistent ("Serverdaten sind bereits konsistent"):
   migrateMesstechnik needed a local folder (S.dir) that no longer exists, and the
   server rejects the weekend-bridge write (HTTP 400). Deleting them fixes the console
   error while preserving behavior exactly (no migration ran before; none runs now).
   Live weekend upkeep is unaffected — sweepWeekends still runs on every booking write. */
function startRefreshTimer(){};         // kein Polling – der Server schiebt (SSE)

/* --- Live-Verbindung (Server-Sent Events): Push statt Polling --- */
let es=null;
function applyPresence(users){
  const now=Date.now(); presenceData={};
  const list=(users||[]).filter(Boolean);
  for(const u of list) presenceData[u]=now;
  setPres(String(list.length||'–'), list.length?('Gerade aktiv: '+list.join(', ')):'Niemand aktiv');
}
function connectSSE(){
  try{ if(es) es.close(); }catch(_){}
  // „Anwesenheit teilen" aus → ohne Namen verbinden (man erscheint dann nicht in der Liste)
  const share = localStorage.getItem('mb_presence')!=='off';
  const uname = share ? (S.user||'') : '';
  es = new EventSource(API+'/api/stream'+(uname?('?user='+encodeURIComponent(uname)):''));
  es.addEventListener('hello', ()=>{ stampRef(); dbg('info','Live-Verbindung steht'); });
  es.addEventListener('presence', ev=>{ try{ applyPresence(JSON.parse(ev.data).users); }catch(e){ handleError('sse/presence', e); } });
  es.addEventListener('update', ev=>{
    let d; try{ d=JSON.parse(ev.data); }catch(_){ return; }
    if(typeof d.rev==='number') S.data.revision=d.rev;
    const patch=[];
    for(const c of (d.changes||[])){
      S.data.bookings[c.mid] = S.data.bookings[c.mid] || {};
      if(c.val) S.data.bookings[c.mid][c.day]=c.val; else delete S.data.bookings[c.mid][c.day];
      patch.push({ mid:c.mid, date:c.day });
    }
    if(patch.length) patchCells(patch);
    stampRef();
    const me=(S.user||'?').toLowerCase();
    if(d.by && String(d.by).toLowerCase()!==me && d.log){   // Meldung nur für FREMDE Änderungen
      dbg('remote', d.by+': '+d.log);
      queueRemote(remoteMsg({ user:d.by, action:d.log, ts:new Date().toISOString() }));
    }
  });
  es.addEventListener('structural', async ev=>{             // Maschinenliste geändert → neu laden
    try{ S.data = await readFile(); fillGroupSel(); render(); }catch(e){ handleError('sse/structural', e); }
    let by=''; try{ by=JSON.parse(ev.data).by; }catch(_){}
    if(by && String(by).toLowerCase()!==(S.user||'?').toLowerCase()) toast(by+' hat die Maschinenliste geändert.');
  });
  es.onerror = ()=>{ const el=document.getElementById('lastRef'); if(el) el.textContent='⚠ offline'; };
}
function startLiveTimers(){
  if(liveTimersOn) return; liveTimersOn=true;
  window.addEventListener('focus', ()=>refreshNow(true));
  connectSSE();
};
async function presenceTick(){ connectSSE(); };   // Namenswechsel → mit neuem Namen neu verbinden

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
