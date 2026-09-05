# UI design decisions

## Single palette file

Edit `web/css/theme.css` to change the palette. It is imported by `app.css`, which is
loaded by every page. Light and dark palettes use the existing `html[data-theme]` toggle.
Tailwind's semantic utility mappings live in `tailwind.css`; color values do not belong there.

| Token | Purpose |
| --- | --- |
| `--app-accent` | Primary blue: actions, checked controls, selected calendar endpoints |
| `--app-accent-hover` | Primary hover color |
| `--app-accent-light` | Subtle blue selected/hover surfaces and range interiors |
| `--on-primary` | Legible text/checkmarks on primary blue |
| `--heading-ink` | Black headings/icons in light mode; light foreground in dark mode |
| `--app-text`, `--app-muted` | Main content and supporting explanations |
| `--app-bg`, `--app-panel`, `--app-border` | Page, cards, and boundaries |
| `--control-gap` | Checkbox-to-label spacing, currently 12px |
| `--radius` | Shared shadcn corner radius |

Shadcn `--primary`, `--primary-foreground`, and `--ring` reference these same blue tokens.
The older grid's status colors (free/busy, maintenance) and resource-category colors retain
their meanings: green is a status/category color, not the primary interaction color.

## Assistant layout and components

Use existing Base UI/shadcn Button, Input, and Checkbox components. Device rows explicitly
align items centrally; names are wrapped so the checkbox and text are separate flex items.
Desktop uses equal-height selection cards with independently scrolling lists and a shared
full-width date/duration card below. On mobile the same reading order stacks vertically.

Calendar follows shadcn's Calendar + Popover composition, adapting React DayPicker's
predefined accessible range calendar and Base UI's Popover. Use German labels, Monday-first
weeks, and UTC date-only conversion. Range changes are applied together, and incomplete
calendar drafts never replace the current search range.

UND means all connected requirements must be met. ODER means one alternative suffices.
For N-of-M groups where 1 < N < M, retain the explicit count and use “Auswahl” separators.
This vocabulary describes the existing solver, rather than adding a second rule system.

References: [shadcn date picker](https://ui.shadcn.com/docs/components/base/date-picker),
[shadcn checkbox](https://ui.shadcn.com/docs/components/base/checkbox),
[DayPicker range selection](https://daypicker.dev/docs/selection-modes).
