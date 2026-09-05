# Feature Inventory & Smoke Checklist

The behavioral acceptance list for the rework. Because we test logic (not the full UI),
this is the manual backstop for "conserve every feature." After any risky phase, walk the
relevant section against the running app and against the baseline (commit `789bfec`).

Legend: `[ ]` to verify · `[x]` verified preserved after a change · `(logic-tested)` also
covered by an automated test.

> v1 inventory built from `public/index.html`. Deepens as each area is extracted — when a
> module lands, refine its section with the exact edge cases its tests pin down.

---

## Grid & navigation
- [x] Week grid: machines as rows, days as columns, sticky machine column on the left
- [x] Infinite horizontal scroll — more weeks load as you scroll (`ensureOverflow`)
- [x] Weekend columns hidden by default; toggle to show 7-day weeks (setting `mb_weekends`)
- [x] "Today" is highlighted and can be re-centered (`centerToday`)
- [x] Month/year jump control; jump follows scroll position (mid-week reference)
- [x] ISO week numbers shown in the header
- [ ] Go to next / previous free slot for a machine (`gotoNextFree` / `gotoPrevFree`)
- [ ] Reset view (scroll home, collapse extra weeks)

## Booking
- [x] Click a cell → book (name required) (logic-tested: validation)
- [x] Multi-cell drag-select across days/machines — auto-scroll at edges not separately verified
- [x] Context menu on selection (book) — delete/details from the selection menu not separately verified
- [x] Booking form over a date range (from–to), across one or more machines
- [x] Booking detail view: delete — edit-note not separately verified
- [x] Booking groups: multi-cell bookings share `gid` (confirmed via API on a 2-day range booking)
- [x] Compare-and-set: booking over someone else's cell is rejected as a conflict, not overwritten (logic-tested; also confirmed live as a genuine server-side race — see Presence & live updates)
- [ ] Optimistic update on screen, rolled back if the server rejects
- [x] Undo toast after a booking/delete
- [x] Blocked cells (maintenance/defect/unavailable weekday) refuse booking with a reason (logic-tested)

## Machines & Messtechnik
- [x] Two categories: Maschinen and Messtechnik (distinct icons)
- [x] Groups; group headers collapse/expand
- [x] Favorites — favorited machines float to a "★" group (`FAVGRP`)
- [x] Machine info text
- [x] Redundancy label (`redu`) — label only, no booking effect
- [x] Available-weekday mask (`days`, Mo..So) — non-available days aren't bookable (logic-tested)
- [x] Status: ok / wartung / defekt, with from–until window (logic-tested: `isBlocked`)
- [x] Maintenance slots: array of {type, from, until, note}; render + block (logic-tested)
- [x] Machine selector/filter (search, by category/group, favorites)

## Assistant (auto-booking)
- [x] Assistant UX 2026-09-05: aligned labeled checkboxes, black category ink, blue theme tokens,
  explicit UND/ODER requirements, grouping help, automatic filter clearing, equal-height cards,
  full-width parameters, synchronized range calendar, and per-search result-duration defaults.
  Local gate and browser evidence: `docs/ASSISTANT-UX-PLAN.md` (Docker/commit status tracked there).
- [x] Build a device/group tree; drag-drop to group devices
- [ ] Group "need N of M" (change need up/down, dissolve group, remove device) — group creation verified above, these per-group controls were not separately exercised
- [x] Run assistant over a date range → allocates free machines respecting need/blocks (logic-tested; redundancy-confirm dialog before the search also confirmed working)
- [x] Weekend bridging: a booking Fri+Mon bridges the weekend where appropriate (logic-tested; confirmed live via `/api/state`)

## Reports & views
- [x] All bookings view (grouped runs) (`computeAllRuns`)
- [x] My bookings view (current user's runs) (`computeMyRuns`)
- [x] Stats view, optionally preset to a person
- [x] Activity log view (`log` table)

## Admin
- [x] Machine form: add / edit / delete a machine
- [ ] Group management
- [x] Structural save writes the full machine/group list via the single server write path (logic-tested: validation)

## Presence & live updates
- [x] SSE connection; auto-reconnect (`retry`)
- [x] Presence badge: count + names of currently active users (sorted, de-locale)
- [x] Live updates: another user's change appears without reload
- [x] Collision banner when the local revision falls behind — confirmed with a genuine two-browser server-side race (SSE blocked on one side so its own client-side conflict pre-check couldn't short-circuit it), including "Verstanden" dismiss and view reconciliation to the authoritative state
- [x] Remote-change messages queued and surfaced (`queueRemote`)
- [x] Name change reconnects SSE with the new name

## Identity & settings
- [x] User name prompt on first run (no login); editable via the user chip
- [x] Theme: auto / light / dark (`mb_theme`)
- [ ] Presence on/off (`mb_presence`)
- [x] Compact mode (`mb_compact`)
- [x] Weekends on/off (`mb_weekends`)
- [x] Help panel
- [x] Debug panel (`localStorage mb_debug=on`)

## Data & migrations
- [x] Client-side data validation (`validateData`) — logic-tested, and confirmed live by mocking malformed `/api/state` responses (missing `machines`, missing `bookings`, a non-object body): each fails boot gracefully to the "Verbindung zum Server fehlgeschlagen" screen rather than crashing blank, while a structurally valid payload boots normally (control case)

~~Weekend migration (`migrateWeekends`) / Messtechnik migration (`migrateMesstechnik`)~~ —
removed as dead code in Phase 2.3 (`PROGRESS.md`'s Known Bugs → Fixed, "`migrating` bug"):
both were obsolete one-time file-system-era migrations that threw on undeclared globals and
never actually ran; the server also rejects the weekend-bridge write they'd have attempted
(HTTP 400). Nothing to smoke here — the feature they implemented doesn't exist in this app
any more (see instead: server-authoritative weekend auto-bridging, `server/bridge.ts`, under
Assistant below).

## Backend behaviors (verify in Phase 6)
- [x] Seed on empty DB from volume JSON, else bundled JSON (logic-tested; confirmed live — every fresh throwaway container booted seeded from the image's bundled JSON)
- [x] `/api/health`, `/api/state`, `/api/stream`, `POST /api/mutate`
- [ ] Daily rotating backups (keep last 30) via `VACUUM INTO`
- [x] Graceful shutdown closes the DB cleanly (`docker stop` exited in ~1s — well under the SIGKILL grace period — and the volume's data was intact and readable when remounted into a fresh container afterward)
- [x] Static file serving with path-traversal guard — probed live with plain `..`, percent-encoded (`%2e%2e`, double-encoded), encoded-slash (`..%2f`), and backslash (`..%5c`) variants: plain `..` is neutralized by URL dot-segment normalization before it reaches the app (harmless 404), the encoded-slash/backslash variants that survive normalization are explicitly rejected by the `filePath.includes('..')` guard (400 `bad path`); no variant ever returned file content outside `public/`
