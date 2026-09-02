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
- [ ] Week grid: machines as rows, days as columns, sticky machine column on the left
- [ ] Infinite horizontal scroll — more weeks load as you scroll (`ensureOverflow`)
- [ ] Weekend columns hidden by default; toggle to show 7-day weeks (setting `mb_weekends`)
- [ ] "Today" is highlighted and can be re-centered (`centerToday`)
- [ ] Month/year jump control; jump follows scroll position (mid-week reference)
- [ ] ISO week numbers shown in the header
- [ ] Go to next / previous free slot for a machine (`gotoNextFree` / `gotoPrevFree`)
- [ ] Reset view (scroll home, collapse extra weeks)

## Booking
- [ ] Click a cell → book (name required) (logic-tested: validation)
- [ ] Multi-cell drag-select across days/machines; auto-scroll at edges while dragging
- [ ] Context menu on selection (book / delete / details)
- [ ] Booking form over a date range (from–to), across one or more machines
- [ ] Booking detail view: edit note, delete
- [ ] Booking groups: multi-cell bookings share `gid` + `gtitle`
- [ ] Compare-and-set: booking over someone else's cell is rejected as a conflict, not overwritten (logic-tested)
- [ ] Optimistic update on screen, rolled back if the server rejects
- [ ] Undo toast after a booking/delete
- [ ] Blocked cells (maintenance/defect/unavailable weekday) refuse booking with a reason (logic-tested)

## Machines & Messtechnik
- [ ] Two categories: Maschinen and Messtechnik (distinct icons)
- [ ] Groups; group headers collapse/expand
- [ ] Favorites — favorited machines float to a "★" group (`FAVGRP`)
- [ ] Machine info text
- [ ] Redundancy label (`redu`) — label only, no booking effect
- [ ] Available-weekday mask (`days`, Mo..So) — non-available days aren't bookable (logic-tested)
- [ ] Status: ok / wartung / defekt, with from–until window (logic-tested: `isBlocked`)
- [ ] Maintenance slots: array of {type, from, until, note}; render + block (logic-tested)
- [ ] Machine selector/filter (search, by category/group, favorites)

## Assistant (auto-booking)
- [ ] Build a device/group tree; drag-drop to group devices
- [ ] Group "need N of M" (change need up/down, dissolve group, remove device)
- [ ] Run assistant over a date range → allocates free machines respecting need/blocks (logic-tested)
- [ ] Weekend bridging: a booking Fri+Mon bridges the weekend where appropriate (logic-tested)

## Reports & views
- [ ] All bookings view (grouped runs) (`computeAllRuns`)
- [ ] My bookings view (current user's runs) (`computeMyRuns`)
- [ ] Stats view, optionally preset to a person
- [ ] Activity log view (`log` table)

## Admin
- [ ] Machine form: add / edit / delete a machine
- [ ] Group management
- [ ] Structural save writes the full machine/group list via the single server write path (logic-tested: validation)

## Presence & live updates
- [ ] SSE connection; auto-reconnect (`retry`)
- [ ] Presence badge: count + names of currently active users (sorted, de-locale)
- [ ] Live updates: another user's change appears without reload
- [ ] Collision banner when the local revision falls behind
- [ ] Remote-change messages queued and surfaced (`queueRemote`)
- [ ] Name change reconnects SSE with the new name

## Identity & settings
- [ ] User name prompt on first run (no login); editable via the user chip
- [ ] Theme: auto / light / dark (`mb_theme`)
- [ ] Presence on/off (`mb_presence`)
- [ ] Compact mode (`mb_compact`)
- [ ] Weekends on/off (`mb_weekends`)
- [ ] Help panel
- [ ] Debug panel (`localStorage mb_debug=on`)

## Data & migrations
- [ ] Client-side data validation (`validateData`)

~~Weekend migration (`migrateWeekends`) / Messtechnik migration (`migrateMesstechnik`)~~ —
removed as dead code in Phase 2.3 (`PROGRESS.md`'s Known Bugs → Fixed, "`migrating` bug"):
both were obsolete one-time file-system-era migrations that threw on undeclared globals and
never actually ran; the server also rejects the weekend-bridge write they'd have attempted
(HTTP 400). Nothing to smoke here — the feature they implemented doesn't exist in this app
any more (see instead: server-authoritative weekend auto-bridging, `server/bridge.ts`, under
Assistant below).

## Backend behaviors (verify in Phase 6)
- [ ] Seed on empty DB from volume JSON, else bundled JSON (logic-tested)
- [ ] `/api/health`, `/api/state`, `/api/stream`, `POST /api/mutate`
- [ ] Daily rotating backups (keep last 30) via `VACUUM INTO`
- [ ] Graceful shutdown closes the DB cleanly
- [ ] Static file serving with path-traversal guard
