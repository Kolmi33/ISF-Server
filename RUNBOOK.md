# Maschinenplan-Server — Betriebs- & Übergabe-Runbook

Kleiner, zustandsbehafteter Dienst: **Node (ohne externe Abhängigkeiten) + SQLite**, in **einem** Docker-Container. Hält die Buchungsdaten selbst und schiebt Änderungen per **Server-Sent Events** sofort an alle Browser (gemessen ~60 ms statt der 6–9 s der Datei-Variante).

## Bestandteile
- `server/` — Backend-Quellcode (TypeScript, kompiliert nach `dist/server`): HTTP-API +
  SSE-Push + Tages-Backup (`server.ts`), SQLite-Schema + Import aus `buchungen.json` (`db.ts`),
  einmaliges Seeding per Kommandozeile (`import.ts`).
- `web/` — Frontend-Quellcode (TypeScript/React, Vite); der Dockerfile-Build kompiliert daraus
  die ausgelieferte Oberfläche (das eigentliche Maschinenplan-Raster, komplett auf diese API
  umgestellt).
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`.
- Daten liegen **außerhalb** des Images im Volume `data` → `/data/buchungen.db` (+ `/data/backups`).

## API (kurz)
- `GET /api/state` — kompletter Stand `{rev, groups, machines, bookings}`.
- `POST /api/book` `{mids[], from, to, name, note?, title?, force?}` — bucht freie Tage; bei Konflikten ohne `force` → `{conflicts}`.
- `POST /api/delete` `{gid}` **oder** `{mid, days[]}` **oder** `{cells:[{mid,day}]}` — löscht, räumt Sa/So-Brückentage mit auf.
- `GET /api/stream` — SSE: `update {rev, changes[]}`, `presence {n}`.
- `GET /api/health` — `{ok, rev, clients}` (für Healthcheck/Monitoring).

## Erstinbetriebnahme (auf dem Server)
1. Ordner mit diesen Dateien auf den Server kopieren.
2. Die vorhandene `buchungen.json` **einmalig** ins Datenvolume legen, damit sie beim ersten Start importiert wird:
   ```bash
   docker compose up -d                 # startet den Container
   docker cp buchungen.json maschinenplan:/data/buchungen.json
   docker compose restart               # erster Start importiert die Datei automatisch
   ```
   (Alternativ ohne Docker, nach `npm run build:server`: `DB_PATH=./data/buchungen.db node dist/server/import.js buchungen.json`.)
3. Läuft auf `127.0.0.1:3000`. **nginx** davor macht HTTPS und reicht durch:
   ```nginx
   location / { proxy_pass http://127.0.0.1:3000; }
   location /api/stream {           # SSE braucht ungepuffertes, langlebiges Weiterreichen
     proxy_pass http://127.0.0.1:3000;
     proxy_http_version 1.1;
     proxy_set_header Connection '';
     proxy_buffering off;
     proxy_read_timeout 1h;
   }
   ```

## Alltag
- **Starten/Stoppen:** `docker compose up -d` / `docker compose down`
- **Logs ansehen:** `docker compose logs -f`
- **Läuft es?** `curl -s localhost:3000/api/health`

## Update einspielen (ohne Datenverlust)
Daten liegen im Volume, nie im Image — Updates fassen sie nicht an.
```bash
git pull            # oder neue Dateien kopieren
docker compose up -d --build
```
**Rollback:** vorheriges Image bzw. Commit wieder starten:
```bash
git checkout <vorheriger-commit> && docker compose up -d --build
```

## Backup & Wiederherstellung
- **Automatisch:** täglich ein konsistenter Snapshot nach `/data/backups/` (die letzten `BACKUP_KEEP=30` bleiben).
- **Wiederherstellen:**
  ```bash
  docker compose down
  docker run --rm -v maschinenplan_data:/data busybox \
    sh -c "cp /data/backups/buchungen_JJJJ-MM-TT.db /data/buchungen.db && rm -f /data/buchungen.db-wal /data/buchungen.db-shm"
  docker compose up -d
  ```
- **Zusätzlich:** die VM in das reguläre Backup der Uni-IT aufnehmen lassen (deckt Server-Totalausfall ab). **Einmal einen Restore testen** — ein ungetestetes Backup ist nur eine Hoffnung.

## Eingebaute Mechanismen gegen die Randfälle
- **Absturz / Server-Neustart:** `restart: unless-stopped` → Container kommt von selbst wieder. `Restart` + Healthcheck erkennen Hänger.
- **Datenkorruption / versehentliches Massenlöschen:** tägliche Snapshots + einfache Wiederherstellung; SQLite-Transaktionen (alles-oder-nichts).
- **Update kaputt:** schnelles Rollback (vorheriges Image), Daten getrennt → nie gefährdet.
- **Sicherheit:** Container läuft als **non-root**, Root-Dateisystem **read-only**, `no-new-privileges`, alle Linux-Capabilities entfernt, **null externe Abhängigkeiten** (keine Lieferketten-Angriffsfläche). Port nur an `127.0.0.1` gebunden — Zugriff ausschließlich über nginx.
- **Speicher voll:** Log-Rotation (10 MB × 5) + Backup-Aufbewahrung begrenzt.

## Was jemand wissen muss, wenn du im Urlaub oder weg bist
- **Wo liegt was:** Code = dieses Repo (in ein Uni-GitLab/GitHub legen, nicht privat!); Daten = Docker-Volume `maschinenplan_data`; Backups = `/data/backups`.
- **Wer darf/kann:** mindestens **eine zweite eingewiesene Person** + IT-Kontakt für die VM. Zugangsdaten/Zertifikate in einen geteilten Passwort-Tresor, nicht in einen Kopf.
- **Domain/Zertifikat:** vom Uni-Sysadmin (Subdomain im DNS + TLS-Zertifikat); Ablaufdatum notieren bzw. automatische Erneuerung einrichten.
- **Notfall-Fallback:** solange nötig, kann die alte Datei-/Excel-Variante als Rückfallebene dienen.

## Wichtige Umgebungsvariablen
`PORT` (3000) · `DB_PATH` (/data/buchungen.db) · `IMPORT_JSON` (/data/buchungen.json) · `BACKUP_DIR` (/data/backups) · `BACKUP_KEEP` (30).
