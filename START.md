# Maschinenplan-Server — Schnellstart

Zentraler Buchungsdienst: **Node + SQLite** in **einem** Docker-Container, mit Live-Updates
(Server-Sent Events). Keine externen Abhängigkeiten. Die App-Oberfläche liefert der
Server selbst aus.

## Inhalt des Ordners
```
maschinenplan-server/
├── Dockerfile            – Bauplan fürs Image (non-root, gehärtet)
├── docker-compose.yml    – Start/Stop, Volume, Healthcheck, Auto-Neustart
├── .dockerignore
├── package.json          – Projekt-Info (keine Dependencies)
├── buchungen.json        – Startdaten (245 Maschinen/Messtechnik + Buchungen)
├── src/
│   ├── server.mjs        – HTTP-API + SSE + Backup (der Dienst)
│   ├── db.mjs            – SQLite-Schema + Import
│   └── import.mjs        – einmaliges Seeding (CLI)
├── public/
│   └── index.html        – die App (eure Oberfläche, redet per fetch + SSE mit dem Server)
├── START.md              – diese Anleitung
└── RUNBOOK.md            – Betrieb, Update, Backup/Restore, Übergabe
```

## Voraussetzung
**Docker Desktop** (Windows/Mac) bzw. **Docker Engine + Compose** (Linux-Server).
Prüfen: `docker --version` und `docker compose version` müssen eine Nummer zeigen.
(Windows: Docker Desktop installieren, „WSL 2" aktiviert lassen, PC neu starten, Docker Desktop öffnen –
das Wal-Symbol muss „running" zeigen.)

---

## Erststart (lokal testen — empfohlen zum Ausprobieren)

Terminal im Ordner `maschinenplan-server` öffnen (Windows: im Explorer in die Adressleiste
`powershell` tippen), dann:

```powershell
# Bauen und starten (erster Build lädt das Node-Image, dauert 1–2 min)
docker compose up -d --build
```

Die Startdaten werden beim **ersten** Start automatisch geladen: Der Dienst importiert die
mitgelieferte `buchungen.json` (im Image gebündelt), sobald die Datenbank leer ist. Ein
`docker cp` ist **nicht mehr nötig**.

> Optional: Wollt ihr stattdessen eine eigene/aktualisierte Datei einspielen, legt sie
> **vor** dem ersten Start ins Volume und startet neu:
> `docker cp buchungen.json maschinenplan:/data/buchungen.json` → `docker compose restart`.
> (Der Import läuft nur, solange die DB leer ist – bestehende Daten werden nie überschrieben.)

Öffnen: **http://localhost:3000** → euer gewohntes Raster.
Gegencheck: **http://localhost:3000/api/health** zeigt `{"ok":true,...}`.

**Live-Test:** die Adresse in zwei Browserfenstern öffnen, in einem buchen → das andere
aktualisiert sich sofort, ohne Neuladen.

> Lokal ist der Dienst nur auf **deinem** PC unter `localhost` erreichbar. Für die Kollegen
> muss er auf den Server (siehe unten).

---

## Betrieb auf dem Uni-Server

1. Den ganzen Ordner auf den Server kopieren (z. B. per WinSCP/scp).
2. Dort im Ordner: `docker compose up -d --build`, dann einmalig
   `docker cp buchungen.json maschinenplan:/data/buchungen.json` und `docker compose restart`.
3. Der Dienst lauscht auf **`127.0.0.1:3000`** (nur lokal). Ein **nginx** davor macht HTTPS
   und reicht durch — Beispiel-Konfiguration steht in `RUNBOOK.md` (wichtig: für `/api/stream`
   das Puffern ausschalten, sonst kommen die Live-Updates nicht durch).

**Sicherheit (wichtig, da es keinen Login gibt):** Der Dienst hat bewusst **keine Anmeldung** —
die Zugangskontrolle ist das Netz. Deshalb: den Port **nur an `127.0.0.1` binden** (macht die
compose-Datei bereits) und den Zugriff aufs **Uni-Netz/VPN** beschränken. **Niemals** den Port
ungeschützt ins Internet öffnen.

---

## Alltag (die wichtigsten Befehle)

```powershell
docker compose logs -f      # Live-Logs (mit Strg+C beenden)
docker compose ps           # läuft der Container? („running (healthy)")
docker compose restart      # neu starten
docker compose down         # stoppen (Daten bleiben im Volume erhalten)
docker compose up -d         # wieder starten
```

## Update einspielen (ohne Datenverlust)
Die Daten liegen im Docker-Volume `maschinenplan_data`, **nie** im Image — Updates fassen sie nicht an.
```powershell
# neue Dateien in den Ordner kopieren, dann:
docker compose up -d --build
```
Rückgängig (Rollback): vorherige Dateistände wiederherstellen und erneut `docker compose up -d --build`.

## Backups
Der Server legt **täglich** automatisch eine Sicherung unter `/data/backups/` an (die letzten 30 bleiben).
Wiederherstellen und weitere Details: siehe `RUNBOOK.md`.

## Wenn etwas nicht geht
- `docker compose ps` – läuft der Container? Sonst `docker compose logs -f` ansehen.
- App lädt nicht → ist Docker Desktop gestartet? Richtiger Port (3000)?
- „Verbinde mit dem Server…" bleibt stehen → Dienst nicht erreichbar; Logs prüfen, `docker compose restart`.
- Kollegen sehen nichts live → nginx-`/api/stream`-Konfiguration (Puffern aus) prüfen.
