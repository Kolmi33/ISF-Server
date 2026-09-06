# Supplied booking assistant integration

The supplied TSX and README (2026-09-06) supersede the earlier redesign. Preserve
their layout, palette, typography, date presets, duration controls and plan interactions.
Split the supplied sections into focused modules to meet the existing size gates.

- [x] Inspect supplied UI, installed primitives, existing store and booking contracts.
- [x] Integrate the supplied UI and scope its theme to the assistant and its portals.
- [x] Replace demo catalog and random search with live data and deterministic availability.
- [x] Wire booking confirmation, calendar navigation, cancellation and close.
- [x] Test scheduling boundaries, grouping resolution and date/device transfer.
- [x] Inspect in the Orca browser, run repository gates and launch the integrated server.

Validation: 1,002 tests across 75 files pass; coverage is 97.81% lines and 93.03%
branches. Formatting, TypeScript, ESLint and unused-code checks pass. The production
image builds and runs on localhost:3000. Orca browser checks covered real catalog/search,
drag-to-group and resolved alternatives, calendar selection, help hover, and scrolling
at desktop and narrow mobile sizes. Booking confirmation is integration-tested with
exact machine IDs/dates; no test reservations were written to the live database.

The supplied duration counts calendar days, including both endpoints. Search must respect
each machine's configured weekdays, maintenance and existing reservations on every day.
Alternative devices must remain the same throughout each displayed window. Only verified
dates within the chosen range are offered; never label unchecked future dates as open.
Reservations continue through the existing booking form and authoritative mutation API.

Frontend dependencies explicitly required by the supplied tool: dnd-kit for its drag
gestures, lucide-react for its exact icons, date-fns for its date formatting/presets, and
JetBrains Mono for its numeric typography. Reuse the installed Base UI primitives behind
small composition adapters; do not introduce a second primitive library or backend dependency.
